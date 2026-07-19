import { createServer } from "node:http";
import { fileURLToPath } from "node:url";

import { corsHeadersForOrigin } from "./cors.js";
import { createGeminiClient } from "../src/generation/geminiClient.js";
import {
  resolveGenerationModels,
  resolveRefinementModel,
  resolveSuggestionModel,
} from "../src/generation/modelConfig.js";
import {
  generateBuildSuggestions,
  generateModel,
  refineModel,
} from "../src/generation/service.js";
import { createBackboardGenerationClient } from "./backboardGenerationClient.js";
import { createInventorySessionStore } from "./inventorySessions.js";
import {
  createRefinementSessionStore,
  RefinementSessionError,
} from "./refinementSessions.js";
import {
  createGenerationRuntimeLogger,
  createLoggedGenerationClient,
} from "./generationRuntimeLogger.js";

const HOST = "127.0.0.1";
const PORT = Number(process.env.GENERATION_PORT ?? 8787);
let runtimeLogger = null;
let inventorySessionStore = null;
let refinementSessionStore = null;

function getRuntimeLogger() {
  if (!runtimeLogger) {
    runtimeLogger = createGenerationRuntimeLogger();
  }

  return runtimeLogger;
}

function getInventorySessionStore() {
  if (!inventorySessionStore) {
    inventorySessionStore = createInventorySessionStore();
  }

  return inventorySessionStore;
}

function getRefinementSessionStore() {
  if (!refinementSessionStore) {
    refinementSessionStore = createRefinementSessionStore();
  }

  return refinementSessionStore;
}

export function formatSseEvent(eventName, payload) {
  return `event: ${eventName}\ndata: ${JSON.stringify(payload)}\n\n`;
}

function sendJson(request, response, statusCode, payload) {
  response.writeHead(statusCode, {
    ...corsHeadersForOrigin(request.headers.origin),
    "Content-Type": "application/json",
  });
  response.end(JSON.stringify(payload));
}

export const MAX_REFINEMENT_REQUEST_BYTES = 13 * 1024 * 1024;

export class RequestBodyTooLargeError extends Error {
  constructor(maxBytes) {
    super(`Request body exceeds the ${maxBytes}-byte limit.`);
    this.name = "RequestBodyTooLargeError";
  }
}

export async function readJson(request, { maxBytes = Number.POSITIVE_INFINITY } = {}) {
  const chunks = [];
  let totalBytes = 0;

  const contentLength = Number(request.headers?.["content-length"]);

  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw new RequestBodyTooLargeError(maxBytes);
  }

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buffer.length;

    if (totalBytes > maxBytes) {
      throw new RequestBodyTooLargeError(maxBytes);
    }

    chunks.push(buffer);
  }

  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function hasInlineInventory(body) {
  return body.inventory !== undefined;
}

function hasInventorySessionId(body) {
  return body.inventory_id !== undefined;
}

export function validateRequestBody(body) {
  const errors = [];

  if (!body || typeof body !== "object") {
    return ["Request body must be a JSON object."];
  }

  if (typeof body.userPrompt !== "string" || body.userPrompt.trim() === "") {
    errors.push("userPrompt must be a non-empty string.");
  }

  if (!hasInlineInventory(body) && !hasInventorySessionId(body)) {
    errors.push("inventory or inventory_id is required.");
  }

  if (hasInlineInventory(body) && !Array.isArray(body.inventory?.items)) {
    errors.push("inventory.items must be an array.");
  }

  if (hasInventorySessionId(body) && typeof body.inventory_id !== "string") {
    errors.push("inventory_id must be a string.");
  }

  return errors;
}

export function validateSuggestionRequestBody(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return ["Request body must be a JSON object."];
  }

  if (!hasInlineInventory(body) && !hasInventorySessionId(body)) {
    return ["inventory or inventory_id is required."];
  }

  if (hasInlineInventory(body) && !Array.isArray(body.inventory?.items)) {
    return ["inventory.items must be an array."];
  }

  if (hasInventorySessionId(body) && typeof body.inventory_id !== "string") {
    return ["inventory_id must be a string."];
  }

  return [];
}

const REFINEMENT_IMAGE_MIME_TYPES = new Set(["image/png", "image/jpeg"]);
const MAX_REFINEMENT_IMAGE_BASE64_LENGTH = 12 * 1024 * 1024;

export function validateRefinementRequestBody(body) {
  const errors = [];

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return ["Request body must be a JSON object."];
  }

  if (typeof body.refinementId !== "string" || body.refinementId.trim() === "") {
    errors.push("refinementId must be a non-empty string.");
  }

  if (!body.image || typeof body.image !== "object" || Array.isArray(body.image)) {
    errors.push("image must be an object.");
  } else {
    if (!REFINEMENT_IMAGE_MIME_TYPES.has(body.image.mimeType)) {
      errors.push("image.mimeType must be image/png or image/jpeg.");
    }

    if (typeof body.image.data !== "string" || body.image.data.trim() === "") {
      errors.push("image.data must be a non-empty base64 string.");
    } else if (body.image.data.length > MAX_REFINEMENT_IMAGE_BASE64_LENGTH) {
      errors.push("image.data is too large.");
    } else if (
      body.image.data.length % 4 !== 0 ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(body.image.data)
    ) {
      errors.push("image.data must contain valid base64 without a data URL prefix.");
    }
  }

  return errors;
}

export async function resolveInventoryFromBody(body, store = getInventorySessionStore()) {
  if (hasInlineInventory(body)) {
    return body.inventory;
  }

  return store.load(body.inventory_id);
}

export function shouldStoreGeminiLogs(env = process.env) {
  return env.GEMINI_STORE_LOGS === "true";
}

function shouldUseBackboardGeneration(env = process.env) {
  return env.GENERATION_PROVIDER === "backboard";
}

export function createGenerationClientForBody({
  env = process.env,
  logger = getRuntimeLogger(),
} = {}) {
  const rawClient = shouldUseBackboardGeneration(env)
    ? createBackboardGenerationClient({
      apiKey: env.BACKBOARD_API_KEY,
      assistantId: env.BACKBOARD_ASSISTANT_ID,
      llmProvider: env.BACKBOARD_LLM_PROVIDER ?? "google",
      modelName: env.BACKBOARD_MODEL,
      memory: env.BACKBOARD_MEMORY ?? "off",
    })
    : createGeminiClient({
      apiKey: env.GEMINI_API_KEY,
      storeRequests: shouldStoreGeminiLogs(env),
    });

  return createLoggedGenerationClient({
    client: rawClient,
    logger,
  });
}

function sendSseHeaders(request, response) {
  response.writeHead(200, {
    ...corsHeadersForOrigin(request.headers.origin),
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
  });
}

function createFailureResult(stage, errors) {
  return {
    ok: false,
    stage,
    errors,
  };
}

async function createGenerationResult(body, onProgress, { streamPlacement = false } = {}) {
  const inventory = await resolveInventoryFromBody(body);
  const generationClient = createGenerationClientForBody({ body });
  const models = resolveGenerationModels(process.env);
  const userPrompt = body.userPrompt.trim();
  const streamedBrickIds = new Set();
  const trackProgress = async (event) => {
    if (event?.type === "brick" && typeof event.brick?.id === "string") {
      streamedBrickIds.add(event.brick.id);
    }
    await onProgress?.(event);
  };
  const result = await generateModel({
    userPrompt,
    inventory,
    targetPieceCount: body.targetPieceCount,
    generationClient,
    structureModel: models.structureModel,
    placementModel: models.placementModel,
    repairModel: models.repairModel,
    onProgress: trackProgress,
    streamPlacement,
  });

  if (!result.ok) {
    return result;
  }

  if (result.requiresRefinement === false || result.complete === true) {
    return {
      ...result,
      complete: true,
      requiresRefinement: false,
    };
  }

  const refinementSession = getRefinementSessionStore().create({
    userPrompt,
    inventory,
    targetPieceCount: result.targetPieceCount,
    structurePlan: result.structurePlan,
    originalModel: result.originalModel,
    cleanedModel: result.cleanedModel,
    removedBricks: result.removedBricks,
    validation: result.validation,
    streamedBrickIds: streamPlacement ? [...streamedBrickIds] : undefined,
  });

  return {
    ...result,
    complete: false,
    requiresRefinement: true,
    refinementId: refinementSession.refinementId,
    refinementExpiresAt: refinementSession.expiresAt,
    refinementEndpoint: "/api/generate/refine",
  };
}

async function createRefinementResult(body, onProgress, { streamRefinement = false } = {}) {
  const context = getRefinementSessionStore().consume(body.refinementId);
  const generationClient = createGenerationClientForBody({ body });

  return refineModel({
    userPrompt: context.userPrompt,
    inventory: context.inventory,
    targetPieceCount: context.targetPieceCount,
    structurePlan: context.structurePlan,
    originalModel: context.originalModel,
    streamedBrickIds: context.streamedBrickIds,
    image: body.image,
    generationClient,
    refinementModel: resolveRefinementModel(process.env),
    streamRefinement,
    onProgress,
  });
}

async function createSuggestionResult(body) {
  const inventory = await resolveInventoryFromBody(body);
  const generationClient = createGenerationClientForBody({ body });

  return generateBuildSuggestions({
    inventory,
    generationClient,
    suggestionModel: resolveSuggestionModel(process.env),
  });
}

async function handleCreateInventorySession(request, response) {
  let body;

  try {
    body = await readJson(request);
  } catch (error) {
    sendJson(request, response, 400, createFailureResult("request", [error.message]));
    return;
  }

  try {
    const session = await getInventorySessionStore().create(body.inventory);
    sendJson(request, response, 201, { ok: true, ...session });
  } catch (error) {
    sendJson(request, response, 400, createFailureResult("request", [error.message]));
  }
}

async function handleGenerateJson(request, response) {
  if (!process.env.GEMINI_API_KEY && !shouldUseBackboardGeneration(process.env)) {
    sendJson(
      request,
      response,
      500,
      createFailureResult("configuration", ["GEMINI_API_KEY is required."]),
    );
    return;
  }

  const body = await readJson(request);
  const requestErrors = validateRequestBody(body);

  if (requestErrors.length > 0) {
    sendJson(request, response, 400, createFailureResult("request", requestErrors));
    return;
  }

  const result = await createGenerationResult(body);

  sendJson(request, response, result.ok ? 202 : 422, result);
}

async function handleRefineGeneration(request, response) {
  if (!process.env.GEMINI_API_KEY && !shouldUseBackboardGeneration(process.env)) {
    sendJson(
      request,
      response,
      500,
      createFailureResult("configuration", ["GEMINI_API_KEY is required."]),
    );
    return;
  }

  let body;

  try {
    body = await readJson(request, { maxBytes: MAX_REFINEMENT_REQUEST_BYTES });
  } catch (error) {
    const statusCode = error instanceof RequestBodyTooLargeError ? 413 : 400;
    sendJson(request, response, statusCode, createFailureResult("request", [error.message]));
    return;
  }

  const requestErrors = validateRefinementRequestBody(body);

  if (requestErrors.length > 0) {
    sendJson(request, response, 400, createFailureResult("request", requestErrors));
    return;
  }

  const wantsStream = request.headers.accept?.includes("text/event-stream") || body.stream === true;
  if (wantsStream) {
    sendSseHeaders(request, response);
    try {
      const result = await createRefinementResult(body, (event) => {
        if (event.type === "brick" || event.type === "warning") {
          response.write(formatSseEvent(event.type, event));
        } else {
          response.write(formatSseEvent("progress", event));
        }
      }, { streamRefinement: true });
      response.write(formatSseEvent(result.ok ? "complete" : "failure", {
        phase: "repair",
        ok: result.ok,
      }));
      response.end(formatSseEvent("result", result));
    } catch (error) {
      if (error instanceof RefinementSessionError) {
        response.write(formatSseEvent("failure", { phase: "repair", error: error.message }));
        response.end(formatSseEvent("result", createFailureResult("refinement_session", [error.message])));
      } else {
        response.write(formatSseEvent("failure", { phase: "repair", error: error.message }));
        response.end(formatSseEvent("result", createFailureResult("refinement", [error.message])));
      }
    }
    return;
  }

  try {
    const result = await createRefinementResult(body);
    sendJson(request, response, result.ok ? 200 : 422, result);
  } catch (error) {
    if (error instanceof RefinementSessionError) {
      sendJson(
        request,
        response,
        error.statusCode,
        createFailureResult("refinement_session", [error.message]),
      );
      return;
    }

    throw error;
  }
}

async function handleSuggestBuilds(request, response) {
  let body;

  try {
    body = await readJson(request);
  } catch (error) {
    sendJson(request, response, 400, createFailureResult("request", [error.message]));
    return;
  }

  if (!process.env.GEMINI_API_KEY && !shouldUseBackboardGeneration(process.env)) {
    sendJson(
      request,
      response,
      500,
      createFailureResult("configuration", ["GEMINI_API_KEY is required."]),
    );
    return;
  }

  const requestErrors = validateSuggestionRequestBody(body);

  if (requestErrors.length > 0) {
    sendJson(request, response, 400, createFailureResult("request", requestErrors));
    return;
  }

  const result = await createSuggestionResult(body);

  sendJson(request, response, result.ok ? 200 : 422, result);
}

async function handleGenerateStream(request, response) {
  let body;

  try {
    body = await readJson(request);
  } catch (error) {
    sendSseHeaders(request, response);
    response.write(formatSseEvent("failure", { phase: "placement", error: error.message }));
    response.end(formatSseEvent("result", createFailureResult("request", [error.message])));
    return;
  }

  sendSseHeaders(request, response);

  if (!process.env.GEMINI_API_KEY && !shouldUseBackboardGeneration(process.env)) {
    response.write(formatSseEvent("failure", { phase: "placement", error: "GEMINI_API_KEY is required." }));
    response.end(
      formatSseEvent(
        "result",
        createFailureResult("configuration", ["GEMINI_API_KEY is required."]),
      ),
    );
    return;
  }

  const requestErrors = validateRequestBody(body);

  if (requestErrors.length > 0) {
    response.write(formatSseEvent("failure", { phase: "placement", error: requestErrors.join(" ") }));
    response.end(formatSseEvent("result", createFailureResult("request", requestErrors)));
    return;
  }

  try {
    const result = await createGenerationResult(body, (event) => {
      if (event.type === "brick" || event.type === "warning") {
        response.write(formatSseEvent(event.type, event));
        return;
      }
      if (event.type === "draft") {
        response.write(formatSseEvent("draft", event));
        return;
      }

      response.write(formatSseEvent("progress", event));
    }, { streamPlacement: true });

    response.write(formatSseEvent(result.ok ? "complete" : "failure", {
      phase: "placement",
      ok: result.ok,
    }));
    response.end(formatSseEvent("result", result));
  } catch (error) {
    response.write(formatSseEvent("failure", { phase: "placement", error: error.message }));
    response.end(formatSseEvent("result", createFailureResult("server", [error.message])));
  }
}

const server = createServer(async (request, response) => {
  if (request.method === "OPTIONS") {
    sendJson(request, response, 204, {});
    return;
  }

  if (request.method !== "POST") {
    sendJson(request, response, 404, { ok: false, errors: ["Not found."] });
    return;
  }

  if (request.url === "/api/generate/stream") {
    await handleGenerateStream(request, response);
    return;
  }

  try {
    if (request.url === "/api/generate") {
      await handleGenerateJson(request, response);
      return;
    }

    if (request.url === "/api/generate/refine") {
      await handleRefineGeneration(request, response);
      return;
    }

    if (request.url === "/api/suggest-builds") {
      await handleSuggestBuilds(request, response);
      return;
    }

    if (request.url === "/api/inventory-sessions") {
      await handleCreateInventorySession(request, response);
      return;
    }
  } catch (error) {
    sendJson(request, response, 500, {
      ok: false,
      stage: "server",
      errors: [error.message],
    });
    return;
  }

  sendJson(request, response, 404, { ok: false, errors: ["Not found."] });
});

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  const logger = getRuntimeLogger();
  server.listen(PORT, HOST, () => {
    console.log(`Generation service listening at http://${HOST}:${PORT}`);
    console.log(`Generation AI logs: ${logger.filePath}`);
  });
}
