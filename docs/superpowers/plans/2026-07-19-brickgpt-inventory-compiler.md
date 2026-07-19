# BrickGPT Inventory Compiler Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate several local BrickGPT shape proposals and deterministically compile the best one into a validator-safe `GeneratedModel` using only the fixed 787-piece inventory.

**Architecture:** Keep BrickGPT behind a JSON stdin/stdout Python sidecar and treat its uncolored rectangular placements as target volume. New focused JavaScript modules normalize that volume, retile it from exact inventory with deterministic multi-start search, score candidates, and expose the winner through the existing generation server and preview contracts.

**Tech Stack:** JavaScript ES modules, Node `node:test`, Node `child_process`, Python 3.10+, official `brickgpt` package, existing Vite/Three.js/LDraw preview.

## Global Constraints

- Final models may use any number of pieces up to exact selected-inventory quantities.
- Hybrid generation must not require Gemini or Backboard credentials.
- Do not vendor model weights, Hugging Face tokens, Gurobi licenses, or runtime outputs.
- The legacy AI-coordinate pipeline retains a separate 100-piece prompt cap.
- Hybrid failures must not silently fall back to Gemini or Backboard.
- Normal tests must not download weights, require a GPU/Gurobi, or call external APIs.
- Preserve the existing `GeneratedModel` output shape and downstream preview/editor/LDraw interfaces.

---

### Task 1: Normalize the fixed inventory and complete catalog coverage

**Files:**
- Create: `src/generation/colorCatalog.js`
- Create: `src/generation/fixtures/fixedDemoInventory.js`
- Create: `scripts/buildFixedDemoInventory.js`
- Create: `test/generation/fixedDemoInventory.test.js`
- Modify: `src/generation/partCatalog.js`
- Modify: `src/preview/brickScene.js`
- Modify: `test/generation/partCatalog.test.js`
- Modify: `test/preview/brickScene.test.js`

**Interfaces:**
- Consumes: committed `demo-assets/lego-inventory-for-model-generation-20260719.csv`.
- Produces: `fixedDemoInventory`, `LDRAW_COLORS`, and catalog coverage for all 32 inventory footprints.

- [ ] **Step 1: Write failing inventory/catalog tests**

```js
import { fixedDemoInventory } from "../../src/generation/fixtures/fixedDemoInventory.js";
import { SUPPORTED_PARTS } from "../../src/generation/partCatalog.js";

assert.equal(fixedDemoInventory.items.length, 147);
assert.equal(fixedDemoInventory.items.reduce((n, item) => n + item.count, 0), 787);
assert.equal(new Set(fixedDemoInventory.items.map((item) => item.part_id)).size, 32);
assert.equal(fixedDemoInventory.items.every((item) => SUPPORTED_PARTS[item.part_id]), true);
```

- [ ] **Step 2: Run tests and verify missing-module/catalog failures**

Run: `node --test test/generation/fixedDemoInventory.test.js test/generation/partCatalog.test.js test/preview/brickScene.test.js`

Expected: FAIL because `fixedDemoInventory.js` and the twelve part mappings do not exist.

- [ ] **Step 3: Add canonical part/color maps and deterministic CSV conversion**

Implement mappings for brick `1x12`, `2x6`, `2x8`; plate `1x8`, `1x10`, `2x10`, `2x16`, `4x10`, `4x12`, `6x6`, `6x8`, `6x10`; and colors black, blue, brown, dark green, green, light gray, dark gray, orange, red, tan/beige, white, yellow. The conversion script must throw on unknown labels/colors and emit stable item order.

```js
export const LDRAW_COLORS = Object.freeze({
  black: { color_name: "black", color_id: "0", hex: 0x05131d },
  blue: { color_name: "blue", color_id: "1", hex: 0x0055bf },
  green: { color_name: "green", color_id: "2", hex: 0x237841 },
  red: { color_name: "red", color_id: "4", hex: 0xc91a09 },
  brown: { color_name: "brown", color_id: "6", hex: 0x583927 },
  light_gray: { color_name: "light gray", color_id: "71", hex: 0xa0a5a9 },
  dark_gray: { color_name: "dark gray", color_id: "72", hex: 0x6c6e68 },
  yellow: { color_name: "yellow", color_id: "14", hex: 0xf2cd37 },
  white: { color_name: "white", color_id: "15", hex: 0xffffff },
  beige: { color_name: "beige", color_id: "19", hex: 0xe4cd9e },
  orange: { color_name: "orange", color_id: "25", hex: 0xfe8a18 },
  dark_green: { color_name: "dark green", color_id: "288", hex: 0x184632 },
});
```

- [ ] **Step 4: Run focused tests and commit**

Run: `node --test test/generation/fixedDemoInventory.test.js test/generation/partCatalog.test.js test/preview/brickScene.test.js`

Expected: PASS.

Commit: `feat: normalize fixed LEGO inventory`

### Task 2: Replace shared piece cap with inventory-bounded validation

**Files:**
- Modify: `src/generation/partCatalog.js`
- Modify: `src/generation/generationPrompts.js`
- Modify: `src/generation/validator.js`
- Modify: `test/generation/generationPrompts.test.js`
- Modify: `test/generation/validator.test.js`

**Interfaces:**
- Produces: `LEGACY_AI_MODEL_PIECE_CAP = 100`; validator hard limits only exact inventory counts.

- [ ] **Step 1: Write failing tests**

```js
it("accepts more than 100 legal pieces when inventory contains them", () => {
  const model = modelWithRepeatedLegalBricks(101);
  const result = validateModel(model, inventoryWithCount(101));
  assert.equal(result.errors.some((error) => error.type === "piece_count_exceeded"), false);
});

it("keeps the legacy prompt cap at 100", () => {
  const request = buildStructurePrompt({ targetPieceCount: 787, /* fixture args */ });
  assert.match(request.contents[0].parts[0].text, /100-piece legacy AI cap/);
});
```

- [ ] **Step 2: Verify RED**

Run: `node --test test/generation/validator.test.js test/generation/generationPrompts.test.js`

Expected: FAIL because validation still emits `piece_count_exceeded` above 100.

- [ ] **Step 3: Split prompt and validation policy**

Rename `MAX_MODEL_PIECES` to `LEGACY_AI_MODEL_PIECE_CAP`, update prompt clamping/copy, and remove the shared validator piece-count check. Retain exact per-part/color inventory count errors.

- [ ] **Step 4: Verify GREEN and commit**

Run: `node --test test/generation/validator.test.js test/generation/generationPrompts.test.js`

Expected: PASS.

Commit: `feat: make hybrid piece count inventory bounded`

### Task 3: Normalize BrickGPT output into target volumes

**Files:**
- Create: `src/generation/hybrid/targetVolume.js`
- Create: `test/generation/targetVolume.test.js`

**Interfaces:**
- Produces: `normalizeBrickGptTarget({ seed, bricks, worldDim }): TargetVolume`.
- `TargetVolume` contains `{ seed, cells: Set<string>, exteriorCells: Set<string>, bounds, sourceBricks }` in plate-layer coordinates.

- [ ] **Step 1: Write failing normalization tests**

```js
const target = normalizeBrickGptTarget({
  seed: 7,
  worldDim: 20,
  bricks: [{ width: 1, depth: 2, x: 4, y: 8, z: 1 }],
});
assert.deepEqual(target.bounds, { width: 1, depth: 2, height: 3 });
assert.deepEqual([...target.cells].sort(), ["0,0,0", "0,0,1", "0,0,2", "0,1,0", "0,1,1", "0,1,2"]);
```

Also test origin translation, void preservation, overlap rejection, negative/non-integer input, and world bounds.

- [ ] **Step 2: Verify RED**

Run: `node --test test/generation/targetVolume.test.js`

Expected: FAIL with module-not-found.

- [ ] **Step 3: Implement target normalization**

Use canonical cell keys `x,y,z`. Expand every BrickGPT brick into three plate layers, reject duplicate occupied cells, translate minimum coordinates to zero, and mark a cell exterior when any of its six neighbors is absent.

- [ ] **Step 4: Verify GREEN and commit**

Run: `node --test test/generation/targetVolume.test.js`

Expected: PASS.

Commit: `feat: normalize BrickGPT target geometry`

### Task 4: Compile target volumes from exact inventory

**Files:**
- Create: `src/generation/hybrid/inventoryCompiler.js`
- Create: `src/generation/hybrid/candidateScorer.js`
- Create: `test/generation/inventoryCompiler.test.js`
- Create: `test/generation/candidateScorer.test.js`

**Interfaces:**
- Consumes: `TargetVolume`, `Inventory`, `SUPPORTED_PARTS`.
- Produces: `compileTargetVolume({ target, inventory, prompt, beamWidth, variants }): CompiledCandidate[]`.
- Produces: `scoreCompiledCandidate(candidate): { score, metrics }` and `selectBestCandidate(candidates)`.

- [ ] **Step 1: Write failing compiler/scorer tests**

```js
const [candidate] = compileTargetVolume({ target, inventory, prompt: "red tower", beamWidth: 12, variants: 2 });
assert.equal(candidate.validation.valid, true);
assert.equal(candidate.coveredCells.size, target.cells.size);
assert.equal(candidate.model.bricks.every((brick) => inventoryHas(brick, inventory)), true);
```

Cover exact tiling, rotated parts, brick/plate substitution, inventory exhaustion, unsupported inventory rows, support, deterministic repeatability, coherent prompt colors, partial coverage preferring interior omissions, and scorer disqualification of invalid models.

- [ ] **Step 2: Verify RED**

Run: `node --test test/generation/inventoryCompiler.test.js test/generation/candidateScorer.test.js`

Expected: FAIL with module-not-found.

- [ ] **Step 3: Implement constrained deterministic multi-start search**

Represent a state as:

```js
{
  placements: [],
  covered: new Set(),
  remaining: new Map(),
  score: 0,
}
```

Choose the lowest uncovered cell, enumerate supported placements in both rotations that stay inside the target and remaining inventory, prefer larger volume while preserving exterior cells, and retain the highest-ranked `beamWidth` states. Convert finished states into `GeneratedModel`, assign contiguous available colors with prompt colors preferred, run `validateGeneratedModelShape()` and `validateModel()`, then calculate coverage/exterior/color metrics.

- [ ] **Step 4: Verify GREEN and commit**

Run: `node --test test/generation/inventoryCompiler.test.js test/generation/candidateScorer.test.js`

Expected: PASS.

Commit: `feat: compile targets from exact inventory`

### Task 5: Add the BrickGPT Python sidecar and safe Node adapter

**Files:**
- Create: `python/brickgpt_sidecar.py`
- Create: `src/generation/hybrid/brickGptClient.js`
- Create: `test/fixtures/fakeBrickGptSidecar.js`
- Create: `test/generation/brickGptClient.test.js`

**Interfaces:**
- Produces: `createBrickGptClient(config).generate({ prompt, seed, worldDim, maxBricks, useGurobi, signal })`.
- Sidecar reads exactly one JSON object from stdin and writes exactly one JSON object to stdout.

- [ ] **Step 1: Write failing process-adapter tests**

```js
const client = createBrickGptClient({
  pythonExecutable: process.execPath,
  sidecarPath: fakeSidecarPath,
  timeoutMs: 1000,
});
const result = await client.generate({ prompt: "$(touch /tmp/nope)", seed: 9, worldDim: 20, maxBricks: 50, useGurobi: false });
assert.equal(result.seed, 9);
assert.equal(result.bricks[0].width, 2);
```

Also test timeout termination, nonzero exit, malformed/oversized JSON, missing package/HF token errors, abort signals, and literal handling of shell metacharacters.

- [ ] **Step 2: Verify RED**

Run: `node --test test/generation/brickGptClient.test.js`

Expected: FAIL with module-not-found.

- [ ] **Step 3: Implement sidecar and adapter**

Spawn with `shell: false`, fixed arguments, bounded stdout/stderr, and timeout/abort cleanup. The Python script validates required keys, imports `BrickGPT` lazily, sets the requested seed, calls the official model, and serializes dimensions/positions plus rejection metadata.

- [ ] **Step 4: Verify GREEN and commit**

Run: `node --test test/generation/brickGptClient.test.js`

Expected: PASS without importing or downloading BrickGPT.

Commit: `feat: add local BrickGPT sidecar adapter`

### Task 6: Orchestrate multi-seed hybrid generation

**Files:**
- Create: `src/generation/hybrid/service.js`
- Create: `test/generation/hybridService.test.js`
- Modify: `src/generation/modelConfig.js`
- Modify: `server/generationServer.js`
- Modify: `test/generation/modelConfig.test.js`
- Modify: `test/server/generationServerEvents.test.js`

**Interfaces:**
- Produces: `generateHybridModel({ userPrompt, inventory, geometryProvider, candidateCount, seedBase, compilerOptions, onProgress, signal })`.
- Produces: `resolveHybridGenerationConfig(env)` and generation mode `brickgpt_inventory`.

- [ ] **Step 1: Write failing orchestration/config tests**

```js
const result = await generateHybridModel({
  userPrompt: "red tower",
  inventory,
  candidateCount: 3,
  seedBase: 40,
  geometryProvider: fakeProvider,
  onProgress: (event) => events.push(event),
});
assert.equal(result.ok, true);
assert.deepEqual(fakeProvider.seeds, [40, 41, 42]);
assert.equal(result.model.generator_version, "brickgpt-inventory-v1");
assert.equal(result.validation.valid, true);
```

Verify partial seed failures, no valid candidates, deterministic winner, current-best draft events, and configuration that does not inspect Gemini/Backboard keys in hybrid mode.

- [ ] **Step 2: Verify RED**

Run: `node --test test/generation/hybridService.test.js test/generation/modelConfig.test.js test/server/generationServerEvents.test.js`

Expected: FAIL because hybrid orchestration/config do not exist.

- [ ] **Step 3: Implement orchestration and server selection**

Emit `geometry_generate`, `geometry_normalize`, `inventory_compile`, `candidate_validate`, and `candidate_select`. Try deterministic seeds, continue after individual failures, validate every compiled model, return diagnostics, and bypass AI-client creation plus refinement in hybrid mode.

- [ ] **Step 4: Verify GREEN and commit**

Run: `node --test test/generation/hybridService.test.js test/generation/modelConfig.test.js test/server/generationServerEvents.test.js`

Expected: PASS.

Commit: `feat: serve hybrid BrickGPT generation`

### Task 7: Preview integration, setup documentation, and full verification

**Files:**
- Modify: `src/preview/main.js`
- Modify: `test/preview/providerCopy.test.js`
- Modify: `package.json`
- Modify: `.env.example`
- Modify: `README.md`
- Create: `scripts/checkBrickGptSetup.js`
- Create: `test/generation/brickGptSetup.test.js`

**Interfaces:**
- Produces: mode-aware progress copy and `npm run check:brickgpt`.

- [ ] **Step 1: Write failing copy/setup tests**

Assert hybrid stage labels are recognized, provider copy is mode-neutral, `.env.example` contains no secret values, and the setup checker distinguishes missing `HF_TOKEN`, missing Python package, and a ready environment.

- [ ] **Step 2: Verify RED**

Run: `node --test test/preview/providerCopy.test.js test/generation/brickGptSetup.test.js`

Expected: FAIL because the setup checker and hybrid copy do not exist.

- [ ] **Step 3: Implement UI copy, environment example, checker, and README setup**

Add `"build": "vite build"` and `"check:brickgpt": "node scripts/checkBrickGptSetup.js"` package scripts. Document Python 3.10+, official BrickGPT installation, gated Llama access, `HF_TOKEN`, non-Gurobi default, hybrid environment variables, health check, and an opt-in real-model smoke command. Do not print token values.

- [ ] **Step 4: Run focused and full verification**

Run:

```bash
node --test test/generation/fixedDemoInventory.test.js \
  test/generation/targetVolume.test.js \
  test/generation/inventoryCompiler.test.js \
  test/generation/candidateScorer.test.js \
  test/generation/brickGptClient.test.js \
  test/generation/hybridService.test.js \
  test/server/generationServerEvents.test.js
npm test
npm run build
```

Expected: all new/focused tests and build pass. For the full suite, report the exact status of the four known deleted-fixture import failures separately if they remain.

- [ ] **Step 5: Commit**

Commit: `docs: add BrickGPT hybrid setup and verification`
