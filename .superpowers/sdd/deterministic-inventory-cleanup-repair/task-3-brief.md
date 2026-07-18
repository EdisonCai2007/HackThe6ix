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

