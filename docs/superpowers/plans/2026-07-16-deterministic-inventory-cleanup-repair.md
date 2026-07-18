# Deterministic Inventory Cleanup Repair Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a repair flow that deterministically removes illegal inventory pieces, shows a schema-valid draft while repair runs, then lets the AI repair the pruned model without rebuilding from scratch.

**Architecture:** Add a focused cleanup helper for objective inventory legality. Update `generateModel()` to emit draft/pruned events, run cleanup before AI repair, and pass richer context into the existing validation repair prompt. Update the SSE preview path to render draft events before the final result.

**Tech Stack:** JavaScript ES modules, Node `node:test`, Vite browser code, Three.js/LDraw preview, existing Gemini generation client.

## Global Constraints

- Use `node --test` for automated verification.
- No full regeneration path for this change.
- No AI call just to decide whether inventory-invalid bricks are legal.
- No new validator rule set.
- No visual scoring or critic pass.
- No fallback fixture when repair fails.
- No rendering of malformed JSON or models that fail the `GeneratedModel` shape check.
- The validator remains the final authority for accepted output.
- A schema-valid invalid draft can render as progress, but it is not accepted final output.

---

## File Structure

- Create `src/generation/inventoryCleanup.js`
  - Owns deterministic removal of unsupported parts, absent part/color combos, and excess inventory usage.
  - Exports `cleanupIllegalInventoryUsage(model, inventory)`.
- Create `test/generation/inventoryCleanup.test.js`
  - Focused tests for cleanup behavior and removal report shape.
- Modify `src/generation/generationPrompts.js`
  - Add `originalFailedModel`, `prunedModel`, and `removedBricks` to validation repair payload.
  - Change repair wording to allow any brick edits while forbidding full rebuild.
- Modify `src/generation/service.js`
  - Emit renderable draft events after shape validation.
  - Run cleanup before AI validation repair.
  - Pass cleanup context to repair prompt.
  - Preserve valid pruned fallback when AI repair fails after cleanup produced a valid model.
- Modify `test/generation/service.test.js`
  - Add orchestration tests for draft emission, cleanup-before-repair, pruned fallback, and any-brick repair prompt contract.
- Modify `server/generationServer.js`
  - Forward draft model events over SSE.
- Modify `src/preview/main.js`
  - Handle draft SSE events by rendering draft/pruned models while generation continues.
  - Distinguish draft status from accepted valid output.
- Modify `test/server/generationServerEvents.test.js`
  - Verify draft SSE formatting uses the existing event helper.

---

### Task 1: Deterministic Inventory Cleanup Helper

**Files:**
- Create: `src/generation/inventoryCleanup.js`
- Create: `test/generation/inventoryCleanup.test.js`

**Interfaces:**
- Consumes: `SUPPORTED_PARTS` from `src/generation/partCatalog.js`; `GeneratedModel` and `Inventory` shapes from existing typedefs.
- Produces:
  - `cleanupIllegalInventoryUsage(model, inventory): { model: GeneratedModel, removedBricks: RemovedBrick[] }`
  - `RemovedBrick` fields: `id`, `feature`, `part_id`, `color_id`, `reason`, `message`

- [ ] **Step 1: Write failing cleanup tests**

Create `test/generation/inventoryCleanup.test.js`:

```js
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { cleanupIllegalInventoryUsage } from "../../src/generation/inventoryCleanup.js";

const baseModel = {
  model_name: "Tiny Test",
  prompt: "build me a tiny test",
  piece_count: 1,
  dimensions: { width_studs: 4, depth_studs: 4, height_layers: 3 },
  created_from_inventory_id: "test-inventory",
  generator_version: "test",
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
  notes: ["test model"],
};

const inventory = {
  inventory_id: "test-inventory",
  source: "manual_test_fixture",
  items: [
    {
      label: "2x4 brick",
      category: "brick",
      part_id: "3001",
      ldraw_id: "3001.dat",
      color_name: "yellow",
      color_id: "14",
      count: 1,
      supported: true,
    },
    {
      label: "1x2 plate",
      category: "plate",
      part_id: "3023",
      ldraw_id: "3023.dat",
      color_name: "white",
      color_id: "15",
      count: 1,
      supported: true,
    },
  ],
};

function withBricks(bricks) {
  return {
    ...baseModel,
    piece_count: bricks.length,
    bricks,
  };
}

describe("cleanupIllegalInventoryUsage", () => {
  it("removes unsupported part ids and reports the removed feature", () => {
    const illegalBrick = {
      ...baseModel.bricks[0],
      id: "fake-eye",
      part_id: "9999",
      ldraw_id: "9999.dat",
      feature: "eye",
    };

    const result = cleanupIllegalInventoryUsage(withBricks([illegalBrick]), inventory);

    assert.deepEqual(result.model.bricks, []);
    assert.equal(result.model.piece_count, 0);
    assert.deepEqual(result.removedBricks, [
      {
        id: "fake-eye",
        feature: "eye",
        part_id: "9999",
        color_id: "14",
        reason: "unsupported_part",
        message: "fake-eye uses unsupported part 9999.",
      },
    ]);
  });

  it("removes supported part/color combinations absent from inventory", () => {
    const absentColorBrick = {
      ...baseModel.bricks[0],
      id: "red-body",
      color_id: "4",
      color_name: "red",
    };

    const result = cleanupIllegalInventoryUsage(withBricks([absentColorBrick]), inventory);

    assert.deepEqual(result.model.bricks, []);
    assert.equal(result.removedBricks[0].reason, "inventory_missing");
    assert.equal(
      result.removedBricks[0].message,
      "red-body uses part 3001 color 4, which is not in the confirmed supported inventory.",
    );
  });

  it("keeps the first allowed bricks and removes later excess bricks by model order", () => {
    const first = { ...baseModel.bricks[0], id: "body-1" };
    const second = { ...baseModel.bricks[0], id: "body-2", position: { x: 0, y: 0, z: 3 } };
    const third = { ...baseModel.bricks[0], id: "body-3", position: { x: 0, y: 0, z: 6 } };

    const result = cleanupIllegalInventoryUsage(withBricks([first, second, third]), inventory);

    assert.deepEqual(
      result.model.bricks.map((brick) => brick.id),
      ["body-1"],
    );
    assert.equal(result.model.piece_count, 1);
    assert.deepEqual(
      result.removedBricks.map((brick) => brick.id),
      ["body-2", "body-3"],
    );
    assert.deepEqual(
      result.removedBricks.map((brick) => brick.reason),
      ["inventory_exceeded", "inventory_exceeded"],
    );
  });

  it("leaves legal inventory usage unchanged", () => {
    const result = cleanupIllegalInventoryUsage(baseModel, inventory);

    assert.deepEqual(result.model, baseModel);
    assert.deepEqual(result.removedBricks, []);
  });
});
```

- [ ] **Step 2: Run the new tests to verify they fail**

Run: `node --test test/generation/inventoryCleanup.test.js`

Expected: FAIL with a module resolution error for `src/generation/inventoryCleanup.js`.

- [ ] **Step 3: Implement cleanup helper**

Create `src/generation/inventoryCleanup.js`:

```js
import { SUPPORTED_PARTS } from "./partCatalog.js";

function keyFor(partId, colorId) {
  return `${partId}:${colorId}`;
}

function buildAvailableInventory(inventory) {
  const available = new Map();

  for (const item of inventory.items) {
    if (!item.supported || !SUPPORTED_PARTS[item.part_id]) {
      continue;
    }

    const key = keyFor(item.part_id, item.color_id);
    available.set(key, (available.get(key) ?? 0) + item.count);
  }

  return available;
}

function removedBrickFor(brick, reason, message) {
  return {
    id: brick.id,
    feature: brick.feature,
    part_id: brick.part_id,
    color_id: brick.color_id,
    reason,
    message,
  };
}

export function cleanupIllegalInventoryUsage(model, inventory) {
  const available = buildAvailableInventory(inventory);
  const keptCounts = new Map();
  const keptBricks = [];
  const removedBricks = [];

  for (const brick of model.bricks) {
    if (!SUPPORTED_PARTS[brick.part_id]) {
      removedBricks.push(
        removedBrickFor(
          brick,
          "unsupported_part",
          `${brick.id} uses unsupported part ${brick.part_id}.`,
        ),
      );
      continue;
    }

    const inventoryKey = keyFor(brick.part_id, brick.color_id);
    const availableCount = available.get(inventoryKey) ?? 0;

    if (availableCount === 0) {
      removedBricks.push(
        removedBrickFor(
          brick,
          "inventory_missing",
          `${brick.id} uses part ${brick.part_id} color ${brick.color_id}, which is not in the confirmed supported inventory.`,
        ),
      );
      continue;
    }

    const keptCount = keptCounts.get(inventoryKey) ?? 0;

    if (keptCount >= availableCount) {
      removedBricks.push(
        removedBrickFor(
          brick,
          "inventory_exceeded",
          `${brick.id} exceeds available inventory for part ${brick.part_id} color ${brick.color_id}.`,
        ),
      );
      continue;
    }

    keptCounts.set(inventoryKey, keptCount + 1);
    keptBricks.push(brick);
  }

  return {
    model: {
      ...model,
      piece_count: keptBricks.length,
      bricks: keptBricks,
    },
    removedBricks,
  };
}
```

- [ ] **Step 4: Run cleanup tests to verify they pass**

Run: `node --test test/generation/inventoryCleanup.test.js`

Expected: PASS, 4 tests pass.

- [ ] **Step 5: Run existing validator-adjacent tests**

Run: `node --test test/generation/validator.test.js test/generation/service.test.js`

Expected: PASS. If service tests fail because cleanup has not been wired yet, confirm failures are not in `validator.test.js`, then continue to Task 2.

- [ ] **Step 6: Commit Task 1**

Run:

```bash
git add src/generation/inventoryCleanup.js test/generation/inventoryCleanup.test.js
git commit -m "Add deterministic inventory cleanup"
```

Expected: commit succeeds. If `git status` reports this checkout is not a repository, record `commit blocked: not a git repository` and continue without fabricating a commit.

---

### Task 2: Wire Cleanup Into Validation Repair

**Files:**
- Modify: `src/generation/service.js`
- Modify: `test/generation/service.test.js`

**Interfaces:**
- Consumes: `cleanupIllegalInventoryUsage(model, inventory)` from Task 1.
- Produces:
  - `draft` progress events: `{ type: "draft", stage: "placement_draft" | "pruned_draft", model, validation? }`
  - Failure extras: `prunedModel`, `prunedValidation`, `removedBricks`
  - Success extras when pruned fallback is used: `removedBricks`, `repaired: false`

- [ ] **Step 1: Add failing service tests for draft and cleanup orchestration**

Append these tests to `test/generation/service.test.js`:

```js
it("emits a draft event for schema-valid placement before validation repair", async () => {
  const client = fakeClient([
    JSON.stringify(structurePlan),
    JSON.stringify(floatingModel),
    JSON.stringify(validModel),
  ]);
  const events = [];

  const result = await generateTestModel({
    userPrompt: "build me a duck",
    inventory: duckInventory,
    generationClient: client,
    onProgress: (event) => events.push(event),
  });

  assert.equal(result.ok, true);
  assert.deepEqual(
    events
      .filter((event) => event.type === "draft")
      .map((event) => event.stage),
    ["placement_draft"],
  );
  assert.equal(events.find((event) => event.type === "draft").model.bricks[0].id, "floating-body");
});

it("cleans illegal inventory before asking AI to repair buildability", async () => {
  const prunedValidModel = {
    ...validModel,
    bricks: [],
    piece_count: 0,
  };
  const client = fakeClient([
    JSON.stringify(structurePlan),
    JSON.stringify(missingInventoryAndFloatingModel),
    JSON.stringify(validModel),
  ]);

  const result = await generateTestModel({
    userPrompt: "build me a duck",
    inventory: duckInventory,
    generationClient: client,
  });

  assert.equal(result.ok, true);
  assert.equal(result.removedBricks.length, 1);
  assert.equal(result.removedBricks[0].reason, "inventory_missing");
  assert.equal(client.calls.length, 3);

  const repairText = requestText(client.calls[2]);
  assert.match(repairText, /removed_bricks/);
  assert.match(repairText, /pruned_generated_model/);
  assert.match(repairText, /floating-body/);
  assert.doesNotDeepEqual(result.model, prunedValidModel);
});

it("falls back to a valid pruned model when AI repair fails", async () => {
  const invalidInventoryOnlyModel = {
    ...validModel,
    bricks: [
      ...validModel.bricks,
      {
        ...validModel.bricks[0],
        id: "illegal-extra",
        part_id: "3023",
        ldraw_id: "3023.dat",
        label: "1x2 plate",
        color_id: "15",
        color_name: "white",
        position: { x: 5, y: 0, z: 0 },
        feature: "accent",
        step: 2,
      },
    ],
    piece_count: 2,
  };
  const client = fakeClient([
    JSON.stringify(structurePlan),
    JSON.stringify(invalidInventoryOnlyModel),
    "not json",
  ]);

  const result = await generateTestModel({
    userPrompt: "build me a duck",
    inventory: duckInventory,
    generationClient: client,
  });

  assert.equal(result.ok, true);
  assert.equal(result.validation.valid, true);
  assert.equal(result.model.bricks.length, 1);
  assert.equal(result.model.bricks[0].id, "body-1");
  assert.equal(result.repaired, false);
  assert.equal(result.removedBricks[0].id, "illegal-extra");
});
```

- [ ] **Step 2: Run focused service tests to verify they fail**

Run: `node --test test/generation/service.test.js`

Expected: FAIL because `generateModel()` does not emit draft events, does not include `removedBricks`, and still uses AI inventory repair.

- [ ] **Step 3: Import cleanup helper and add draft event helper**

In `src/generation/service.js`, add the import:

```js
import { cleanupIllegalInventoryUsage } from "./inventoryCleanup.js";
```

Add this helper near `emitProgress`:

```js
async function emitDraft(onProgress, stage, payload) {
  if (typeof onProgress !== "function") {
    return;
  }

  await onProgress({
    type: "draft",
    stage,
    ...payload,
  });
}
```

- [ ] **Step 4: Emit placement draft after shape validation**

In `generateModel()`, immediately after `shapeResult.ok` is confirmed and before `validateModel(placementJson.value, inventory)`, add:

```js
await emitDraft(onProgress, "placement_draft", {
  model: placementJson.value,
});
```

- [ ] **Step 5: Replace AI inventory repair branch with deterministic cleanup**

In `repairInvalidPlacement()`, replace the current `if (hasValidationErrorType(currentValidation, REPAIRABLE_INVENTORY_VALIDATION_TYPES)) { ... }` block with:

```js
let removedBricks = [];
let prunedModel = currentModel;
let prunedValidation = currentValidation;

if (hasValidationErrorType(currentValidation, REPAIRABLE_INVENTORY_VALIDATION_TYPES)) {
  const cleanup = cleanupIllegalInventoryUsage(currentModel, inventory);
  removedBricks = cleanup.removedBricks;
  prunedModel = cleanup.model;
  prunedValidation = validateModel(prunedModel, inventory);

  await emitDraft(onProgress, "pruned_draft", {
    model: prunedModel,
    validation: prunedValidation,
    removedBricks,
  });

  currentModel = prunedModel;
  currentValidation = prunedValidation;
}
```

Keep the later non-repairable guard, but make sure it returns cleanup context:

```js
if (!currentValidation.errors.every((error) => REPAIRABLE_VALIDATION_TYPES.has(error.type))) {
  await emitProgress(onProgress, "validation_repair", "failed");
  return buildValidationFailure(
    "validation",
    currentValidation.errors,
    currentModel,
    currentValidation,
    validation,
    {
      prunedModel,
      prunedValidation,
      removedBricks,
    },
  );
}
```

- [ ] **Step 6: Extend validation failure helper to include cleanup context**

Change `buildValidationFailure()` in `src/generation/service.js` to:

```js
function buildValidationFailure(stage, errors, model, validation, originalValidation, extra = {}) {
  return {
    ok: false,
    stage,
    errors,
    model,
    validation,
    ...(originalValidation ? { originalValidation } : {}),
    ...extra,
  };
}
```

- [ ] **Step 7: Pass cleanup context into buildability repair**

Update the `runPlacementValidationRepair()` call for buildability repair:

```js
const buildabilityRepair = await runPlacementValidationRepair({
  userPrompt,
  inventory,
  structurePlan,
  invalidModel: currentModel,
  originalFailedModel: invalidModel,
  prunedModel,
  removedBricks,
  validation: currentValidation,
  validationErrors: currentValidation.errors,
  targetPieceCount,
  generationClient,
  model,
  buildRepairPrompt: buildPlacementValidationRepairPrompt,
});
```

Update `runPlacementValidationRepair()` parameters and prompt call:

```js
async function runPlacementValidationRepair({
  userPrompt,
  inventory,
  structurePlan,
  invalidModel,
  originalFailedModel,
  prunedModel,
  removedBricks = [],
  validation,
  targetPieceCount,
  generationClient,
  model,
  buildRepairPrompt,
  validationErrors,
}) {
  const repairRequest = buildRepairPrompt({
    userPrompt,
    inventory,
    structurePlan,
    invalidModel,
    originalFailedModel,
    prunedModel,
    removedBricks,
    validationErrors,
    targetPieceCount,
    model,
  });
```

- [ ] **Step 8: Add valid-pruned fallback when AI repair fails**

After `buildabilityRepair` returns, before returning parse/shape failure directly, add:

```js
if (!buildabilityRepair.ok && removedBricks.length > 0 && currentValidation.valid) {
  await emitProgress(onProgress, "validation_repair", "complete");
  return {
    ok: true,
    model: currentModel,
    validation: currentValidation,
    removedBricks,
    repaired: false,
  };
}
```

When buildability repair succeeds, include cleanup context:

```js
if (buildabilityRepair.ok && buildabilityRepair.validation.valid) {
  return {
    ...buildabilityRepair,
    removedBricks,
    repaired: true,
  };
}
```

- [ ] **Step 9: Include cleanup context in final success/failure result**

In `generateModel()`, when `repairedPlacement.ok`, return:

```js
return {
  ok: true,
  stage: "complete",
  structurePlan: structureResult.value,
  model: repairedPlacement.model,
  validation: repairedPlacement.validation,
  ...(repairedPlacement.removedBricks ? { removedBricks: repairedPlacement.removedBricks } : {}),
  ...(typeof repairedPlacement.repaired === "boolean"
    ? { repaired: repairedPlacement.repaired }
    : {}),
};
```

When returning failure, include:

```js
return failure(repairedPlacement.stage, repairedPlacement.errors, {
  structurePlan: structureResult.value,
  model: repairedPlacement.model,
  validation: repairedPlacement.validation,
  originalValidation: repairedPlacement.originalValidation,
  ...(repairedPlacement.prunedModel ? { prunedModel: repairedPlacement.prunedModel } : {}),
  ...(repairedPlacement.prunedValidation
    ? { prunedValidation: repairedPlacement.prunedValidation }
    : {}),
  ...(repairedPlacement.removedBricks
    ? { removedBricks: repairedPlacement.removedBricks }
    : {}),
});
```

- [ ] **Step 10: Run service tests**

Run: `node --test test/generation/service.test.js`

Expected: PASS. If the existing test named `repairs inventory validation errors before buildability errors` still expects a separate AI inventory repair call, update it to assert deterministic cleanup and one buildability AI repair call.

- [ ] **Step 11: Commit Task 2**

Run:

```bash
git add src/generation/service.js test/generation/service.test.js
git commit -m "Use deterministic cleanup before validation repair"
```

Expected: commit succeeds. If `git status` reports this checkout is not a repository, record `commit blocked: not a git repository` and continue.

---

### Task 3: Update Validation Repair Prompt Contract

**Files:**
- Modify: `src/generation/generationPrompts.js`
- Modify: `test/generation/generationPrompts.test.js`
- Modify: `test/generation/service.test.js`

**Interfaces:**
- Consumes: prompt payload fields from Task 2: `originalFailedModel`, `prunedModel`, `removedBricks`.
- Produces: buildability repair request payload keys:
  - `original_failed_generated_model`
  - `pruned_generated_model`
  - `removed_bricks`
  - `validation_errors`

- [ ] **Step 1: Write failing prompt contract test**

Append to `test/generation/generationPrompts.test.js`:

```js
it("builds validation repair prompt around a pruned draft instead of full rebuild", () => {
  const request = buildPlacementValidationRepairPrompt({
    userPrompt: "build me a duck",
    inventory: duckInventory,
    structurePlan: {
      model_name: "Duck",
      primary_object: "duck",
      target_piece_count: 2,
      overall_shape: "small duck",
      required_features: [],
      part_usage_plan: [],
      build_strategy: {
        base: "grounded body",
        body: "small body",
        raised_details: "head",
        stability_notes: "connected",
      },
      fallback_priorities: [],
      user_facing_summary: "duck",
    },
    invalidModel: { model_name: "Pruned Duck", bricks: [] },
    originalFailedModel: { model_name: "Original Duck", bricks: [{ id: "fake-eye" }] },
    prunedModel: { model_name: "Pruned Duck", bricks: [] },
    removedBricks: [
      {
        id: "fake-eye",
        feature: "eye",
        part_id: "9999",
        color_id: "14",
        reason: "unsupported_part",
        message: "fake-eye uses unsupported part 9999.",
      },
    ],
    validationErrors: [{ type: "no_ground_contact", message: "Model has no ground contact." }],
    targetPieceCount: 2,
    model: "test-model",
  });

  const systemText = request.systemInstruction.parts.map((part) => part.text).join("\n");
  const payload = JSON.parse(request.contents[0].parts[0].text);

  assert.match(systemText, /The pruned model is the starting point/i);
  assert.match(systemText, /Do not rebuild from scratch/i);
  assert.match(systemText, /You may modify any remaining brick/i);
  assert.match(systemText, /Do not re-add removed illegal bricks/i);
  assert.deepEqual(payload.original_failed_generated_model.bricks[0].id, "fake-eye");
  assert.deepEqual(payload.pruned_generated_model.bricks, []);
  assert.equal(payload.removed_bricks[0].reason, "unsupported_part");
});
```

- [ ] **Step 2: Run prompt tests to verify failure**

Run: `node --test test/generation/generationPrompts.test.js`

Expected: FAIL because `buildPlacementValidationRepairPrompt()` does not include the new payload keys or exact wording yet.

- [ ] **Step 3: Update prompt builder signature and system text**

In `src/generation/generationPrompts.js`, update `buildPlacementValidationRepairPrompt()` signature:

```js
export function buildPlacementValidationRepairPrompt({
  userPrompt,
  inventory,
  structurePlan,
  invalidModel,
  originalFailedModel,
  prunedModel,
  removedBricks = [],
  validationErrors,
  targetPieceCount,
  model,
}) {
```

Replace its `systemText` array with:

```js
systemText: [
  "You repair a LEGO GeneratedModel that failed deterministic buildability validation.",
  "Return exactly one full valid GeneratedModel JSON object matching generationConfig.responseSchema.",
  "No markdown, no commentary, and no text before or after the JSON object.",
  "The pruned model is the starting point.",
  "Do not rebuild from scratch.",
  "Preserve the requested object, major features, and recognizable silhouette.",
  "Prefer the smallest set of changes that can pass validation.",
  "You may modify any remaining brick if needed.",
  "You may add legal supported inventory pieces if available.",
  "Do not re-add removed illegal bricks.",
  "Use only supported parts and part/color combinations present in inventory.",
  `Do not exceed ${MAX_MODEL_PIECES} pieces or the requested target count.`,
  "Ground rule: at least one brick must have position.z === 0.",
  "Support rule: every brick with position.z > 0 must have at least one occupied stud cell directly below it at z - 1 from a different brick.",
  "Connection rule: all bricks must form one connected component through vertical stud overlap.",
  "Overlap rule: no two bricks may occupy the same x, y, z grid cell.",
  "Layer rule: plates are 1 layer tall and bricks are 3 layers tall.",
  "If needed, simplify the model by moving pieces down to z 0 or stacking pieces directly on supported studs.",
].join("\n"),
```

- [ ] **Step 4: Update prompt user payload**

In the same function, replace the payload keys with:

```js
userPayload: {
  user_prompt: userPrompt,
  target_piece_count: cappedTarget,
  inventory: inventorySummary,
  structure_plan: structurePlan,
  validation_errors: validationErrors,
  original_failed_generated_model: originalFailedModel ?? invalidModel,
  pruned_generated_model: prunedModel ?? invalidModel,
  removed_bricks: removedBricks,
  invalid_generated_model: invalidModel,
},
```

- [ ] **Step 5: Run prompt and service tests**

Run:

```bash
node --test test/generation/generationPrompts.test.js test/generation/service.test.js
```

Expected: PASS.

- [ ] **Step 6: Commit Task 3**

Run:

```bash
git add src/generation/generationPrompts.js test/generation/generationPrompts.test.js test/generation/service.test.js
git commit -m "Update validation repair prompt contract"
```

Expected: commit succeeds. If `git status` reports this checkout is not a repository, record `commit blocked: not a git repository` and continue.

---

### Task 4: Stream And Render Interim Drafts

**Files:**
- Modify: `server/generationServer.js`
- Modify: `src/preview/main.js`
- Modify: `test/server/generationServerEvents.test.js`
- Test manually with `npm test`

**Interfaces:**
- Consumes: `onProgress` events from Task 2.
- Produces:
  - SSE event `draft` with payload `{ type: "draft", stage, model, validation?, removedBricks? }`
  - Preview draft rendering state: `validationStatus.textContent = "Repairing draft"` for invalid drafts.

- [ ] **Step 1: Add SSE draft formatting test**

Append to `test/server/generationServerEvents.test.js`:

```js
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
```

- [ ] **Step 2: Run server event tests**

Run: `node --test test/server/generationServerEvents.test.js`

Expected: PASS. This confirms the existing formatter supports the new event type.

- [ ] **Step 3: Forward draft events separately from progress events**

In `server/generationServer.js`, update the `createGenerationResult(body, onProgress)` callback in `handleGenerateStream()`:

```js
const result = await createGenerationResult(body, (event) => {
  if (event.type === "draft") {
    response.write(formatSseEvent("draft", event));
    return;
  }

  response.write(formatSseEvent("progress", event));
});
```

- [ ] **Step 4: Add draft handling helpers in preview**

In `src/preview/main.js`, replace `showModel(model, validation)` with:

```js
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
```

Add a draft handler near `handleSseBlock()`:

```js
function handleDraftEvent(payload) {
  if (!payload.model) {
    return;
  }

  const validation = payload.validation ?? {
    valid: false,
    errors: [],
    warnings: [],
    inventory_usage: [],
  };

  showModel(payload.model, validation, {
    statusText: payload.stage === "pruned_draft" ? "Repairing pruned draft" : "Repairing draft",
    hideErrors: payload.stage === "placement_draft",
  });
}
```

- [ ] **Step 5: Wire draft SSE event handling**

In `handleSseBlock(block)`, add this branch before the `result` branch:

```js
if (event.eventName === "draft") {
  handleDraftEvent(event.payload);
  return undefined;
}
```

- [ ] **Step 6: Keep failed final result from blanking a rendered draft**

In the `catch` block of the submit handler in `src/preview/main.js`, replace:

```js
modelName.textContent = "Generation failed";
pieceCount.textContent = "-";
setNotes([]);
```

with:

```js
if (!currentModelGroup) {
  modelName.textContent = "Generation failed";
  pieceCount.textContent = "-";
  setNotes([]);
}
```

Keep:

```js
validationStatus.textContent = "Failed";
markTimelineFailureFromResult(error.stage);
showErrors(error.errors ?? [error.message ?? "Unknown generation error"]);
```

- [ ] **Step 7: Run full automated tests**

Run: `npm test`

Expected: PASS for all `node --test` suites.

- [ ] **Step 8: Manual stream verification**

Run the generation service and Vite in two terminals:

```bash
npm run serve:generation
npm run dev:preview
```

Expected:
- The generation service starts at `http://127.0.0.1:8787`.
- The Vite preview starts and serves the app.
- Submitting a prompt shows a draft model before final repair completes when the placement is schema-valid.
- If repair succeeds, the final valid model replaces the draft.
- If repair fails after a draft renders, the model remains visible and the error panel shows the final errors.

- [ ] **Step 9: Commit Task 4**

Run:

```bash
git add server/generationServer.js src/preview/main.js test/server/generationServerEvents.test.js
git commit -m "Render draft models during validation repair"
```

Expected: commit succeeds. If `git status` reports this checkout is not a repository, record `commit blocked: not a git repository` and continue.

---

## Final Verification

- [ ] Run all tests:

```bash
npm test
```

Expected: every `node --test` suite passes.

- [ ] Confirm the plan-aligned spec remains in place:

```bash
test -f docs/superpowers/specs/2026-07-16-deterministic-inventory-cleanup-repair-design.md
```

Expected: command exits with status 0.
