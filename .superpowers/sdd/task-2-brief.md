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
      model: "openai/gpt-4.1-mini",
    });

    const text = request.messages.map((message) => message.content).join("\n");

    assert.equal(request.model, "openai/gpt-4.1-mini");
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
      model: "openai/gpt-4.1-mini",
    });

    const text = request.messages.map((message) => message.content).join("\n");

    assert.match(text, /GeneratedModel/);
    assert.match(text, /Do not output raw LDraw/);
    assert.match(text, /Do not output meshes/);
    assert.match(text, /position/);
    assert.match(text, /rotation/);
    assert.match(text, /plates are 1 layer tall and bricks are 3 layers tall/);
    assert.match(text, /3001/);
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

export const DEFAULT_OPENROUTER_MODEL = "openai/gpt-4.1-mini";

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
  model = DEFAULT_OPENROUTER_MODEL,
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
  model = DEFAULT_OPENROUTER_MODEL,
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

