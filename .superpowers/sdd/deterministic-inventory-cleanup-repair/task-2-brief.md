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

