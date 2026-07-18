# Live OpenRouter LEGO Generation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the live two-call OpenRouter LEGO generation path and wire it into the local Three.js preview.

**Architecture:** Add small schema and prompt modules in `src/generation`, then orchestrate two OpenRouter chat calls through a local Node HTTP service so the browser never sees the API key. The frontend sends prompt and inventory to the service, receives a validator-approved `GeneratedModel`, exports it with the existing LDraw exporter, and refreshes the Three.js scene.

**Tech Stack:** JavaScript ES modules, Node 20+ built-in `fetch`, Node `node:test`, Vite, Three.js, existing LDraw export pipeline.

## Global Constraints

- Main generation action uses live OpenRouter calls; automated tests use injected test doubles only.
- API key must stay in the local Node service and must not be imported into browser code.
- AI output must be JSON only.
- AI must not output meshes, arbitrary geometry, or raw LDraw.
- AI placement output must match the repo's internal `GeneratedModel` shape.
- Validation remains the authority for buildability.
- No repair loop in this pass.
- No silent fixture fallback when AI output is invalid.
- Set `MAX_MODEL_PIECES` to the documented MVP hard cap of `50`.
- Use only supported parts from `src/generation/partCatalog.js`.
- Tests must run with `node --test`.
- The current folder is not a git checkout, so replace commit steps with a blocked-commit note until `.git` is restored.

---

## File Structure

- `src/generation/designPlan.js`
  - Parses JSON text and validates the first OpenRouter structure-plan shape.
- `src/generation/generatedModelSchema.js`
  - Validates required `GeneratedModel` fields before running the existing validator.
- `src/generation/openRouterPrompts.js`
  - Builds the two OpenRouter request bodies and supported inventory summaries.
- `src/generation/generationClient.js`
  - Sends chat-completion requests to OpenRouter and extracts message content.
- `src/generation/service.js`
  - Orchestrates structure call, placement call, shape checks, and validator.
- `server/generationServer.js`
  - Dependency-free local HTTP API for `/api/generate` and `OPTIONS` CORS preflight.
- `src/generation/partCatalog.js`
  - Changes `MAX_MODEL_PIECES` from `100` to `50`.
- `index.html`
  - Adds prompt, inventory, generate button, notes, and validation error containers.
- `src/preview/main.js`
  - Imports fixture inventories for selection, calls the local service, and re-renders generated models.
- `src/preview/styles.css`
  - Adds compact app controls without hiding the 3D viewer.
- `package.json`
  - Adds a `serve:generation` script.
- `test/generation/designPlan.test.js`
  - Tests JSON parsing and structure-plan validation.
- `test/generation/generatedModelSchema.test.js`
  - Tests required `GeneratedModel` shape checks.
- `test/generation/openRouterPrompts.test.js`
  - Tests both prompt builders.
- `test/generation/service.test.js`
  - Tests orchestration with injected OpenRouter test doubles.

---

### Task 1: Schema Guards And Piece Cap

**Files:**
- Create: `src/generation/designPlan.js`
- Create: `src/generation/generatedModelSchema.js`
- Create: `test/generation/designPlan.test.js`
- Create: `test/generation/generatedModelSchema.test.js`
- Modify: `src/generation/partCatalog.js`
- Modify: `test/generation/partCatalog.test.js`

**Interfaces:**
- Produces: `parseJsonObject(text, label)`
- Produces: `validateStructurePlan(plan)`
- Produces: `parseStructurePlanText(text)`
- Produces: `validateGeneratedModelShape(model)`
- Updates: `MAX_MODEL_PIECES` to `50`

- [ ] **Step 1: Write failing design-plan tests**

Create `test/generation/designPlan.test.js`:

```js
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  parseJsonObject,
  parseStructurePlanText,
  validateStructurePlan,
} from "../../src/generation/designPlan.js";

const validPlan = {
  model_name: "Small Duck",
  primary_object: "duck",
  target_piece_count: 15,
  overall_shape: "Small blocky duck with body, head, beak, and eyes.",
  required_features: [
    {
      name: "body",
      visual_goal: "Wide low yellow body",
      priority: "required",
      preferred_colors: ["yellow"],
      approximate_piece_budget: 6,
    },
  ],
  part_usage_plan: [
    {
      feature: "body",
      allowed_part_ids: ["3001", "3003"],
      allowed_color_ids: ["14"],
      max_pieces: 6,
      notes: "Use larger yellow bricks for the body.",
    },
  ],
  build_strategy: {
    base: "Use plates for a stable footprint.",
    body: "Keep the body wider than the head.",
    raised_details: "Place details on supported bricks.",
    stability_notes: "Avoid unsupported overhangs.",
  },
  fallback_priorities: ["Keep body, head, and beak."],
  user_facing_summary: "I planned a small duck.",
};

describe("design plan schema", () => {
  it("parses JSON object text", () => {
    const result = parseJsonObject(JSON.stringify(validPlan), "structure plan");

    assert.equal(result.ok, true);
    assert.equal(result.value.primary_object, "duck");
  });

  it("rejects malformed JSON text", () => {
    const result = parseJsonObject("{ nope", "structure plan");

    assert.equal(result.ok, false);
    assert.match(result.errors[0].message, /Invalid structure plan JSON/);
  });

  it("accepts a complete structure plan", () => {
    const result = validateStructurePlan(validPlan);

    assert.equal(result.ok, true);
    assert.deepEqual(result.errors, []);
  });

  it("rejects a structure plan missing required arrays", () => {
    const result = validateStructurePlan({
      ...validPlan,
      required_features: [],
      part_usage_plan: "body pieces",
    });

    assert.equal(result.ok, false);
    assert.equal(result.errors.some((error) => error.field === "required_features"), true);
    assert.equal(result.errors.some((error) => error.field === "part_usage_plan"), true);
  });

  it("parses and validates structure plan text in one call", () => {
    const result = parseStructurePlanText(JSON.stringify(validPlan));

    assert.equal(result.ok, true);
    assert.equal(result.value.model_name, "Small Duck");
  });
});
```

- [ ] **Step 2: Write failing generated-model schema tests**

Create `test/generation/generatedModelSchema.test.js`:

```js
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { validateGeneratedModelShape } from "../../src/generation/generatedModelSchema.js";

const validModel = {
  model_name: "Small Duck",
  prompt: "build me a duck",
  piece_count: 1,
  dimensions: { width_studs: 2, depth_studs: 4, height_layers: 3 },
  created_from_inventory_id: "duck-demo",
  generator_version: "openrouter-test",
  bricks: [
    {
      id: "body-1",
      part_id: "3001",
      ldraw_id: "3001.dat",
      label: "2x4 brick",
      color_id: "14",
      color_name: "yellow",
      position: { x: 0, y: 0, z: 0 },
      rotation: 0,
      feature: "body",
      step: 1,
    },
  ],
  notes: ["Valid shape for schema tests."],
};

describe("generated model schema", () => {
  it("accepts a GeneratedModel-shaped object", () => {
    const result = validateGeneratedModelShape(validModel);

    assert.equal(result.ok, true);
    assert.deepEqual(result.errors, []);
  });

  it("rejects missing model metadata", () => {
    const result = validateGeneratedModelShape({
      ...validModel,
      model_name: "",
      created_from_inventory_id: undefined,
    });

    assert.equal(result.ok, false);
    assert.equal(result.errors.some((error) => error.field === "model_name"), true);
    assert.equal(result.errors.some((error) => error.field === "created_from_inventory_id"), true);
  });

  it("rejects malformed brick fields before validator runs", () => {
    const result = validateGeneratedModelShape({
      ...validModel,
      bricks: [{ ...validModel.bricks[0], position: { x: 0, y: 0 }, rotation: 45 }],
    });

    assert.equal(result.ok, false);
    assert.equal(result.errors.some((error) => error.field === "bricks[0].position.z"), true);
    assert.equal(result.errors.some((error) => error.field === "bricks[0].rotation"), true);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `node --test test/generation/designPlan.test.js test/generation/generatedModelSchema.test.js`

Expected: FAIL with module-not-found errors for `designPlan.js` and `generatedModelSchema.js`.

- [ ] **Step 4: Implement `designPlan.js`**

Create `src/generation/designPlan.js`:

```js
function issue(field, message) {
  return { field, message };
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function requireString(plan, field, errors) {
  if (typeof plan[field] !== "string" || plan[field].trim() === "") {
    errors.push(issue(field, `${field} must be a non-empty string.`));
  }
}

function requirePositiveNumber(plan, field, errors) {
  if (!Number.isFinite(plan[field]) || plan[field] <= 0) {
    errors.push(issue(field, `${field} must be a positive number.`));
  }
}

function requireNonEmptyArray(plan, field, errors) {
  if (!Array.isArray(plan[field]) || plan[field].length === 0) {
    errors.push(issue(field, `${field} must be a non-empty array.`));
  }
}

export function parseJsonObject(text, label) {
  try {
    const value = JSON.parse(text);

    if (!isPlainObject(value)) {
      return {
        ok: false,
        errors: [issue(label, `${label} JSON must be an object.`)],
      };
    }

    return { ok: true, value, errors: [] };
  } catch (error) {
    return {
      ok: false,
      errors: [issue(label, `Invalid ${label} JSON: ${error.message}`)],
    };
  }
}

export function validateStructurePlan(plan) {
  const errors = [];

  if (!isPlainObject(plan)) {
    return {
      ok: false,
      errors: [issue("structure_plan", "Structure plan must be an object.")],
    };
  }

  for (const field of ["model_name", "primary_object", "overall_shape", "user_facing_summary"]) {
    requireString(plan, field, errors);
  }

  requirePositiveNumber(plan, "target_piece_count", errors);
  requireNonEmptyArray(plan, "required_features", errors);
  requireNonEmptyArray(plan, "part_usage_plan", errors);
  requireNonEmptyArray(plan, "fallback_priorities", errors);

  if (!isPlainObject(plan.build_strategy)) {
    errors.push(issue("build_strategy", "build_strategy must be an object."));
  }

  return {
    ok: errors.length === 0,
    errors,
  };
}

export function parseStructurePlanText(text) {
  const parsed = parseJsonObject(text, "structure plan");

  if (!parsed.ok) {
    return parsed;
  }

  const validation = validateStructurePlan(parsed.value);

  return {
    ok: validation.ok,
    value: validation.ok ? parsed.value : undefined,
    errors: validation.errors,
  };
}
```

- [ ] **Step 5: Implement `generatedModelSchema.js`**

Create `src/generation/generatedModelSchema.js`:

```js
const VALID_ROTATIONS = new Set([0, 90, 180, 270]);

function issue(field, message) {
  return { field, message };
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function requireString(value, field, errors) {
  if (typeof value !== "string" || value.trim() === "") {
    errors.push(issue(field, `${field} must be a non-empty string.`));
  }
}

function requireNumber(value, field, errors) {
  if (!Number.isFinite(value)) {
    errors.push(issue(field, `${field} must be a finite number.`));
  }
}

function validateDimensions(dimensions, errors) {
  if (!isPlainObject(dimensions)) {
    errors.push(issue("dimensions", "dimensions must be an object."));
    return;
  }

  for (const field of ["width_studs", "depth_studs", "height_layers"]) {
    requireNumber(dimensions[field], `dimensions.${field}`, errors);
  }
}

function validatePosition(position, index, errors) {
  if (!isPlainObject(position)) {
    errors.push(issue(`bricks[${index}].position`, "position must be an object."));
    return;
  }

  for (const axis of ["x", "y", "z"]) {
    requireNumber(position[axis], `bricks[${index}].position.${axis}`, errors);
  }
}

function validateBrick(brick, index, errors) {
  if (!isPlainObject(brick)) {
    errors.push(issue(`bricks[${index}]`, "brick must be an object."));
    return;
  }

  for (const field of [
    "id",
    "part_id",
    "ldraw_id",
    "label",
    "color_id",
    "color_name",
    "feature",
  ]) {
    requireString(brick[field], `bricks[${index}].${field}`, errors);
  }

  validatePosition(brick.position, index, errors);

  if (!VALID_ROTATIONS.has(brick.rotation)) {
    errors.push(issue(`bricks[${index}].rotation`, "rotation must be 0, 90, 180, or 270."));
  }

  if (!Number.isInteger(brick.step) || brick.step <= 0) {
    errors.push(issue(`bricks[${index}].step`, "step must be a positive integer."));
  }
}

export function validateGeneratedModelShape(model) {
  const errors = [];

  if (!isPlainObject(model)) {
    return {
      ok: false,
      errors: [issue("model", "Generated model must be an object.")],
    };
  }

  for (const field of [
    "model_name",
    "prompt",
    "created_from_inventory_id",
    "generator_version",
  ]) {
    requireString(model[field], field, errors);
  }

  if (!Number.isInteger(model.piece_count) || model.piece_count < 0) {
    errors.push(issue("piece_count", "piece_count must be a non-negative integer."));
  }

  validateDimensions(model.dimensions, errors);

  if (!Array.isArray(model.bricks)) {
    errors.push(issue("bricks", "bricks must be an array."));
  } else {
    model.bricks.forEach((brick, index) => validateBrick(brick, index, errors));
  }

  if (!Array.isArray(model.notes)) {
    errors.push(issue("notes", "notes must be an array."));
  }

  return {
    ok: errors.length === 0,
    errors,
  };
}
```

- [ ] **Step 6: Change the piece cap**

Modify `src/generation/partCatalog.js`:

```js
export const MAX_MODEL_PIECES = 50;
```

- [ ] **Step 7: Ensure the part catalog test expects 50**

If `test/generation/partCatalog.test.js` already asserts the cap, update it to:

```js
assert.equal(MAX_MODEL_PIECES, 50);
```

If it does not assert the cap, add this test:

```js
it("uses the documented MVP max model piece count", () => {
  assert.equal(MAX_MODEL_PIECES, 50);
});
```

- [ ] **Step 8: Run task tests**

Run: `node --test test/generation/designPlan.test.js test/generation/generatedModelSchema.test.js test/generation/partCatalog.test.js`

Expected: PASS.

- [ ] **Step 9: Record blocked commit**

Run: `git status --short`

Expected: FAIL with `fatal: not a git repository`. Record in the task handoff that commit is blocked until `.git` is restored.

---

### Task 2: OpenRouter Prompt Builders

**Files:**
- Create: `src/generation/openRouterPrompts.js`
- Create: `test/generation/openRouterPrompts.test.js`

**Interfaces:**
- Consumes: `MAX_MODEL_PIECES` and `SUPPORTED_PARTS` from `src/generation/partCatalog.js`
- Produces: `summarizeSupportedInventory(inventory)`
- Produces: `buildStructurePrompt({ userPrompt, inventory, targetPieceCount, model })`
- Produces: `buildPlacementPrompt({ userPrompt, inventory, structurePlan, targetPieceCount, model })`

- [ ] **Step 1: Write failing prompt-builder tests**

Create `test/generation/openRouterPrompts.test.js`:

```js
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { duckInventory } from "../../src/generation/fixtures/duckInventory.js";
import {
  buildPlacementPrompt,
  buildStructurePrompt,
  summarizeSupportedInventory,
} from "../../src/generation/openRouterPrompts.js";

const structurePlan = {
  model_name: "Small Duck",
  primary_object: "duck",
  target_piece_count: 15,
  overall_shape: "Small blocky duck with a body, head, and beak.",
  required_features: [{ name: "body", priority: "required" }],
  part_usage_plan: [{ feature: "body", allowed_part_ids: ["3001"], max_pieces: 4 }],
  build_strategy: { base: "Stable base" },
  fallback_priorities: ["Keep the duck body."],
  user_facing_summary: "I planned a duck.",
};

describe("OpenRouter prompt builders", () => {
  it("summarizes only supported inventory fields needed by the model", () => {
    const summary = summarizeSupportedInventory(duckInventory);

    assert.equal(summary.inventory_id, "duck-demo");
    assert.equal(summary.items.some((item) => item.part_id === "3001"), true);
    assert.equal(summary.items.every((item) => item.supported === true), true);
    assert.equal(summary.items.every((item) => "count" in item), true);
  });

  it("builds the structure-planner request with JSON-only and cap rules", () => {
    const request = buildStructurePrompt({
      userPrompt: "build me a duck",
      inventory: duckInventory,
      targetPieceCount: 15,
    });

    const text = request.messages.map((message) => message.content).join("\n");

    assert.equal(request.model, "env-configured-model");
    assert.match(text, /build me a duck/);
    assert.match(text, /Output valid JSON only/);
    assert.match(text, /Do not output exact brick coordinates/);
    assert.match(text, /50-piece MVP cap/);
    assert.match(text, /duck-demo/);
    assert.equal(request.response_format.type, "json_object");
  });

  it("builds the placement-planner request for GeneratedModel JSON, not LDraw", () => {
    const request = buildPlacementPrompt({
      userPrompt: "build me a duck",
      inventory: duckInventory,
      structurePlan,
      targetPieceCount: 15,
    });

    const text = request.messages.map((message) => message.content).join("\n");

    assert.match(text, /GeneratedModel/);
    assert.match(text, /Do not output raw LDraw/);
    assert.match(text, /Do not output meshes/);
    assert.match(text, /position/);
    assert.match(text, /rotation/);
    assert.match(text, /plates are 1 layer tall and bricks are 3 layers tall/);
    assert.match(text, /3001/);
    assert.equal(request.model, "env-configured-model");
    assert.equal(request.response_format.type, "json_object");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/generation/openRouterPrompts.test.js`

Expected: FAIL with module-not-found error for `openRouterPrompts.js`.

- [ ] **Step 3: Implement prompt builders**

Create `src/generation/openRouterPrompts.js`:

```js
import { MAX_MODEL_PIECES, SUPPORTED_PARTS } from "./partCatalog.js";

// Historical note: current runtime model selection is env-only.

function clampTargetPieceCount(targetPieceCount) {
  if (!Number.isFinite(targetPieceCount)) {
    return Math.min(40, MAX_MODEL_PIECES);
  }

  return Math.max(1, Math.min(Math.floor(targetPieceCount), MAX_MODEL_PIECES));
}

export function summarizeSupportedInventory(inventory) {
  return {
    inventory_id: inventory.inventory_id,
    source: inventory.source,
    items: inventory.items
      .filter((item) => item.supported && SUPPORTED_PARTS[item.part_id])
      .map((item) => ({
        label: item.label,
        category: item.category,
        part_id: item.part_id,
        ldraw_id: item.ldraw_id,
        color_name: item.color_name,
        color_id: item.color_id,
        count: item.count,
        supported: true,
        dimensions: {
          width: SUPPORTED_PARTS[item.part_id].width,
          depth: SUPPORTED_PARTS[item.part_id].depth,
          height_layers: SUPPORTED_PARTS[item.part_id].category === "plate" ? 1 : 3,
        },
      })),
  };
}

export function buildStructurePrompt({
  userPrompt,
  inventory,
  targetPieceCount,
  model,
}) {
  const cappedTarget = clampTargetPieceCount(targetPieceCount);
  const inventorySummary = summarizeSupportedInventory(inventory);

  return {
    model,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: [
          "You are a LEGO model planning agent for a local LEGO generation app.",
          "Your job is to convert a user's request and confirmed LEGO inventory into a high-level build plan.",
          "Output valid JSON only. No markdown, no commentary.",
          "Do not output exact brick coordinates.",
          "Do not output LDraw.",
          "Do not output meshes, vertices, or arbitrary 3D geometry.",
          "Do not invent parts, colors, or quantities outside the provided inventory.",
          "The generated model must be one small free-standing connected LEGO object, not a scene.",
          `Prefer 10-40 pieces and never exceed the requested target count or the ${MAX_MODEL_PIECES}-piece MVP cap.`,
          "Prioritize recognizable silhouette, required object features, inventory availability, stable construction, and color match in that order.",
        ].join("\n"),
      },
      {
        role: "user",
        content: JSON.stringify(
          {
            user_prompt: userPrompt,
            target_piece_count: cappedTarget,
            inventory: inventorySummary,
            required_output_shape: {
              model_name: "string",
              primary_object: "string",
              target_piece_count: "number",
              overall_shape: "string",
              required_features: [
                {
                  name: "string",
                  visual_goal: "string",
                  priority: "required | optional",
                  preferred_colors: ["string"],
                  approximate_piece_budget: "number",
                },
              ],
              part_usage_plan: [
                {
                  feature: "string",
                  allowed_part_ids: ["string"],
                  allowed_color_ids: ["string"],
                  max_pieces: "number",
                  notes: "string",
                },
              ],
              build_strategy: {
                base: "string",
                body: "string",
                raised_details: "string",
                stability_notes: "string",
              },
              fallback_priorities: ["string"],
              user_facing_summary: "string",
            },
          },
          null,
          2,
        ),
      },
    ],
  };
}

export function buildPlacementPrompt({
  userPrompt,
  inventory,
  structurePlan,
  targetPieceCount,
  model,
}) {
  const cappedTarget = clampTargetPieceCount(targetPieceCount ?? structurePlan.target_piece_count);
  const inventorySummary = summarizeSupportedInventory(inventory);

  return {
    model,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: [
          "You are a LEGO placement planner for a local LEGO generation app.",
          "Convert a high-level LEGO structure plan into exact internal GeneratedModel JSON.",
          "Output valid JSON only. No markdown, no commentary.",
          "Do not output raw LDraw.",
          "Do not output meshes, vertices, or arbitrary 3D geometry.",
          "Use only parts and colors present in the inventory.",
          "Do not exceed inventory quantities.",
          `Do not exceed ${MAX_MODEL_PIECES} pieces or the requested target count.`,
          "Use x and y as stud-grid positions.",
          "Use z as layer height; plates are 1 layer tall and bricks are 3 layers tall.",
          "Every brick must use rotation 0, 90, 180, or 270.",
          "Avoid overlapping bricks, floating bricks, disconnected components, and models without ground contact.",
        ].join("\n"),
      },
      {
        role: "user",
        content: JSON.stringify(
          {
            user_prompt: userPrompt,
            target_piece_count: cappedTarget,
            inventory: inventorySummary,
            structure_plan: structurePlan,
            required_output_shape: {
              model_name: "string",
              prompt: "string",
              piece_count: "number",
              dimensions: {
                width_studs: "number",
                depth_studs: "number",
                height_layers: "number",
              },
              created_from_inventory_id: inventory.inventory_id,
              generator_version: "openrouter-two-stage-v1",
              bricks: [
                {
                  id: "string",
                  part_id: "string",
                  ldraw_id: "string",
                  label: "string",
                  color_id: "string",
                  color_name: "string",
                  position: { x: "number", y: "number", z: "number" },
                  rotation: "0 | 90 | 180 | 270",
                  feature: "string",
                  step: "number",
                },
              ],
              notes: ["string"],
            },
          },
          null,
          2,
        ),
      },
    ],
  };
}
```

- [ ] **Step 4: Run prompt tests**

Run: `node --test test/generation/openRouterPrompts.test.js`

Expected: PASS.

- [ ] **Step 5: Record blocked commit**

Run: `git status --short`

Expected: FAIL with `fatal: not a git repository`. Record that commit is blocked until `.git` is restored.

---

### Task 3: OpenRouter Client And Generation Orchestrator

**Files:**
- Create: `src/generation/generationClient.js`
- Create: `src/generation/service.js`
- Create: `test/generation/service.test.js`

**Interfaces:**
- Consumes: `buildStructurePrompt` and `buildPlacementPrompt`
- Consumes: `parseStructurePlanText`
- Consumes: `parseJsonObject`
- Consumes: `validateGeneratedModelShape`
- Consumes: `validateModel`
- Produces: `createOpenRouterClient({ apiKey, fetchImpl, baseUrl })`
- Produces: `generateModel({ userPrompt, inventory, targetPieceCount, generationClient, model })`

- [ ] **Step 1: Write failing service tests**

Create `test/generation/service.test.js`:

```js
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { duckInventory } from "../../src/generation/fixtures/duckInventory.js";
import { generateModel } from "../../src/generation/service.js";

const structurePlan = {
  model_name: "Tiny Duck",
  primary_object: "duck",
  target_piece_count: 2,
  overall_shape: "A tiny blocky duck marker.",
  required_features: [
    {
      name: "body",
      visual_goal: "Yellow rectangular body",
      priority: "required",
      preferred_colors: ["yellow"],
      approximate_piece_budget: 1,
    },
  ],
  part_usage_plan: [
    {
      feature: "body",
      allowed_part_ids: ["3001"],
      allowed_color_ids: ["14"],
      max_pieces: 1,
      notes: "Use a yellow 2x4 brick.",
    },
  ],
  build_strategy: {
    base: "Place the brick on the ground.",
    body: "Use one brick as body.",
    raised_details: "Skip raised details.",
    stability_notes: "Ground contact only.",
  },
  fallback_priorities: ["Keep the body."],
  user_facing_summary: "I planned a tiny duck marker.",
};

const validModel = {
  model_name: "Tiny Duck",
  prompt: "build me a tiny duck",
  piece_count: 1,
  dimensions: { width_studs: 2, depth_studs: 4, height_layers: 3 },
  created_from_inventory_id: "duck-demo",
  generator_version: "openrouter-two-stage-v1",
  bricks: [
    {
      id: "body-1",
      part_id: "3001",
      ldraw_id: "3001.dat",
      label: "2x4 brick",
      color_id: "14",
      color_name: "yellow",
      position: { x: 0, y: 0, z: 0 },
      rotation: 0,
      feature: "body",
      step: 1,
    },
  ],
  notes: ["A tiny valid single-brick duck marker."],
};

function fakeClient(contents) {
  const calls = [];

  return {
    calls,
    async complete(request) {
      calls.push(request);
      return contents.shift();
    },
  };
}

describe("generateModel", () => {
  it("runs structure, placement, shape validation, and model validation", async () => {
    const client = fakeClient([JSON.stringify(structurePlan), JSON.stringify(validModel)]);

    const result = await generateModel({
      userPrompt: "build me a tiny duck",
      inventory: duckInventory,
      targetPieceCount: 2,
      generationClient: client,
    });

    assert.equal(result.ok, true);
    assert.equal(result.model.model_name, "Tiny Duck");
    assert.equal(result.structurePlan.primary_object, "duck");
    assert.equal(result.validation.valid, true);
    assert.equal(client.calls.length, 2);
  });

  it("returns parse errors when structure JSON is malformed", async () => {
    const client = fakeClient(["{ bad"]);

    const result = await generateModel({
      userPrompt: "build me a duck",
      inventory: duckInventory,
      generationClient: client,
    });

    assert.equal(result.ok, false);
    assert.equal(result.stage, "structure_parse");
    assert.match(result.errors[0].message, /Invalid structure plan JSON/);
  });

  it("returns shape errors before validator when placement JSON is malformed", async () => {
    const client = fakeClient([
      JSON.stringify(structurePlan),
      JSON.stringify({ ...validModel, bricks: [{ id: "bad" }] }),
    ]);

    const result = await generateModel({
      userPrompt: "build me a duck",
      inventory: duckInventory,
      generationClient: client,
    });

    assert.equal(result.ok, false);
    assert.equal(result.stage, "placement_shape");
    assert.equal(result.errors.some((error) => error.field.includes("part_id")), true);
  });

  it("returns validator errors for unsupported generated placements", async () => {
    const invalidModel = {
      ...validModel,
      bricks: [
        {
          ...validModel.bricks[0],
          part_id: "9999",
          ldraw_id: "9999.dat",
          label: "unsupported part",
        },
      ],
    };
    const client = fakeClient([JSON.stringify(structurePlan), JSON.stringify(invalidModel)]);

    const result = await generateModel({
      userPrompt: "build me a duck",
      inventory: duckInventory,
      generationClient: client,
    });

    assert.equal(result.ok, false);
    assert.equal(result.stage, "validation");
    assert.equal(result.validation.errors.some((error) => error.type === "unsupported_part"), true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/generation/service.test.js`

Expected: FAIL with module-not-found error for `service.js`.

- [ ] **Step 3: Implement OpenRouter client**

Create `src/generation/generationClient.js`:

```js
const DEFAULT_BASE_URL = "https://openrouter.ai/api/v1/chat/completions";

export function createOpenRouterClient({
  apiKey,
  fetchImpl = fetch,
  baseUrl = DEFAULT_BASE_URL,
} = {}) {
  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY is required.");
  }

  return {
    async complete(request) {
      const response = await fetchImpl(baseUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "http://127.0.0.1:5173",
          "X-Title": "HackThe6ix LEGO Generator",
        },
        body: JSON.stringify(request),
      });

      const body = await response.json().catch(() => null);

      if (!response.ok) {
        const message = body?.error?.message ?? `OpenRouter request failed with ${response.status}`;
        throw new Error(message);
      }

      const content = body?.choices?.[0]?.message?.content;

      if (typeof content !== "string" || content.trim() === "") {
        throw new Error("OpenRouter response did not include message content.");
      }

      return content;
    },
  };
}
```

- [ ] **Step 4: Implement generation orchestration**

Create `src/generation/service.js`:

```js
import { parseJsonObject, parseStructurePlanText } from "./designPlan.js";
import { validateGeneratedModelShape } from "./generatedModelSchema.js";
import { buildPlacementPrompt, buildStructurePrompt } from "./openRouterPrompts.js";
import { validateModel } from "./validator.js";

function failure(stage, errors, extra = {}) {
  return {
    ok: false,
    stage,
    errors,
    ...extra,
  };
}

export async function generateModel({
  userPrompt,
  inventory,
  targetPieceCount,
  generationClient,
  model,
}) {
  const structureRequest = buildStructurePrompt({
    userPrompt,
    inventory,
    targetPieceCount,
    model,
  });

  const structureText = await generationClient.complete(structureRequest);
  const structureResult = parseStructurePlanText(structureText);

  if (!structureResult.ok) {
    return failure("structure_parse", structureResult.errors);
  }

  const placementRequest = buildPlacementPrompt({
    userPrompt,
    inventory,
    structurePlan: structureResult.value,
    targetPieceCount,
    model,
  });

  const placementText = await generationClient.complete(placementRequest);
  const placementJson = parseJsonObject(placementText, "placement model");

  if (!placementJson.ok) {
    return failure("placement_parse", placementJson.errors, {
      structurePlan: structureResult.value,
    });
  }

  const shapeResult = validateGeneratedModelShape(placementJson.value);

  if (!shapeResult.ok) {
    return failure("placement_shape", shapeResult.errors, {
      structurePlan: structureResult.value,
    });
  }

  const validation = validateModel(placementJson.value, inventory);

  if (!validation.valid) {
    return failure("validation", validation.errors, {
      structurePlan: structureResult.value,
      model: placementJson.value,
      validation,
    });
  }

  return {
    ok: true,
    stage: "complete",
    structurePlan: structureResult.value,
    model: placementJson.value,
    validation,
  };
}
```

- [ ] **Step 5: Run service tests**

Run: `node --test test/generation/service.test.js`

Expected: PASS.

- [ ] **Step 6: Run accumulated generation tests**

Run: `node --test test/generation/designPlan.test.js test/generation/generatedModelSchema.test.js test/generation/openRouterPrompts.test.js test/generation/service.test.js`

Expected: PASS.

- [ ] **Step 7: Record blocked commit**

Run: `git status --short`

Expected: FAIL with `fatal: not a git repository`. Record that commit is blocked until `.git` is restored.

---

### Task 4: Local Generation HTTP Server

**Files:**
- Create: `server/generationServer.js`
- Modify: `package.json`

**Interfaces:**
- Consumes: `createOpenRouterClient({ apiKey })`
- Consumes: `generateModel({ userPrompt, inventory, targetPieceCount, generationClient, model })`
- Produces: `POST http://127.0.0.1:8787/api/generate`
- Produces: `npm run serve:generation`

- [ ] **Step 1: Create the local HTTP server**

Create `server/generationServer.js`:

```js
import { createServer } from "node:http";

import { createOpenRouterClient } from "../src/generation/generationClient.js";
import { generateModel } from "../src/generation/service.js";

const HOST = "127.0.0.1";
const PORT = Number(process.env.GENERATION_PORT ?? 8787);
const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL;

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "Access-Control-Allow-Origin": "http://127.0.0.1:5173",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
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

const server = createServer(async (request, response) => {
  if (request.method === "OPTIONS") {
    sendJson(response, 204, {});
    return;
  }

  if (request.method !== "POST" || request.url !== "/api/generate") {
    sendJson(response, 404, { ok: false, errors: ["Not found."] });
    return;
  }

  if (!process.env.OPENROUTER_API_KEY) {
    sendJson(response, 500, {
      ok: false,
      stage: "configuration",
      errors: ["OPENROUTER_API_KEY is required."],
    });
    return;
  }

  try {
    const body = await readJson(request);
    const requestErrors = validateRequestBody(body);

    if (requestErrors.length > 0) {
      sendJson(response, 400, {
        ok: false,
        stage: "request",
        errors: requestErrors,
      });
      return;
    }

    const generationClient = createOpenRouterClient({
      apiKey: process.env.OPENROUTER_API_KEY,
    });

    const result = await generateModel({
      userPrompt: body.userPrompt.trim(),
      inventory: body.inventory,
      targetPieceCount: body.targetPieceCount,
      generationClient,
      model: OPENROUTER_MODEL,
    });

    sendJson(response, result.ok ? 200 : 422, result);
  } catch (error) {
    sendJson(response, 500, {
      ok: false,
      stage: "server",
      errors: [error.message],
    });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Generation service listening at http://${HOST}:${PORT}`);
});
```

- [ ] **Step 2: Add package script**

Modify `package.json` scripts:

```json
{
  "scripts": {
    "dev": "vite --host 127.0.0.1",
    "serve:generation": "node server/generationServer.js",
    "test": "node --test"
  }
}
```

- [ ] **Step 3: Verify missing-key behavior without network**

Run: `npm run serve:generation`

Expected: console prints `Generation service listening at http://127.0.0.1:8787`.

In another terminal, run:

```bash
curl -s http://127.0.0.1:8787/api/generate \
  -H 'Content-Type: application/json' \
  -d '{"userPrompt":"build me a duck","inventory":{"inventory_id":"empty","source":"manual_test_fixture","items":[]}}'
```

Expected response includes:

```json
{"ok":false,"stage":"configuration","errors":["OPENROUTER_API_KEY is required."]}
```

- [ ] **Step 4: Stop the server**

Press `Ctrl-C` in the server terminal.

Expected: process exits cleanly.

- [ ] **Step 5: Run full test suite**

Run: `npm test`

Expected: PASS.

- [ ] **Step 6: Record blocked commit**

Run: `git status --short`

Expected: FAIL with `fatal: not a git repository`. Record that commit is blocked until `.git` is restored.

---

### Task 5: Preview UI And Render Refresh

**Files:**
- Modify: `index.html`
- Modify: `src/preview/main.js`
- Modify: `src/preview/styles.css`

**Interfaces:**
- Consumes: `POST http://127.0.0.1:8787/api/generate`
- Consumes: fixture inventories from `src/generation/fixtures/*Inventory.js`
- Consumes: `exportModelToLDraw(model)`
- Produces: browser UI for prompt, inventory, generation status, notes, errors, and model render

- [ ] **Step 1: Update HTML controls**

Modify `index.html` inside `.viewer-panel` so it contains:

```html
<canvas id="preview-canvas"></canvas>
<form class="control-panel" id="generation-form">
  <label>
    Prompt
    <input id="prompt-input" name="prompt" value="build me a duck" autocomplete="off" />
  </label>
  <label>
    Inventory
    <select id="inventory-select" name="inventory"></select>
  </label>
  <label>
    Target pieces
    <input id="target-pieces" name="targetPieces" type="number" min="1" max="50" value="15" />
  </label>
  <button id="generate-button" type="submit">Generate</button>
</form>
<div class="model-card">
  <p id="model-name">Ready to generate</p>
  <dl>
    <div>
      <dt>Pieces</dt>
      <dd id="piece-count">-</dd>
    </div>
    <div>
      <dt>Status</dt>
      <dd id="validation-status">Idle</dd>
    </div>
  </dl>
  <ul id="generation-notes" class="generation-notes"></ul>
  <pre id="validation-errors" class="validation-errors" hidden></pre>
</div>
```

- [ ] **Step 2: Replace hardwired preview setup with selectable inventories**

Modify imports at the top of `src/preview/main.js`:

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
import { validateModel } from "../generation/validator.js";
import { exportModelToLDraw } from "../ldraw/exportLDraw.js";
```

Add DOM references:

```js
const form = document.querySelector("#generation-form");
const promptInput = document.querySelector("#prompt-input");
const inventorySelect = document.querySelector("#inventory-select");
const targetPiecesInput = document.querySelector("#target-pieces");
const generateButton = document.querySelector("#generate-button");
const notesList = document.querySelector("#generation-notes");
const validationErrors = document.querySelector("#validation-errors");
```

Add inventory options:

```js
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
```

- [ ] **Step 3: Extract reusable model rendering**

In `src/preview/main.js`, replace the current one-time `loader.parse(...)` block with these helpers:

```js
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
```

- [ ] **Step 4: Add status and generation request helpers**

Add these helpers in `src/preview/main.js`:

```js
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

function showModel(model, validation) {
  modelName.textContent = model.model_name;
  pieceCount.textContent = String(model.piece_count);
  validationStatus.textContent = validation.valid ? "Valid" : "Invalid";
  setNotes(model.notes);
  hideErrors();
  renderModel(model);
}

async function requestGeneration() {
  const response = await fetch("http://127.0.0.1:8787/api/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      userPrompt: promptInput.value,
      inventory: selectedInventory(),
      targetPieceCount: Number(targetPiecesInput.value),
    }),
  });

  const result = await response.json();

  if (!response.ok || !result.ok) {
    throw result;
  }

  return result;
}
```

- [ ] **Step 5: Wire submit behavior and initial local preview**

Add this near the bottom of `src/preview/main.js`, before `animate()`:

```js
form.addEventListener("submit", async (event) => {
  event.preventDefault();
  generateButton.disabled = true;
  validationStatus.textContent = "Generating";
  modelName.textContent = "Calling OpenRouter";
  pieceCount.textContent = "-";
  setNotes([]);
  hideErrors();

  try {
    const result = await requestGeneration();
    showModel(result.model, result.validation);
  } catch (error) {
    validationStatus.textContent = "Failed";
    modelName.textContent = "Generation failed";
    pieceCount.textContent = "-";
    setNotes([]);
    showErrors(error.errors ?? [error.message ?? "Unknown generation error"]);
  } finally {
    generateButton.disabled = false;
  }
});

const initialModel = buildSmallDuckModel(duckInventory);
const initialValidation = validateModel(initialModel, duckInventory);
showModel(initialModel, initialValidation);
```

Remove the old hardwired `const model = buildSmallDuckModel(...)`, `const validation = ...`, one-time metadata assignment, and one-time `loader.parse(...)` block after the grid setup.

- [ ] **Step 6: Add compact UI styles**

Add to `src/preview/styles.css`:

```css
.control-panel {
  position: absolute;
  left: 24px;
  bottom: 24px;
  display: grid;
  width: min(420px, calc(100vw - 48px));
  gap: 10px;
  padding: 14px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 8px;
  background: rgba(16, 18, 24, 0.78);
  backdrop-filter: blur(14px);
  box-shadow: 0 18px 48px rgba(0, 0, 0, 0.28);
}

.control-panel label {
  display: grid;
  gap: 5px;
  color: #c8d0df;
  font-size: 12px;
  font-weight: 700;
}

.control-panel input,
.control-panel select {
  width: 100%;
  min-height: 34px;
  border: 1px solid rgba(255, 255, 255, 0.16);
  border-radius: 6px;
  background: #0f1218;
  color: #f5f7fb;
  font: inherit;
  font-size: 14px;
  padding: 7px 9px;
}

.control-panel button {
  min-height: 36px;
  border: 0;
  border-radius: 6px;
  background: #f2cd37;
  color: #17130a;
  font-weight: 800;
  cursor: pointer;
}

.control-panel button:disabled {
  cursor: wait;
  opacity: 0.65;
}

.generation-notes {
  margin: 14px 0 0;
  padding-left: 18px;
  color: #d8deeb;
  font-size: 13px;
}

.validation-errors {
  max-height: 170px;
  overflow: auto;
  margin: 14px 0 0;
  padding: 10px;
  border-radius: 6px;
  background: rgba(201, 26, 9, 0.18);
  color: #ffd8d2;
  font-size: 12px;
  white-space: pre-wrap;
}

@media (max-width: 640px) {
  .control-panel {
    left: 14px;
    right: 14px;
    bottom: 14px;
    width: auto;
  }

  .model-card {
    max-height: 38vh;
    overflow: auto;
  }
}
```

- [ ] **Step 7: Run source-level tests**

Run: `npm test`

Expected: PASS.

- [ ] **Step 8: Run local preview without live OpenRouter**

Run: `npm run dev`

Expected: Vite starts on `http://127.0.0.1:5173/`. The page initially renders the local duck fixture. Pressing Generate without the service running should show a failure message instead of crashing.

- [ ] **Step 9: Stop Vite**

Press `Ctrl-C` in the Vite terminal.

Expected: process exits cleanly.

- [ ] **Step 10: Record blocked commit**

Run: `git status --short`

Expected: FAIL with `fatal: not a git repository`. Record that commit is blocked until `.git` is restored.

---

### Task 6: Full Local Verification With Live OpenRouter

**Files:**
- Modify only if earlier tasks expose an integration issue:
  - `server/generationServer.js`
  - `src/generation/openRouterPrompts.js`
  - `src/preview/main.js`

**Interfaces:**
- Consumes: `OPENROUTER_API_KEY`
- Consumes: `npm run serve:generation`
- Consumes: `npm run dev`
- Produces: verified local two-call generation flow

- [ ] **Step 1: Run automated tests**

Run: `npm test`

Expected: PASS.

- [ ] **Step 2: Start generation service with environment key**

Run: `npm run serve:generation`

Expected: console prints `Generation service listening at http://127.0.0.1:8787`.

If the shell does not already have `OPENROUTER_API_KEY`, run the approved environment-loading workflow used by the user or export it manually in that shell before starting the service:

```bash
export OPENROUTER_API_KEY="your-local-key"
npm run serve:generation
```

- [ ] **Step 3: Start Vite**

Run: `npm run dev`

Expected: Vite starts on `http://127.0.0.1:5173/`.

- [ ] **Step 4: Verify successful generation in browser**

Open `http://127.0.0.1:5173/`, keep inventory as `Duck demo pieces`, keep prompt `build me a duck`, and click Generate.

Expected: UI shows `Generating`, then either:

- `Valid`, a generated model name, piece count, notes, and a refreshed 3D render, or
- `Failed` with validation errors from the service.

For this first pass, a validation failure is acceptable if OpenRouter returns mechanically invalid placements; the important requirement is that the error is visible and no fixture silently replaces it.

- [ ] **Step 5: Verify service rejects invalid requests**

Run:

```bash
curl -s http://127.0.0.1:8787/api/generate \
  -H 'Content-Type: application/json' \
  -d '{"userPrompt":"","inventory":{"items":[]}}'
```

Expected response includes:

```json
{"ok":false,"stage":"request"}
```

- [ ] **Step 6: Stop both dev servers**

Press `Ctrl-C` in the Vite terminal and the generation-service terminal.

Expected: both processes exit cleanly.

- [ ] **Step 7: Record blocked commit**

Run: `git status --short`

Expected: FAIL with `fatal: not a git repository`. Record that commit is blocked until `.git` is restored.

---

## Plan Self-Review

- Spec coverage: Tasks cover the two OpenRouter calls, API-key isolation, schema checks, validator authority, no repair loop, no silent fallback, preview UI, `MAX_MODEL_PIECES = 50`, and tests with injected test doubles.
- Placeholder scan: No `TBD`, `TODO`, or unspecified "add validation" steps remain. Deferred questions stay in the approved design spec, not in implementation steps.
- Type consistency: Prompt builders, service orchestration, schema guards, and preview code consistently use `userPrompt`, `targetPieceCount`, `inventory`, `structurePlan`, `GeneratedModel`, and `validation`.
- Git caveat: Commit steps are replaced with explicit blocked-commit checks because the workspace currently has no `.git` directory.
