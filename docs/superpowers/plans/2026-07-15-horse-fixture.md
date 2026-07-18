# Horse Fixture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a deterministic, validator-valid brown horse LEGO fixture and show it in the existing Three.js preview.

**Architecture:** Add a horse inventory and horse model beside the existing fixture files. Verify the model through the current validator and LDraw exporter, then switch the preview imports from daisy to horse.

**Tech Stack:** JavaScript ES modules, Node `node:test`, Three.js preview, existing LDraw export pipeline.

## Global Constraints

- The horse must be a single connected assembly.
- Connections must come from vertical stud overlap only.
- Same-layer side contact must not be relied on for structure.
- The model must include body, head, four legs, hooves, mane, and tail.
- The model must have 3D volume, not a flat 2D side profile.
- Use only supported rectangular MVP parts from `src/generation/partCatalog.js`.
- Keep the model under the 50-piece hard limit.
- The current folder is not a git checkout, so skip commit steps.

---

### Task 1: Horse Fixture Test

**Files:**
- Create: `test/generation/horseModel.test.js`

**Interfaces:**
- Consumes: `buildHorseModel(inventory)` from `src/generation/fixtures/horseModel.js`
- Consumes: `horseInventory` from `src/generation/fixtures/horseInventory.js`
- Produces: failing tests that define required fixture behavior

- [ ] **Step 1: Write the failing test**

```js
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildHorseModel } from "../../src/generation/fixtures/horseModel.js";
import { horseInventory } from "../../src/generation/fixtures/horseInventory.js";
import { validateModel } from "../../src/generation/validator.js";
import { exportModelToLDraw } from "../../src/ldraw/exportLDraw.js";

describe("buildHorseModel", () => {
  it("builds a validator-valid 3D horse with connected legs and details", () => {
    const model = buildHorseModel(horseInventory);

    const validation = validateModel(model, horseInventory);

    assert.equal(model.model_name, "Brown Horse");
    assert.equal(model.piece_count < 50, true);
    assert.equal(validation.valid, true);
    assert.deepEqual(validation.errors, []);
    assert.equal(model.bricks.filter((brick) => brick.feature === "leg").length, 4);
    assert.equal(model.bricks.filter((brick) => brick.feature === "hoof").length, 4);
    assert.equal(model.bricks.some((brick) => brick.feature === "body"), true);
    assert.equal(model.bricks.some((brick) => brick.feature === "head"), true);
    assert.equal(model.bricks.some((brick) => brick.feature === "mane"), true);
    assert.equal(model.bricks.some((brick) => brick.feature === "tail"), true);
    assert.equal(model.dimensions.depth_studs >= 4, true);
    assert.equal(model.dimensions.height_layers >= 5, true);
  });

  it("exports brown horse pieces and black details to packed LDraw", () => {
    const model = buildHorseModel(horseInventory);

    const ldraw = exportModelToLDraw(model);

    assert.match(ldraw, /^0 Brown Horse$/m);
    assert.match(ldraw, /^0 !COLOUR Brown CODE 6 VALUE #583927 EDGE #333333$/m);
    assert.match(ldraw, /^0 !COLOUR Black CODE 0 VALUE #05131D EDGE #595959$/m);
    assert.match(ldraw, /^1 6 /m);
    assert.match(ldraw, /^1 0 /m);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/generation/horseModel.test.js`
Expected: FAIL because `src/generation/fixtures/horseModel.js` does not exist.

### Task 2: Horse Inventory and Model

**Files:**
- Create: `src/generation/fixtures/horseInventory.js`
- Create: `src/generation/fixtures/horseModel.js`
- Modify: `src/ldraw/exportLDraw.js`

**Interfaces:**
- Produces: `horseInventory`
- Produces: `buildHorseModel(inventory = horseInventory)`
- Extends: LDraw color directives with brown color ID `6`

- [ ] **Step 1: Add supported horse inventory**

Create a manual inventory with brown `2x4`, `2x3`, `2x2`, `1x2`, and `1x1` bricks plus black `1x2` and `1x1` bricks.

- [ ] **Step 2: Add the deterministic model**

Create a 20-piece horse:

- Step 1: four black hoof bricks on `z=0`
- Step 2: four brown leg bricks on `z=1`
- Step 3: brown lower body bricks on `z=2` overlapping all legs
- Step 4: staggered brown upper body and neck bricks on `z=3`
- Step 5: brown head bricks and black mane pieces on `z=4`
- Step 6: black mane/tail pieces on `z=5`

- [ ] **Step 3: Add brown LDraw color directive**

Add this line to `COLOUR_DIRECTIVES`:

```js
"0 !COLOUR Brown CODE 6 VALUE #583927 EDGE #333333",
```

- [ ] **Step 4: Run horse test to verify it passes**

Run: `node --test test/generation/horseModel.test.js`
Expected: PASS.

### Task 3: Preview Swap and Full Verification

**Files:**
- Modify: `src/preview/main.js`

**Interfaces:**
- Consumes: `horseInventory`
- Consumes: `buildHorseModel`
- Produces: preview rendering the horse fixture

- [ ] **Step 1: Update preview imports**

Replace daisy imports with:

```js
import { horseInventory } from "../generation/fixtures/horseInventory.js";
import { buildHorseModel } from "../generation/fixtures/horseModel.js";
```

- [ ] **Step 2: Update preview model construction**

Replace the daisy model setup with:

```js
const model = buildHorseModel(horseInventory);
const validation = validateModel(model, horseInventory);
```

- [ ] **Step 3: Run full tests**

Run: `npm test`
Expected: all tests pass.

- [ ] **Step 4: Run build**

Run: `npm run build`
Expected: exit code `0` if the project has a build script. If no build script exists, report that preview verification is limited to tests and source import checks.
