import { createServer } from "node:http";
import { fileURLToPath } from "node:url";

import { corsHeadersForOrigin } from "./cors.js";
import { createGeminiClient } from "../src/generation/geminiClient.js";
import {
  resolveGenerationModels,
  resolveSuggestionModel,
} from "../src/generation/modelConfig.js";
import { generateBuildSuggestions, generateModel } from "../src/generation/service.js";
import { createBackboardGenerationClient } from "./backboardGenerationClient.js";
import { createInventorySessionStore } from "./inventorySessions.js";
import {
  createGenerationRuntimeLogger,
  createLoggedGenerationClient,
} from "./generationRuntimeLogger.js";

const HOST = "127.0.0.1";
const PORT = Number(process.env.GENERATION_PORT ?? 8787);
let runtimeLogger = null;
let inventorySessionStore = null;

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

async function readJson(request) {
  const chunks = [];

  for await (const chunk of request) {
    chunks.push(chunk);
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
  body,
  env = process.env,
  inventoryStore = getInventorySessionStore(),
  logger = getRuntimeLogger(),
} = {}) {
  const rawClient = shouldUseBackboardGeneration(env)
    ? createBackboardGenerationClient({
      apiKey: env.BACKBOARD_API_KEY,
      assistantId: env.BACKBOARD_ASSISTANT_ID,
      llmProvider: env.BACKBOARD_LLM_PROVIDER ?? "google",
      memory: env.BACKBOARD_MEMORY ?? "off",
      inventorySessionId: body.inventory_id,
      inlineInventory: body.inventory,
      inventoryStore,
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

async function createGenerationResult(body, onProgress) {
  const inventory = await resolveInventoryFromBody(body);
  const generationClient = createGenerationClientForBody({ body });
  const models = resolveGenerationModels(process.env);

  return generateModel({
    userPrompt: body.userPrompt.trim(),
    inventory,
    targetPieceCount: body.targetPieceCount,
    generationClient,
    structureModel: models.structureModel,
    placementModel: models.placementModel,
    repairModel: models.repairModel,
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

  sendJson(request, response, result.ok ? 200 : 422, result);
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
    response.end(formatSseEvent("result", createFailureResult("request", [error.message])));
    return;
  }

  sendSseHeaders(request, response);

  if (!process.env.GEMINI_API_KEY && !shouldUseBackboardGeneration(process.env)) {
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
    response.end(formatSseEvent("result", createFailureResult("request", requestErrors)));
    return;
  }

  try {
    const result = await createGenerationResult(body, (event) => {
      if (event.type === "draft") {
        response.write(formatSseEvent("draft", event));
        return;
      }

      response.write(formatSseEvent("progress", event));
    });

    response.end(formatSseEvent("result", result));
  } catch (error) {
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
