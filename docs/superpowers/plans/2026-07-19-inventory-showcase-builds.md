# Inventory Showcase Builds Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add two polished, deterministic, inventory-valid LEGO models that the existing suggestion UI can select and the current SSE path can animate one brick at a time.

**Architecture:** Two focused fixture builders share a strict inventory-aware placement helper. A dependency-free showcase registry is the public import contract and resolves stable suggestion IDs or legacy prompt text. The server recognizes showcase requests before provider credential checks and reuses existing `progress`, `brick`, and `result` SSE events; the browser preserves a selected showcase ID in its generation request.

**Tech Stack:** JavaScript ES modules, Node.js built-in test runner, existing `GeneratedModel` schema/validator, existing HTTP/SSE server, Vite/Three.js preview.

## Global Constraints

- Each showcase must independently fit the committed `fixedDemoInventory` without substitutions or overuse.
- The registry must have no server, DOM, AI-provider, or network dependencies.
- Unknown showcase IDs and ordinary prompts must retain the existing generation behavior.
- Streaming order is `step` ascending and then original brick-array order.
- Normal showcase streams use a short configurable delay; automated tests use zero delay.
- No gated model, paid API, or runtime dataset dependency may be introduced.

---

## File map

- `src/generation/fixtures/showcaseModelHelpers.js`: strict inventory allocation and shared dimension/model helpers.
- `src/generation/fixtures/showcaseSteamLocomotiveModel.js`: Scarlet Steam Locomotive placement program.
- `src/generation/fixtures/showcaseGrandPianoModel.js`: Midnight Grand Piano placement program.
- `src/generation/showcaseBuilds.js`: stable public registry, suggestions, matching, construction, validation, and replay.
- `server/generationServer.js`: request validation, credential bypass, local suggestions, and showcase stream integration.
- `src/preview/showcaseSelection.js`: small testable state/request helpers for the selected suggestion.
- `src/preview/main.js`: connect suggestion clicks and generation requests to `showcaseSelection`.
- `src/preview/fixturePreviewPicker.js`: expose both showcase assets in the existing development picker.
- `test/generation/showcaseModelHelpers.test.js`: strict allocation helper coverage.
- `test/generation/showcaseSteamLocomotiveModel.test.js`: locomotive schema, inventory, geometry, and detail coverage.
- `test/generation/showcaseGrandPianoModel.test.js`: piano schema, inventory, geometry, and detail coverage.
- `test/generation/showcaseBuilds.test.js`: public registry and deterministic replay coverage.
- `test/server/generationServerEvents.test.js`: showcase request validation and credential-bypass coverage.
- `test/preview/showcaseSelection.test.js`: browser suggestion-ID lifecycle and request serialization.
- `test/preview/fixturePreviewPicker.test.js`: picker registration and validation coverage.

### Task 1: Strict showcase model helper

**Files:**
- Create: `src/generation/fixtures/showcaseModelHelpers.js`
- Create: `test/generation/showcaseModelHelpers.test.js`

**Interfaces:**
- Consumes: `getPartDimensions(partId, rotation)` from `src/generation/partCatalog.js` and an `Inventory`.
- Produces: `createShowcaseBrickFactory(inventory, buildLabel)`, `dimensionsForBricks(bricks)`, and `completeShowcaseModel({...})`.

- [ ] **Step 1: Write the failing allocation tests**

Test that a factory placement copies canonical inventory metadata, counts repeated part/color usage, throws when a requested pair is absent, and throws on the first over-allocation. Test that `completeShowcaseModel` sets `piece_count`, dimensions, and inventory ID from its inputs.

```js
const brick = createShowcaseBrickFactory(inventory, "Test Build");
assert.deepEqual(brick({
  id: "one",
  part_id: "3005",
  color_name: "red",
  position: { x: 0, y: 0, z: 0 },
  feature: "test",
  step: 1,
}), {
  id: "one",
  part_id: "3005",
  ldraw_id: "3005.dat",
  label: "1x1 brick",
  color_id: "4",
  color_name: "red",
  position: { x: 0, y: 0, z: 0 },
  rotation: 0,
  feature: "test",
  step: 1,
});
```

- [ ] **Step 2: Run the focused test and confirm RED**

Run: `node --test test/generation/showcaseModelHelpers.test.js`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `showcaseModelHelpers.js`.

- [ ] **Step 3: Implement the strict helper**

Index supported inventory entries by ``${part_id}:${color_name}``, track use in a second map, and throw errors that name the build, missing/overused pair, inventory ID, used count, and available count. Compute dimensions from the min/max occupied extents returned by `getPartDimensions`. `completeShowcaseModel` must return the normal `GeneratedModel` fields and copy the supplied notes array.

```js
export function completeShowcaseModel({
  modelName,
  prompt,
  generatorVersion,
  inventory,
  bricks,
  notes,
}) {
  return {
    model_name: modelName,
    prompt,
    piece_count: bricks.length,
    dimensions: dimensionsForBricks(bricks),
    created_from_inventory_id: inventory.inventory_id,
    generator_version: generatorVersion,
    bricks,
    notes: [...notes],
  };
}
```

- [ ] **Step 4: Run the focused test and confirm GREEN**

Run: `node --test test/generation/showcaseModelHelpers.test.js`

Expected: all helper tests pass.

- [ ] **Step 5: Commit the helper**

```bash
git add src/generation/fixtures/showcaseModelHelpers.js test/generation/showcaseModelHelpers.test.js
git commit -m "feat: add strict showcase model helpers"
```

### Task 2: Scarlet Steam Locomotive asset

**Files:**
- Create: `src/generation/fixtures/showcaseSteamLocomotiveModel.js`
- Create: `test/generation/showcaseSteamLocomotiveModel.test.js`

**Interfaces:**
- Consumes: `fixedDemoInventory` and the Task 1 helper.
- Produces: `buildShowcaseSteamLocomotiveModel(inventory = fixedDemoInventory): GeneratedModel`.

- [ ] **Step 1: Write failing locomotive contract tests**

Assert schema validity, deterministic deep equality, standard validator validity, at least 120 pieces, at least 20 studs of length, and nonempty features for `chassis`, `running-board`, `driving-wheel`, `boiler`, `smokestack`, `cowcatcher`, `cab`, `cab-window`, `roof`, and `coupling-rod`. Independently aggregate ``${part_id}:${color_id}`` and assert every used count is at most inventory count. Assert that driving wheels and roof are black, boiler/cab are red, windows are blue, and coupling rods are yellow.

```js
const model = buildShowcaseSteamLocomotiveModel(fixedDemoInventory);
assert.equal(validateGeneratedModelShape(model).ok, true);
assert.equal(validateModel(model, fixedDemoInventory).valid, true);
assert.ok(model.piece_count >= 120);
assert.ok(model.dimensions.width_studs >= 20 || model.dimensions.depth_studs >= 20);
```

- [ ] **Step 2: Run the focused test and confirm RED**

Run: `node --test test/generation/showcaseSteamLocomotiveModel.test.js`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for the locomotive builder.

- [ ] **Step 3: Implement the locomotive placement program**

Build from bottom to top with monotonic integer steps: dark chassis rails; tied black running boards; three visually stepped wheel circles per side using black bricks/plates; yellow rods outside them; a red rectangular boiler with stepped top/bottom curvature and black front cap; a tapered black cowcatcher; a red rear cab with blue side windows and overhanging black roof; then smokestack, domes, headlamp, and rear coupler. Keep every placement on integer stud/layer coordinates and rotate only by quarter turns. Use the helper for every placement, and return `completeShowcaseModel` with generator version `showcase-steam-locomotive-v1`.

```js
export function buildShowcaseSteamLocomotiveModel(inventory = fixedDemoInventory) {
  const bricks = [];
  const brick = createShowcaseBrickFactory(inventory, "Scarlet Steam Locomotive");
  addChassis(bricks, brick);
  addWheelsAndRods(bricks, brick);
  addBoiler(bricks, brick);
  addCowcatcher(bricks, brick);
  addCab(bricks, brick);
  addTopDetails(bricks, brick);
  return completeShowcaseModel({
    modelName: "Scarlet Steam Locomotive",
    prompt: "build the scarlet steam locomotive showcase",
    generatorVersion: "showcase-steam-locomotive-v1",
    inventory,
    bricks,
    notes: [
      "Inventory-safe display locomotive with layered mechanical detailing.",
      "Ordered from chassis and wheels through boiler, cab, and roof details.",
    ],
  });
}
```

- [ ] **Step 4: Run the focused test and refine to GREEN**

Run: `node --test test/generation/showcaseSteamLocomotiveModel.test.js`

Expected: all locomotive tests pass with no overlaps, disconnected-component errors, or inventory errors.

- [ ] **Step 5: Commit the locomotive**

```bash
git add src/generation/fixtures/showcaseSteamLocomotiveModel.js test/generation/showcaseSteamLocomotiveModel.test.js
git commit -m "feat: add inventory-safe steam locomotive"
```

### Task 3: Midnight Grand Piano asset

**Files:**
- Create: `src/generation/fixtures/showcaseGrandPianoModel.js`
- Create: `test/generation/showcaseGrandPianoModel.test.js`

**Interfaces:**
- Consumes: `fixedDemoInventory` and the Task 1 helper.
- Produces: `buildShowcaseGrandPianoModel(inventory = fixedDemoInventory): GeneratedModel`.

- [ ] **Step 1: Write failing piano contract tests**

Assert schema validity, deterministic deep equality, validator validity, at least 110 pieces, and nonempty features for `case-base`, `curved-rim`, `soundboard`, `keyboard-bed`, `white-key`, `black-key`, `music-desk`, `leg`, `pedal`, `bench`, and `raised-lid`. Independently enforce inventory counts. Assert a black case/lid, white keys, black accidentals, brown soundboard/bench, and yellow pedals.

- [ ] **Step 2: Run the focused test and confirm RED**

Run: `node --test test/generation/showcaseGrandPianoModel.test.js`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for the piano builder.

- [ ] **Step 3: Implement the piano placement program**

Build a wide keyboard end that narrows toward the tail, using staggered black courses to suggest the grand-piano curve. Support it with three connected legs and braces; fill the interior with a warm brown soundboard; alternate individual white keys and raised black accidentals; add fallboard and music desk; attach a thin raised black lid as a supported diagonal-looking stepped plane; add yellow pedals and a separate-but-validly-connected bench via a narrow floor/base bridge so the validator sees one assembly. Return generator version `showcase-grand-piano-v1`.

```js
export function buildShowcaseGrandPianoModel(inventory = fixedDemoInventory) {
  const bricks = [];
  const brick = createShowcaseBrickFactory(inventory, "Midnight Grand Piano");
  addFloorAndLegs(bricks, brick);
  addCaseAndSoundboard(bricks, brick);
  addKeyboard(bricks, brick);
  addDeskAndRaisedLid(bricks, brick);
  addPedalsAndBench(bricks, brick);
  return completeShowcaseModel({
    modelName: "Midnight Grand Piano",
    prompt: "build the midnight grand piano showcase",
    generatorVersion: "showcase-grand-piano-v1",
    inventory,
    bricks,
    notes: [
      "Layered concert grand with keyboard, soundboard, lid, pedals, and bench.",
      "Ordered from supports through casework, keys, and raised display details.",
    ],
  });
}
```

- [ ] **Step 4: Run the focused test and refine to GREEN**

Run: `node --test test/generation/showcaseGrandPianoModel.test.js`

Expected: all piano tests pass with no overlaps, disconnected-component errors, or inventory errors.

- [ ] **Step 5: Commit the piano**

```bash
git add src/generation/fixtures/showcaseGrandPianoModel.js test/generation/showcaseGrandPianoModel.test.js
git commit -m "feat: add inventory-safe grand piano"
```

### Task 4: Public showcase registry and deterministic replay

**Files:**
- Create: `src/generation/showcaseBuilds.js`
- Create: `test/generation/showcaseBuilds.test.js`

**Interfaces:**
- Consumes: both fixture builders, `validateGeneratedModelShape`, and `validateModel`.
- Produces: `SHOWCASE_BUILDS`, `listShowcaseBuildSuggestions()`, `findShowcaseBuild({showcaseId, userPrompt})`, `isShowcaseBuildRequest(body)`, `generateShowcaseBuild({showcaseId, userPrompt, inventory, onProgress, delayMs})`.

- [ ] **Step 1: Write failing registry tests**

Assert immutable descriptors for IDs `scarlet-steam-locomotive` and `midnight-grand-piano`; suggestions containing `label`, `prompt_metadata`, and `showcase_id`; exact-ID lookup; normalized prompt fallback; no match for ordinary prompts; and deterministic replay events ordered by step/source index with every output brick emitted exactly once.

```js
const events = [];
const result = await generateShowcaseBuild({
  showcaseId: "scarlet-steam-locomotive",
  userPrompt: "ignored after exact id",
  inventory: fixedDemoInventory,
  delayMs: 0,
  onProgress: async (event) => events.push(event),
});
assert.equal(result.ok, true);
assert.equal(events.filter(({ type }) => type === "brick").length, result.model.piece_count);
```

- [ ] **Step 2: Run the focused test and confirm RED**

Run: `node --test test/generation/showcaseBuilds.test.js`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `showcaseBuilds.js`.

- [ ] **Step 3: Implement registry, result, and replay**

Freeze descriptor objects and their suggestion metadata. Normalize prompt text with lowercase alphanumerics and whitespace. Exact valid ID takes precedence; an unknown explicit ID returns no showcase instead of falling back. For prompt fallback, require a descriptor-specific phrase such as `scarlet steam locomotive` or `midnight grand piano`. Build, shape-check, validate, sort indexed bricks by step/index, emit `structure_generate` start/complete, `placement_generate` start, each `{type: "brick", phase: "placement", brick}`, `placement_generate` complete, and `validation` complete. Return `{ok:true, stage:"complete", complete:true, requiresRefinement:false, model, validation}`; return `{ok:false,...}` only if a constructed model fails validation.

```js
export const SHOWCASE_BUILDS = Object.freeze([
  Object.freeze({
    id: "scarlet-steam-locomotive",
    label: "Scarlet Steam Locomotive",
    prompt_metadata: "Detailed red-and-black display engine with working-style rods, cab, and smokestack",
    promptPhrases: Object.freeze(["scarlet steam locomotive"]),
    buildModel: buildShowcaseSteamLocomotiveModel,
  }),
  Object.freeze({
    id: "midnight-grand-piano",
    label: "Midnight Grand Piano",
    prompt_metadata: "Elegant black concert grand with full keyboard, raised lid, pedals, and bench",
    promptPhrases: Object.freeze(["midnight grand piano"]),
    buildModel: buildShowcaseGrandPianoModel,
  }),
]);
```

- [ ] **Step 4: Run the focused test and confirm GREEN**

Run: `node --test test/generation/showcaseBuilds.test.js`

Expected: all registry and replay tests pass.

- [ ] **Step 5: Commit the registry**

```bash
git add src/generation/showcaseBuilds.js test/generation/showcaseBuilds.test.js
git commit -m "feat: add importable showcase build registry"
```

### Task 5: Server and preview integration

**Files:**
- Modify: `server/generationServer.js`
- Create: `src/preview/showcaseSelection.js`
- Modify: `src/preview/main.js`
- Modify: `src/preview/fixturePreviewPicker.js`
- Modify: `test/server/generationServerEvents.test.js`
- Create: `test/preview/showcaseSelection.test.js`
- Modify: `test/preview/fixturePreviewPicker.test.js`

**Interfaces:**
- Consumes: Task 4 registry APIs.
- Produces: optional generation request field `showcase_id: string`; local suggestion/server flow; two development preview entries.

- [ ] **Step 1: Write failing request and integration tests**

Extend server validation tests to accept a nonempty string `showcase_id`, reject nonstrings/empty strings, and expose a pure `generationCredentialError(env, body)` behavior that returns `null` for a recognized ID without credentials while preserving the existing error for normal prompts. Test selection state: selecting a suggestion returns its ID in the request payload, manual prompt input clears it, and suggestions without IDs preserve old behavior. Update fixture picker expected IDs to include both showcases and validate them with their fixed inventory.

```js
assert.equal(generationCredentialError({}, {
  showcase_id: "scarlet-steam-locomotive",
  userPrompt: "build it",
}), null);
assert.equal(generationCredentialError({}, { userPrompt: "build a tank" }), "GEMINI_API_KEY is required.");
```

- [ ] **Step 2: Run focused tests and confirm RED**

Run: `node --test test/server/generationServerEvents.test.js test/preview/showcaseSelection.test.js test/preview/fixturePreviewPicker.test.js`

Expected: failures for the missing selection helper, old credential signature, and missing preview IDs.

- [ ] **Step 3: Implement the testable selection helper**

Expose a closure with `selectSuggestion(suggestion)`, `clear()`, and `extendGenerationPayload(payload)`. Only retain a trimmed nonempty `showcase_id`. In `main.js`, call `selectSuggestion` on suggestion click, clear it on the prompt's user `input` event and inventory change, and spread the extended payload into `/api/generate/stream`.

```js
export function createShowcaseSelection() {
  let showcaseId;
  return {
    selectSuggestion(suggestion) {
      showcaseId = typeof suggestion?.showcase_id === "string" && suggestion.showcase_id.trim()
        ? suggestion.showcase_id.trim()
        : undefined;
    },
    clear() { showcaseId = undefined; },
    extendGenerationPayload(payload) {
      return showcaseId ? { ...payload, showcase_id: showcaseId } : { ...payload };
    },
  };
}
```

- [ ] **Step 4: Integrate local server generation before credentials**

Import Task 4 APIs. Validate `showcase_id` when present. Read and validate bodies before credential checks in both JSON and stream handlers. Pass `body` to `generationCredentialError`; recognized showcases bypass credentials. At the top of `createGenerationResult`, call `generateShowcaseBuild` with `delayMs` read from `SHOWCASE_STREAM_DELAY_MS` (default `35` for streams and `0` for JSON). For suggestions, always start with the two local suggestions; without credentials return them immediately, and with credentials append provider suggestions then cap the result at five. Put both descriptors into the fixture picker with `fixedDemoInventory`.

```js
if (isShowcaseBuildRequest(body)) {
  return generateShowcaseBuild({
    showcaseId: body.showcase_id,
    userPrompt,
    inventory,
    onProgress,
    delayMs: streamPlacement ? showcaseStreamDelayMs(process.env) : 0,
  });
}
```

- [ ] **Step 5: Run focused tests and confirm GREEN**

Run: `node --test test/server/generationServerEvents.test.js test/preview/showcaseSelection.test.js test/preview/fixturePreviewPicker.test.js`

Expected: all focused server and preview tests pass.

- [ ] **Step 6: Commit the integration**

```bash
git add server/generationServer.js src/preview/showcaseSelection.js src/preview/main.js src/preview/fixturePreviewPicker.js test/server/generationServerEvents.test.js test/preview/showcaseSelection.test.js test/preview/fixturePreviewPicker.test.js
git commit -m "feat: stream showcase builds through existing UI"
```

### Task 6: Multi-angle visual refinement and full verification

**Files:**
- Modify if visual defects are found: `src/generation/fixtures/showcaseSteamLocomotiveModel.js`
- Modify if visual defects are found: `src/generation/fixtures/showcaseGrandPianoModel.js`
- Modify alongside asset changes: corresponding tests.

**Interfaces:**
- Consumes: the running Vite preview and fixture picker.
- Produces: visually reviewed final assets and verification evidence.

- [ ] **Step 1: Run the complete automated suite**

Run: `npm test`

Expected: all tests pass with zero failures.

- [ ] **Step 2: Build the production bundle**

Run: `npm run build`

Expected: Vite exits successfully and writes `dist/`.

- [ ] **Step 3: Render and inspect both assets**

Start the normal development services, select each showcase from the fixture picker, and capture front three-quarter, rear three-quarter, and top-side views. Verify silhouette, connected appearance, purposeful color blocking, readable details, and camera framing. Then select each through its suggestion button and confirm the live preview grows brick-by-brick before landing on the identical final model.

- [ ] **Step 4: Correct any concrete visual defects**

Adjust only coordinates, part choices, colors, or step ordering tied to observed defects. Re-run the affected asset test after every adjustment and repeat the same camera angle to confirm the correction.

- [ ] **Step 5: Re-run final verification**

Run: `npm test && npm run build && git diff --check`

Expected: all tests pass, build succeeds, and `git diff --check` prints nothing.

- [ ] **Step 6: Commit visual refinements if any**

```bash
git add src/generation/fixtures/showcaseSteamLocomotiveModel.js src/generation/fixtures/showcaseGrandPianoModel.js test/generation/showcaseSteamLocomotiveModel.test.js test/generation/showcaseGrandPianoModel.test.js
git commit -m "refine: polish inventory showcase models"
```
