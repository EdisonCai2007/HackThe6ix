# No-git review package: Task 4 second re-review

## Files changed
- server/generationServer.js
- src/preview/main.js
- test/server/generationServerEvents.test.js

## server/generationServer.js

```js
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";

import { corsHeadersForOrigin } from "./cors.js";
import { createGeminiClient } from "../src/generation/geminiClient.js";
import { resolveGenerationModels } from "../src/generation/modelConfig.js";
import { generateModel } from "../src/generation/service.js";

const HOST = "127.0.0.1";
const PORT = Number(process.env.GENERATION_PORT ?? 8787);

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

function validateRequestBody(body) {
  const errors = [];

  if (!body || typeof body !== "object") {
    return ["Request body must be a JSON object."];
  }

  if (typeof body.userPrompt !== "string" || body.userPrompt.trim() === "") {
    errors.push("userPrompt must be a non-empty string.");
  }

  if (!body.inventory || !Array.isArray(body.inventory.items)) {
    errors.push("inventory.items must be an array.");
  }

  return errors;
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
  const generationClient = createGeminiClient({
    apiKey: process.env.GEMINI_API_KEY,
  });
  const models = resolveGenerationModels(process.env);

  return generateModel({
    userPrompt: body.userPrompt.trim(),
    inventory: body.inventory,
    targetPieceCount: body.targetPieceCount,
    generationClient,
    structureModel: models.structureModel,
    placementModel: models.placementModel,
    onProgress,
  });
}

async function handleGenerateJson(request, response) {
  if (!process.env.GEMINI_API_KEY) {
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

  if (!process.env.GEMINI_API_KEY) {
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
  server.listen(PORT, HOST, () => {
    console.log(`Generation service listening at http://${HOST}:${PORT}`);
  });
}

```

## src/preview/main.js

```js
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { LDrawLoader } from "three/addons/loaders/LDrawLoader.js";
import { LDrawConditionalLineMaterial } from "three/addons/materials/LDrawConditionalLineMaterial.js";

import { carInventory } from "../generation/fixtures/carInventory.js";
import { daisyInventory } from "../generation/fixtures/daisyInventory.js";
import { duckInventory } from "../generation/fixtures/duckInventory.js";
import { horseInventory } from "../generation/fixtures/horseInventory.js";
import { houseFlyInventory } from "../generation/fixtures/houseFlyInventory.js";
import { sandcastleInventory } from "../generation/fixtures/sandcastleInventory.js";
import { buildSmallDuckModel } from "../generation/fixtures/smallDuckModel.js";
import { validateGeneratedModelShape } from "../generation/generatedModelSchema.js";
import { validateModel } from "../generation/validator.js";
import { exportModelToLDraw } from "../ldraw/exportLDraw.js";

const canvas = document.querySelector("#preview-canvas");
const modelName = document.querySelector("#model-name");
const pieceCount = document.querySelector("#piece-count");
const validationStatus = document.querySelector("#validation-status");
const form = document.querySelector("#generation-form");
const promptInput = document.querySelector("#prompt-input");
const inventorySelect = document.querySelector("#inventory-select");
const targetPiecesInput = document.querySelector("#target-pieces");
const generateButton = document.querySelector("#generate-button");
const notesList = document.querySelector("#generation-notes");
const validationErrors = document.querySelector("#validation-errors");
const timelineList = document.querySelector("#generation-timeline");

const timelineStages = [
  { id: "structure_generate", label: "Structure generation" },
  { id: "structure_parse", label: "Structure JSON parse" },
  { id: "structure_repair", label: "Structure JSON repair" },
  { id: "placement_generate", label: "Placement generation" },
  { id: "placement_parse", label: "Placement JSON parse" },
  { id: "placement_repair", label: "Placement JSON repair" },
  { id: "validation", label: "Validation" },
  { id: "validation_repair", label: "Validation repair" },
];

const timelineStatusLabels = {
  pending: "Pending",
  running: "Running",
  complete: "Complete",
  skipped: "Skipped",
  failed: "Failed",
};

const resultStageTimelineMap = {
  structure_parse: "structure_repair",
  placement_parse: "placement_repair",
  placement_shape: "validation",
  validation: "validation",
  validation_repair_parse: "validation_repair",
  validation_repair_shape: "validation_repair",
};

let timelineState = timelineStages.map((stage) => ({
  ...stage,
  status: "pending",
}));

const inventories = [
  { id: "duck", label: "Duck demo pieces", inventory: duckInventory },
  { id: "car", label: "Car demo pieces", inventory: carInventory },
  { id: "daisy", label: "Daisy demo pieces", inventory: daisyInventory },
  { id: "horse", label: "Horse demo pieces", inventory: horseInventory },
  { id: "house-fly", label: "House fly demo pieces", inventory: houseFlyInventory },
  { id: "sandcastle", label: "Sandcastle demo pieces", inventory: sandcastleInventory },
];

for (const option of inventories) {
  const element = document.createElement("option");
  element.value = option.id;
  element.textContent = option.label;
  inventorySelect.append(element);
}

function selectedInventory() {
  return inventories.find((entry) => entry.id === inventorySelect.value)?.inventory ?? duckInventory;
}

function renderTimeline() {
  timelineList.replaceChildren();

  for (const stage of timelineState) {
    const item = document.createElement("li");
    item.className = "timeline-stage";
    item.dataset.status = stage.status;

    const marker = document.createElement("span");
    marker.className = "timeline-marker";
    marker.setAttribute("aria-hidden", "true");

    const label = document.createElement("span");
    label.className = "timeline-label";
    label.textContent = stage.label;

    const status = document.createElement("span");
    status.className = "timeline-status";
    status.textContent = timelineStatusLabels[stage.status] ?? stage.status;

    item.append(marker, label, status);
    timelineList.append(item);
  }
}

function resetTimeline() {
  timelineState = timelineStages.map((stage) => ({
    ...stage,
    status: "pending",
  }));
  renderTimeline();
}

function updateTimelineStage(stageId, status) {
  timelineState = timelineState.map((stage) =>
    stage.id === stageId ? { ...stage, status } : stage,
  );
  renderTimeline();
}

function markTimelineFailureFromResult(stage) {
  if (timelineState.some((timelineStage) => timelineStage.status === "failed")) {
    return;
  }

  const timelineStage = resultStageTimelineMap[stage];

  if (timelineStage) {
    updateTimelineStage(timelineStage, "failed");
  }
}

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  alpha: true,
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x111318);

const camera = new THREE.PerspectiveCamera(
  45,
  window.innerWidth / window.innerHeight,
  0.1,
  3000,
);
camera.position.set(180, 150, 230);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.target.set(20, -40, 35);
controls.minDistance = 90;
controls.maxDistance = 650;

const hemiLight = new THREE.HemisphereLight(0xffffff, 0x252a32, 1.8);
scene.add(hemiLight);

const keyLight = new THREE.DirectionalLight(0xffffff, 2.2);
keyLight.position.set(180, 260, 140);
keyLight.castShadow = true;
scene.add(keyLight);

const fillLight = new THREE.DirectionalLight(0x8fb7ff, 0.9);
fillLight.position.set(-160, 90, -120);
scene.add(fillLight);

const grid = new THREE.GridHelper(420, 21, 0x445064, 0x252b35);
grid.position.y = 8;
scene.add(grid);

let currentModelGroup = null;

function clearCurrentModel() {
  if (!currentModelGroup) {
    return;
  }

  scene.remove(currentModelGroup);
  currentModelGroup.traverse((child) => {
    child.geometry?.dispose?.();
    if (Array.isArray(child.material)) {
      child.material.forEach((material) => material.dispose?.());
    } else {
      child.material?.dispose?.();
    }
  });
  currentModelGroup = null;
}

function renderModel(model) {
  const loader = new LDrawLoader();
  loader.setConditionalLineMaterial(LDrawConditionalLineMaterial);
  const ldrawText = exportModelToLDraw(model);

  loader.parse(
    ldrawText,
    (group) => {
      clearCurrentModel();
      group.rotation.x = Math.PI;
      group.traverse((child) => {
        if (child.isMesh) {
          child.castShadow = true;
          child.receiveShadow = true;
        }
      });

      const box = new THREE.Box3().setFromObject(group);
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());
      group.position.sub(center);

      scene.add(group);
      currentModelGroup = group;
      controls.target.set(0, 0, 0);

      const maxDimension = Math.max(size.x, size.y, size.z);
      const fov = THREE.MathUtils.degToRad(camera.fov);
      const distance = (maxDimension / (2 * Math.tan(fov / 2))) * 1.45;
      const viewDirection = new THREE.Vector3(1.1, 0.75, 1.35).normalize();

      camera.position.copy(viewDirection.multiplyScalar(distance));
      camera.near = Math.max(0.1, distance / 100);
      camera.far = distance * 10;
      camera.updateProjectionMatrix();
      controls.minDistance = distance * 0.35;
      controls.maxDistance = distance * 2.2;
      controls.update();
    },
    (error) => {
      validationStatus.textContent = "Load error";
      validationErrors.hidden = false;
      validationErrors.textContent = error.message;
    },
  );
}

function setNotes(notes) {
  notesList.replaceChildren();

  for (const note of notes ?? []) {
    const item = document.createElement("li");
    item.textContent = note;
    notesList.append(item);
  }
}

function showErrors(errors) {
  validationErrors.hidden = false;
  validationErrors.textContent = JSON.stringify(errors, null, 2);
}

function hideErrors() {
  validationErrors.hidden = true;
  validationErrors.textContent = "";
}

function showModel(model, validation, options = {}) {
  modelName.textContent = model.model_name;
  pieceCount.textContent = String(model.piece_count);
  validationStatus.textContent =
    options.statusText ?? (validation.valid ? "Valid" : "Invalid");
  setNotes(model.notes);

  if (validation.valid || options.hideErrors) {
    hideErrors();
  } else {
    showErrors(validation.errors);
  }

  renderModel(model);
}

async function requestGeneration() {
  const response = await fetch("http://127.0.0.1:8787/api/generate/stream", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      userPrompt: promptInput.value,
      inventory: selectedInventory(),
      targetPieceCount: Number(targetPiecesInput.value),
    }),
  });

  const result = await readGenerationStream(response);

  if (!response.ok || !result.ok) {
    throw result;
  }

  return result;
}

function parseSseBlock(block) {
  const lines = block.split("\n");
  let eventName = "message";
  const dataLines = [];

  for (const line of lines) {
    if (line.startsWith("event:")) {
      eventName = line.slice("event:".length).trim();
    } else if (line.startsWith("data:")) {
      dataLines.push(line.slice("data:".length).trimStart());
    }
  }

  if (dataLines.length === 0) {
    return null;
  }

  return {
    eventName,
    payload: JSON.parse(dataLines.join("\n")),
  };
}

function handleSseBlock(block) {
  if (block.trim() === "") {
    return undefined;
  }

  const event = parseSseBlock(block);

  if (!event) {
    return undefined;
  }

  if (event.eventName === "progress") {
    updateTimelineStage(event.payload.stage, event.payload.status);
    return undefined;
  }

  if (event.eventName === "draft") {
    handleDraftEvent(event.payload);
    return undefined;
  }

  if (event.eventName === "result") {
    return event.payload;
  }

  return undefined;
}

function handleDraftEvent(payload) {
  const shapeResult = validateGeneratedModelShape(payload.model);

  if (!shapeResult.ok) {
    validationStatus.textContent = "Draft shape error";
    showErrors(shapeResult.errors);
    return;
  }

  const validation = payload.validation ?? {
    valid: false,
    errors: [],
    warnings: [],
    inventory_usage: [],
  };

  try {
    showModel(payload.model, validation, {
      statusText: payload.stage === "pruned_draft" ? "Repairing pruned draft" : "Repairing draft",
      hideErrors: payload.stage === "placement_draft",
    });
  } catch (error) {
    validationStatus.textContent = "Draft render error";
    showErrors([error?.message ?? "Unknown draft render error"]);
  }
}

async function readGenerationStream(response) {
  if (!response.body) {
    throw new Error("Generation response did not include a readable stream.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let result;

  for (;;) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });

    const blocks = buffer.split("\n\n");
    buffer = blocks.pop() ?? "";

    for (const block of blocks) {
      result = handleSseBlock(block) ?? result;
    }

    if (done) {
      break;
    }
  }

  result = handleSseBlock(buffer) ?? result;

  if (!result) {
    throw new Error("Generation stream ended without a result event.");
  }

  return result;
}

function resize() {
  const width = window.innerWidth;
  const height = window.innerHeight;

  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height);
}

window.addEventListener("resize", resize);

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  generateButton.disabled = true;
  validationStatus.textContent = "Generating";
  modelName.textContent = "Calling Gemini";
  pieceCount.textContent = "-";
  setNotes([]);
  hideErrors();
  resetTimeline();

  try {
    const result = await requestGeneration();
    showModel(result.model, result.validation);
  } catch (error) {
    validationStatus.textContent = "Failed";
    if (!currentModelGroup) {
      modelName.textContent = "Generation failed";
      pieceCount.textContent = "-";
      setNotes([]);
    }
    markTimelineFailureFromResult(error.stage);
    showErrors(error.errors ?? [error.message ?? "Unknown generation error"]);
  } finally {
    generateButton.disabled = false;
  }
});

const initialModel = buildSmallDuckModel(duckInventory);
const initialValidation = validateModel(initialModel, duckInventory);
renderTimeline();
showModel(initialModel, initialValidation);

function animate() {
  controls.update();
  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}

animate();

```

## test/server/generationServerEvents.test.js

```js
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { formatSseEvent } from "../../server/generationServer.js";

describe("generation server SSE events", () => {
  it("formats named SSE events with a JSON payload", () => {
    const event = formatSseEvent("progress", {
      stage: "validation",
      status: "running",
    });

    assert.equal(
      event,
      'event: progress\ndata: {"stage":"validation","status":"running"}\n\n',
    );
  });

  it("formats draft SSE events with model payloads", () => {
    const event = formatSseEvent("draft", {
      type: "draft",
      stage: "placement_draft",
      model: { model_name: "Draft Duck" },
    });

    assert.equal(
      event,
      'event: draft\ndata: {"type":"draft","stage":"placement_draft","model":{"model_name":"Draft Duck"}}\n\n',
    );
  });
});

```
