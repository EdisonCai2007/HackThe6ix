### Task 3: OpenRouter Client And Generation Orchestrator

**Files:**
- Create: `src/generation/openRouterClient.js`
- Create: `src/generation/service.js`
- Create: `test/generation/service.test.js`

**Interfaces:**
- Consumes: `buildStructurePrompt` and `buildPlacementPrompt`
- Consumes: `parseStructurePlanText`
- Consumes: `parseJsonObject`
- Consumes: `validateGeneratedModelShape`
- Consumes: `validateModel`
- Produces: `createOpenRouterClient({ apiKey, fetchImpl, baseUrl })`
- Produces: `generateModel({ userPrompt, inventory, targetPieceCount, openRouterClient, model })`

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
      openRouterClient: client,
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
      openRouterClient: client,
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
      openRouterClient: client,
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
      openRouterClient: client,
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

Create `src/generation/openRouterClient.js`:

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
  openRouterClient,
  model,
}) {
  const structureRequest = buildStructurePrompt({
    userPrompt,
    inventory,
    targetPieceCount,
    model,
  });

  const structureText = await openRouterClient.complete(structureRequest);
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

  const placementText = await openRouterClient.complete(placementRequest);
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

