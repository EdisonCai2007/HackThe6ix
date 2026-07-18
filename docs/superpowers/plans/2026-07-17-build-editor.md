# Build Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a permissive Three.js LEGO editor where users can add, move, rotate, and manually fix generated builds before entering instructions.

**Architecture:** Keep generated model JSON as the source of truth and add a focused editor layer around it. Pure model helpers handle snapping, inventory usage, placement, and instruction-gate validation; the Three.js scene keeps per-brick objects alive so normal edits update one object instead of reparsing the whole model.

**Tech Stack:** Vite, vanilla JavaScript modules, Three.js, `OrbitControls`, `TransformControls`, existing Node `node --test` test runner.

## Global Constraints

- The editor must be permissive during editing and only block when the user clicks `Instructions`.
- The model JSON remains authoritative.
- Normal editor interactions must update individual brick objects, not visibly reload the whole model.
- The default tool is `hand`.
- The toolbar has exactly three editing tools: `hand`, `axis`, and `rotate`.
- Hand dragging follows the pointer freely and snaps on release.
- Axis movement is grid-constrained and precise.
- Rotation is 90 degrees around the visual center.
- Invalid pieces are highlighted with flashing red xray-style outlines; users fix issues manually.
- The right catalogue lists all supported inventory pieces, including used-up pieces as disabled greyed cards.
- The full generation timeline becomes one compact status line with a spinner.
- Do not change AI generation behavior unless required to pass model state into the editor.

---

## File Structure

- Create `src/preview/editorGeometry.js`
  - Pure geometry helpers for grid snapping, part footprints, occupied cells, top-surface height lookup, and LDU transform conversion.
- Create `src/preview/editorState.js`
  - Pure model-state helpers for inventory counts, adding bricks, moving bricks, rotating bricks, removing bricks, and instruction-gate validation.
- Create `test/preview/editorGeometry.test.js`
  - Unit tests for snapping, footprint cells, top-surface placement, and coordinate conversion.
- Create `test/preview/editorState.test.js`
  - Unit tests for catalogue counts, add/move/rotate behavior, and instruction-gate validation.
- Create `src/preview/brickScene.js`
  - Three.js per-brick object creation, transform updates, selection state, and invalid highlight styling.
- Create `src/preview/editorControls.js`
  - Pointer/raycast hand dragging, `TransformControls` axis movement, rotate action, and tool lifecycle.
- Modify `src/preview/main.js`
  - Wire editor state, catalogue rendering, toolbar events, scene sync, status line, and instructions gate into the existing preview.
- Modify `src/preview/styles.css`
  - Add toolbar, right catalogue, compact status, active/disabled states, and red xray highlight animation.
- Modify `index.html`
  - Add toolbar, status line replacement, catalogue panel, and instructions button.
- Modify `src/generation/validator.js`
  - Add snapped-position validation and expose affected brick IDs where practical.
- Modify `test/generation/validator.test.js`
  - Cover off-grid coordinates and invalid rotations.

---

### Task 1: Pure Editor Geometry

**Files:**
- Create: `src/preview/editorGeometry.js`
- Test: `test/preview/editorGeometry.test.js`

**Interfaces:**
- Consumes: `getPartDimensions(partId, rotation)` from `src/generation/partCatalog.js`
- Produces:
  - `STUD_LDU: 20`
  - `PLATE_UNIT_LDU: 8`
  - `snapGridPosition(position: {x:number,y:number,z:number}): {x:number,y:number,z:number}`
  - `isSnappedGridPosition(position: {x:number,y:number,z:number}): boolean`
  - `normalizedRotation(rotation: number): 0 | 90 | 180 | 270 | null`
  - `occupiedCellsForBrick(brick: PlacedBrick): Array<{x:number,y:number,z:number}>`
  - `findDropZForFootprint(brick: PlacedBrick, bricks: PlacedBrick[]): number`
  - `positionToLduCenter(brick: PlacedBrick): THREE-like {x:number,y:number,z:number}`

- [ ] **Step 1: Write failing geometry tests**

Create `test/preview/editorGeometry.test.js`:

```js
import assert from "node:assert/strict";
import test from "node:test";

import {
  findDropZForFootprint,
  isSnappedGridPosition,
  normalizedRotation,
  occupiedCellsForBrick,
  positionToLduCenter,
  snapGridPosition,
} from "../../src/preview/editorGeometry.js";

test("snapGridPosition rounds studs and plate layers", () => {
  assert.deepEqual(
    snapGridPosition({ x: 1.49, y: 2.51, z: 3.2 }),
    { x: 1, y: 3, z: 3 },
  );
});

test("isSnappedGridPosition rejects off-grid editor positions", () => {
  assert.equal(isSnappedGridPosition({ x: 1, y: 2, z: 3 }), true);
  assert.equal(isSnappedGridPosition({ x: 1.2, y: 2, z: 3 }), false);
  assert.equal(isSnappedGridPosition({ x: 1, y: 2.4, z: 3 }), false);
  assert.equal(isSnappedGridPosition({ x: 1, y: 2, z: 3.1 }), false);
});

test("normalizedRotation accepts only quarter turns", () => {
  assert.equal(normalizedRotation(0), 0);
  assert.equal(normalizedRotation(90), 90);
  assert.equal(normalizedRotation(450), 90);
  assert.equal(normalizedRotation(-90), 270);
  assert.equal(normalizedRotation(45), null);
});

test("occupiedCellsForBrick respects plate-unit part height", () => {
  const cells = occupiedCellsForBrick({
    id: "brick-1",
    part_id: "3004",
    position: { x: 2, y: 4, z: 1 },
    rotation: 0,
  });

  assert.equal(cells.length, 6);
  assert.deepEqual(cells[0], { x: 2, y: 4, z: 1 });
  assert.deepEqual(cells.at(-1), { x: 2, y: 5, z: 3 });
});

test("findDropZForFootprint places a brick on top of the highest overlapping stack", () => {
  const moving = {
    id: "moving",
    part_id: "3004",
    position: { x: 0, y: 0, z: 0 },
    rotation: 0,
  };
  const existing = [
    {
      id: "base",
      part_id: "3035",
      position: { x: 0, y: 0, z: 0 },
      rotation: 0,
    },
    {
      id: "upper",
      part_id: "3005",
      position: { x: 0, y: 0, z: 1 },
      rotation: 0,
    },
  ];

  assert.equal(findDropZForFootprint(moving, existing), 4);
});

test("positionToLduCenter converts grid anchor to visible center coordinates", () => {
  assert.deepEqual(
    positionToLduCenter({
      id: "plate",
      part_id: "3020",
      position: { x: 2, y: 3, z: 1 },
      rotation: 90,
    }),
    { x: 80, y: -12, z: 80 },
  );
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/preview/editorGeometry.test.js`

Expected: FAIL with module not found for `src/preview/editorGeometry.js`.

- [ ] **Step 3: Implement geometry helpers**

Create `src/preview/editorGeometry.js`:

```js
import { getPartDimensions, SUPPORTED_PARTS } from "../generation/partCatalog.js";

export const STUD_LDU = 20;
export const PLATE_UNIT_LDU = 8;

export function snapGridPosition(position) {
  return {
    x: Math.round(position.x),
    y: Math.round(position.y),
    z: Math.round(position.z),
  };
}

export function isSnappedGridPosition(position) {
  return Number.isInteger(position.x) &&
    Number.isInteger(position.y) &&
    Number.isInteger(position.z);
}

export function normalizedRotation(rotation) {
  const normalized = ((rotation % 360) + 360) % 360;
  return normalized % 90 === 0 ? normalized : null;
}

export function occupiedCellsForBrick(brick) {
  const dimensions = getPartDimensions(brick.part_id, brick.rotation);

  if (!dimensions) {
    return [];
  }

  const cells = [];

  for (let x = brick.position.x; x < brick.position.x + dimensions.width; x += 1) {
    for (let y = brick.position.y; y < brick.position.y + dimensions.depth; y += 1) {
      for (let z = brick.position.z; z < brick.position.z + dimensions.height; z += 1) {
        cells.push({ x, y, z });
      }
    }
  }

  return cells;
}

function footprintCells(brick) {
  const dimensions = getPartDimensions(brick.part_id, brick.rotation);

  if (!dimensions) {
    return [];
  }

  const cells = [];

  for (let x = brick.position.x; x < brick.position.x + dimensions.width; x += 1) {
    for (let y = brick.position.y; y < brick.position.y + dimensions.depth; y += 1) {
      cells.push({ x, y });
    }
  }

  return cells;
}

export function findDropZForFootprint(brick, bricks) {
  const movingFootprint = new Set(
    footprintCells(brick).map((cell) => `${cell.x},${cell.y}`),
  );
  let highestTop = 0;

  for (const existingBrick of bricks) {
    if (existingBrick.id === brick.id) {
      continue;
    }

    const dimensions = getPartDimensions(existingBrick.part_id, existingBrick.rotation);

    if (!dimensions) {
      continue;
    }

    const overlaps = footprintCells(existingBrick).some((cell) =>
      movingFootprint.has(`${cell.x},${cell.y}`),
    );

    if (overlaps) {
      highestTop = Math.max(
        highestTop,
        existingBrick.position.z + dimensions.height,
      );
    }
  }

  return highestTop;
}

function partHeightLdu(part) {
  return part.category === "plate" ? PLATE_UNIT_LDU : PLATE_UNIT_LDU * 3;
}

export function positionToLduCenter(brick) {
  const part = SUPPORTED_PARTS[brick.part_id];
  const dimensions = getPartDimensions(brick.part_id, brick.rotation);

  if (!part || !dimensions) {
    return { x: 0, y: 0, z: 0 };
  }

  return {
    x: (brick.position.x + dimensions.width / 2) * STUD_LDU,
    y: -(brick.position.z * PLATE_UNIT_LDU + partHeightLdu(part) / 2),
    z: (brick.position.y + dimensions.depth / 2) * STUD_LDU,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/preview/editorGeometry.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/preview/editorGeometry.js test/preview/editorGeometry.test.js
git commit -m "feat: add editor geometry helpers"
```

---

### Task 2: Editor Model State And Instructions Gate Helpers

**Files:**
- Create: `src/preview/editorState.js`
- Test: `test/preview/editorState.test.js`

**Interfaces:**
- Consumes:
  - `snapGridPosition(position)`
  - `findDropZForFootprint(brick, bricks)`
  - `normalizedRotation(rotation)`
  - `validateModel(model, inventory)`
- Produces:
  - `inventoryKey(partId: string, colorId: string): string`
  - `catalogueItemsForModel(inventory: Inventory, model: GeneratedModel): Array<CatalogueItem>`
  - `addBrickFromCatalogue(model, inventoryItem, draftPosition): GeneratedModel`
  - `moveBrick(model, brickId, position, options): GeneratedModel`
  - `rotateBrickQuarterTurn(model, brickId): GeneratedModel`
  - `removeBrick(model, brickId): GeneratedModel`
  - `validateForInstructions(model, inventory): ValidationResult`

- [ ] **Step 1: Write failing editor-state tests**

Create `test/preview/editorState.test.js`:

```js
import assert from "node:assert/strict";
import test from "node:test";

import {
  addBrickFromCatalogue,
  catalogueItemsForModel,
  moveBrick,
  removeBrick,
  rotateBrickQuarterTurn,
  validateForInstructions,
} from "../../src/preview/editorState.js";

const inventory = {
  inventory_id: "test",
  source: "manual_test_fixture",
  items: [
    {
      label: "1x2 brick",
      category: "brick",
      part_id: "3004",
      ldraw_id: "3004.dat",
      color_name: "red",
      color_id: "4",
      count: 2,
      supported: true,
    },
  ],
};

function modelWith(bricks) {
  return {
    model_name: "Test",
    prompt: "test",
    piece_count: bricks.length,
    dimensions: { width_studs: 0, depth_studs: 0, height_layers: 0 },
    created_from_inventory_id: "test",
    generator_version: "test",
    notes: [],
    bricks,
  };
}

test("catalogueItemsForModel keeps used-up pieces visible and disabled", () => {
  const model = modelWith([
    {
      id: "a",
      part_id: "3004",
      ldraw_id: "3004.dat",
      label: "1x2 brick",
      color_id: "4",
      color_name: "red",
      position: { x: 0, y: 0, z: 0 },
      rotation: 0,
      feature: "editor",
      step: 1,
    },
    {
      id: "b",
      part_id: "3004",
      ldraw_id: "3004.dat",
      label: "1x2 brick",
      color_id: "4",
      color_name: "red",
      position: { x: 2, y: 0, z: 0 },
      rotation: 0,
      feature: "editor",
      step: 1,
    },
  ]);

  assert.deepEqual(catalogueItemsForModel(inventory, model), [
    {
      key: "3004:4",
      label: "1x2 brick",
      part_id: "3004",
      ldraw_id: "3004.dat",
      color_id: "4",
      color_name: "red",
      count: 2,
      used: 2,
      remaining: 0,
      disabled: true,
      supported: true,
    },
  ]);
});

test("addBrickFromCatalogue creates a snapped brick and updates piece count", () => {
  const next = addBrickFromCatalogue(modelWith([]), inventory.items[0], {
    x: 1.2,
    y: 2.8,
    z: 0,
  });

  assert.equal(next.piece_count, 1);
  assert.equal(next.bricks[0].part_id, "3004");
  assert.deepEqual(next.bricks[0].position, { x: 1, y: 3, z: 0 });
});

test("moveBrick can snap on release and stack on top of overlapping footprint", () => {
  const base = {
    id: "base",
    part_id: "3004",
    ldraw_id: "3004.dat",
    label: "1x2 brick",
    color_id: "4",
    color_name: "red",
    position: { x: 0, y: 0, z: 0 },
    rotation: 0,
    feature: "base",
    step: 1,
  };
  const moving = { ...base, id: "moving", position: { x: 4, y: 0, z: 0 } };
  const next = moveBrick(modelWith([base, moving]), "moving", { x: 0.2, y: 0.1, z: 0 }, {
    snap: true,
    stackOnDrop: true,
  });

  assert.deepEqual(next.bricks[1].position, { x: 0, y: 0, z: 3 });
});

test("rotateBrickQuarterTurn rotates by 90 degrees", () => {
  const brick = {
    id: "a",
    part_id: "3004",
    ldraw_id: "3004.dat",
    label: "1x2 brick",
    color_id: "4",
    color_name: "red",
    position: { x: 0, y: 0, z: 0 },
    rotation: 270,
    feature: "editor",
    step: 1,
  };

  assert.equal(rotateBrickQuarterTurn(modelWith([brick]), "a").bricks[0].rotation, 0);
});

test("removeBrick removes a brick and updates piece count", () => {
  const brick = {
    id: "a",
    part_id: "3004",
    ldraw_id: "3004.dat",
    label: "1x2 brick",
    color_id: "4",
    color_name: "red",
    position: { x: 0, y: 0, z: 0 },
    rotation: 0,
    feature: "editor",
    step: 1,
  };

  assert.equal(removeBrick(modelWith([brick]), "a").piece_count, 0);
});

test("validateForInstructions blocks off-grid editor state", () => {
  const brick = {
    id: "a",
    part_id: "3004",
    ldraw_id: "3004.dat",
    label: "1x2 brick",
    color_id: "4",
    color_name: "red",
    position: { x: 0.25, y: 0, z: 0 },
    rotation: 0,
    feature: "editor",
    step: 1,
  };
  const result = validateForInstructions(modelWith([brick]), inventory);

  assert.equal(result.valid, false);
  assert.equal(result.errors[0].type, "off_grid_position");
  assert.equal(result.errors[0].brick_instance_id, "a");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/preview/editorState.test.js`

Expected: FAIL with module not found for `src/preview/editorState.js`.

- [ ] **Step 3: Implement editor state helpers**

Create `src/preview/editorState.js`:

```js
import { validateModel } from "../generation/validator.js";
import {
  findDropZForFootprint,
  normalizedRotation,
  snapGridPosition,
} from "./editorGeometry.js";

export function inventoryKey(partId, colorId) {
  return `${partId}:${colorId}`;
}

function cloneModel(model, bricks) {
  return {
    ...model,
    piece_count: bricks.length,
    bricks,
  };
}

function usageForModel(model) {
  const usage = new Map();

  for (const brick of model.bricks) {
    const key = inventoryKey(brick.part_id, brick.color_id);
    usage.set(key, (usage.get(key) ?? 0) + 1);
  }

  return usage;
}

export function catalogueItemsForModel(inventory, model) {
  const usage = usageForModel(model);

  return inventory.items
    .filter((item) => item.supported)
    .map((item) => {
      const key = inventoryKey(item.part_id, item.color_id);
      const used = usage.get(key) ?? 0;
      const remaining = Math.max(0, item.count - used);

      return {
        key,
        label: item.label,
        part_id: item.part_id,
        ldraw_id: item.ldraw_id,
        color_id: item.color_id,
        color_name: item.color_name,
        count: item.count,
        used,
        remaining,
        disabled: remaining === 0,
        supported: item.supported,
      };
    });
}

function nextBrickId(model, partId) {
  let index = model.bricks.length + 1;
  let id = `editor-${partId}-${index}`;

  while (model.bricks.some((brick) => brick.id === id)) {
    index += 1;
    id = `editor-${partId}-${index}`;
  }

  return id;
}

export function addBrickFromCatalogue(model, inventoryItem, draftPosition) {
  const brick = {
    id: nextBrickId(model, inventoryItem.part_id),
    part_id: inventoryItem.part_id,
    ldraw_id: inventoryItem.ldraw_id,
    label: inventoryItem.label,
    color_id: inventoryItem.color_id,
    color_name: inventoryItem.color_name,
    position: snapGridPosition(draftPosition),
    rotation: 0,
    feature: "editor-added",
    step: Math.max(1, ...model.bricks.map((existing) => existing.step ?? 1)),
  };

  return cloneModel(model, [...model.bricks, brick]);
}

export function moveBrick(model, brickId, position, options = {}) {
  const bricks = model.bricks.map((brick) => {
    if (brick.id !== brickId) {
      return brick;
    }

    const nextPosition = options.snap ? snapGridPosition(position) : position;
    const draftBrick = { ...brick, position: nextPosition };

    return {
      ...draftBrick,
      position: options.stackOnDrop
        ? { ...nextPosition, z: findDropZForFootprint(draftBrick, model.bricks) }
        : nextPosition,
    };
  });

  return cloneModel(model, bricks);
}

export function rotateBrickQuarterTurn(model, brickId) {
  return cloneModel(
    model,
    model.bricks.map((brick) => {
      if (brick.id !== brickId) {
        return brick;
      }

      return {
        ...brick,
        rotation: normalizedRotation(brick.rotation + 90),
      };
    }),
  );
}

export function removeBrick(model, brickId) {
  return cloneModel(
    model,
    model.bricks.filter((brick) => brick.id !== brickId),
  );
}

function editorGridErrors(model) {
  const errors = [];

  for (const brick of model.bricks) {
    if (!Number.isInteger(brick.position.x) ||
      !Number.isInteger(brick.position.y) ||
      !Number.isInteger(brick.position.z)) {
      errors.push({
        type: "off_grid_position",
        severity: "hard",
        message: `${brick.id} is not snapped to the LEGO grid.`,
        brick_instance_id: brick.id,
      });
    }

    if (normalizedRotation(brick.rotation) === null) {
      errors.push({
        type: "invalid_rotation",
        severity: "hard",
        message: `${brick.id} rotation must be 0, 90, 180, or 270 degrees.`,
        brick_instance_id: brick.id,
      });
    }
  }

  return errors;
}

export function validateForInstructions(model, inventory) {
  const editorErrors = editorGridErrors(model);
  const validation = validateModel(model, inventory);
  const errors = [...editorErrors, ...validation.errors];

  return {
    ...validation,
    valid: errors.length === 0,
    errors,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/preview/editorState.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/preview/editorState.js test/preview/editorState.test.js
git commit -m "feat: add editor model state helpers"
```

---

### Task 3: Snapped-Position Validation In Shared Validator

**Files:**
- Modify: `src/generation/validator.js`
- Modify: `src/preview/editorState.js`
- Modify: `test/generation/validator.test.js`

**Interfaces:**
- Consumes: existing `validateModel(model, inventory)`
- Produces: validation errors:
  - `off_grid_position`
  - `invalid_rotation`

- [ ] **Step 1: Add failing validator tests**

Append to `test/generation/validator.test.js`:

```js
test("validateModel rejects off-grid brick positions", () => {
  const model = validModel({
    bricks: [
      brick({
        id: "off-grid",
        part_id: "3004",
        position: { x: 0.5, y: 0, z: 0 },
        rotation: 0,
      }),
    ],
  });

  const result = validateModel(model, testInventory);

  assert.equal(result.valid, false);
  assert.equal(result.errors[0].type, "off_grid_position");
  assert.equal(result.errors[0].brick_instance_id, "off-grid");
});

test("validateModel rejects non-quarter-turn brick rotations", () => {
  const model = validModel({
    bricks: [
      brick({
        id: "bad-rotation",
        part_id: "3004",
        position: { x: 0, y: 0, z: 0 },
        rotation: 45,
      }),
    ],
  });

  const result = validateModel(model, testInventory);

  assert.equal(result.valid, false);
  assert.equal(result.errors[0].type, "invalid_rotation");
  assert.equal(result.errors[0].brick_instance_id, "bad-rotation");
});
```

If this file does not already have `validModel`, `brick`, or `testInventory` helpers with matching names, add equivalent local helpers near the existing test helpers:

```js
function brick(overrides = {}) {
  return {
    id: "brick-1",
    part_id: "3004",
    ldraw_id: "3004.dat",
    label: "1x2 brick",
    color_id: "4",
    color_name: "red",
    position: { x: 0, y: 0, z: 0 },
    rotation: 0,
    feature: "test",
    step: 1,
    ...overrides,
  };
}

function validModel(overrides = {}) {
  return {
    model_name: "Test Model",
    prompt: "test",
    piece_count: overrides.bricks?.length ?? 1,
    dimensions: { width_studs: 1, depth_studs: 2, height_layers: 3 },
    created_from_inventory_id: "test",
    generator_version: "test",
    notes: [],
    bricks: [brick()],
    ...overrides,
  };
}

const testInventory = {
  inventory_id: "test",
  source: "manual_test_fixture",
  items: [
    {
      label: "1x2 brick",
      category: "brick",
      part_id: "3004",
      ldraw_id: "3004.dat",
      color_name: "red",
      color_id: "4",
      count: 2,
      supported: true,
    },
  ],
};
```

- [ ] **Step 2: Run validator tests to verify they fail**

Run: `node --test test/generation/validator.test.js`

Expected: FAIL because off-grid position and invalid rotation are not rejected yet.

- [ ] **Step 3: Add grid and rotation checks**

In `src/generation/validator.js`, add these helpers near `createError`:

```js
function isGridAligned(position) {
  return Number.isInteger(position.x) &&
    Number.isInteger(position.y) &&
    Number.isInteger(position.z);
}

function isQuarterTurn(rotation) {
  const normalized = ((rotation % 360) + 360) % 360;
  return normalized === 0 ||
    normalized === 90 ||
    normalized === 180 ||
    normalized === 270;
}
```

Inside the first `for (const brick of model.bricks)` loop, immediately after `used.set(...)`, add:

```js
if (!isGridAligned(brick.position)) {
  errors.push(
    createError(
      "off_grid_position",
      `${brick.id} is not snapped to the LEGO grid.`,
      {
        brick_instance_id: brick.id,
      },
    ),
  );
}

if (!isQuarterTurn(brick.rotation)) {
  errors.push(
    createError(
      "invalid_rotation",
      `${brick.id} rotation must be 0, 90, 180, or 270 degrees.`,
      {
        brick_instance_id: brick.id,
      },
    ),
  );
}
```

- [ ] **Step 4: Remove duplicate editor-only grid checks**

In `src/preview/editorState.js`, replace `validateForInstructions` with:

```js
export function validateForInstructions(model, inventory) {
  return validateModel(model, inventory);
}
```

Remove the now-unused `editorGridErrors` function from `src/preview/editorState.js`. The shared validator is now responsible for off-grid positions and invalid rotations.

- [ ] **Step 5: Run validator tests**

Run: `node --test test/generation/validator.test.js`

Expected: PASS.

- [ ] **Step 6: Run all tests**

Run: `npm test`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/generation/validator.js src/preview/editorState.js test/generation/validator.test.js
git commit -m "feat: validate snapped editor placements"
```

---

### Task 4: Per-Brick Three.js Scene Objects

**Files:**
- Create: `src/preview/brickScene.js`
- Modify: `src/preview/styles.css`

**Interfaces:**
- Consumes:
  - `SUPPORTED_PARTS`
  - `getPartDimensions(partId, rotation)`
  - `positionToLduCenter(brick)`
- Produces:
  - `createBrickScene(scene: THREE.Scene): BrickScene`
  - `BrickScene.setModel(model: GeneratedModel): void`
  - `BrickScene.updateBrick(brick: PlacedBrick): void`
  - `BrickScene.removeBrick(brickId: string): void`
  - `BrickScene.getBrickObject(brickId: string): THREE.Object3D | null`
  - `BrickScene.setSelectedBrick(brickId: string | null): void`
  - `BrickScene.setInvalidBrickIds(ids: string[]): void`
  - `BrickScene.dispose(): void`

- [ ] **Step 1: Create per-brick scene module**

Create `src/preview/brickScene.js`:

```js
import * as THREE from "three";

import { getPartDimensions, SUPPORTED_PARTS } from "../generation/partCatalog.js";
import { PLATE_UNIT_LDU, STUD_LDU, positionToLduCenter } from "./editorGeometry.js";

const COLOR_HEX = {
  0: 0x05131d,
  4: 0xc91a09,
  14: 0xf2cd37,
  15: 0xffffff,
  19: 0xe4cd9e,
  25: 0xfe8a18,
  43: 0xaeefec,
  72: 0x6c6e68,
};

function partHeightLdu(part) {
  return part.category === "plate" ? PLATE_UNIT_LDU : PLATE_UNIT_LDU * 3;
}

function materialForBrick(brick) {
  const transparent = brick.color_id === "43";

  return new THREE.MeshStandardMaterial({
    color: COLOR_HEX[brick.color_id] ?? 0xd9d9d9,
    roughness: 0.46,
    metalness: 0.02,
    transparent,
    opacity: transparent ? 0.62 : 1,
  });
}

function createStudMesh(material) {
  const geometry = new THREE.CylinderGeometry(6, 6, 4, 16);
  const stud = new THREE.Mesh(geometry, material);
  stud.castShadow = true;
  stud.receiveShadow = true;
  return stud;
}

function createBrickObject(brick) {
  const part = SUPPORTED_PARTS[brick.part_id];
  const dimensions = getPartDimensions(brick.part_id, brick.rotation);

  if (!part || !dimensions) {
    return null;
  }

  const group = new THREE.Group();
  group.name = brick.id;
  group.userData.brickId = brick.id;
  group.userData.type = "editable-brick";

  const material = materialForBrick(brick);
  const height = partHeightLdu(part);
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(part.width * STUD_LDU, height, part.depth * STUD_LDU),
    material,
  );
  body.castShadow = true;
  body.receiveShadow = true;
  group.add(body);

  const topY = -(height / 2) - 2;

  for (let x = 0; x < part.width; x += 1) {
    for (let z = 0; z < part.depth; z += 1) {
      const stud = createStudMesh(material);
      stud.position.set(
        -(part.width * STUD_LDU) / 2 + STUD_LDU / 2 + x * STUD_LDU,
        topY,
        -(part.depth * STUD_LDU) / 2 + STUD_LDU / 2 + z * STUD_LDU,
      );
      group.add(stud);
    }
  }

  const outline = new THREE.BoxHelper(group, 0xff2f2f);
  outline.visible = false;
  outline.userData.type = "selection-outline";
  group.add(outline);
  group.userData.outline = outline;

  applyBrickTransform(group, brick);
  return group;
}

function applyBrickTransform(object, brick) {
  const center = positionToLduCenter(brick);
  object.position.set(center.x, center.y, center.z);
  object.rotation.y = THREE.MathUtils.degToRad(brick.rotation);
  object.userData.brick = brick;
  object.userData.outline?.update?.();
}

function disposeObject(object) {
  object.traverse((child) => {
    child.geometry?.dispose?.();
    if (Array.isArray(child.material)) {
      child.material.forEach((material) => material.dispose?.());
    } else {
      child.material?.dispose?.();
    }
  });
}

export function createBrickScene(scene) {
  const root = new THREE.Group();
  root.name = "editable-brick-root";
  scene.add(root);

  const objectsById = new Map();
  let selectedBrickId = null;
  let invalidBrickIds = new Set();

  function updateVisualState(object) {
    const brickId = object.userData.brickId;
    const outline = object.userData.outline;
    const invalid = invalidBrickIds.has(brickId);

    if (outline) {
      outline.visible = invalid || selectedBrickId === brickId;
      outline.material.color.set(invalid ? 0xff2f2f : 0xf2cd37);
    }

    object.traverse((child) => {
      if (child.isMesh && child.material) {
        child.material.emissive?.setHex(invalid ? 0x661111 : 0x000000);
      }
    });
  }

  return {
    root,
    objectsById,
    setModel(model) {
      const nextIds = new Set(model.bricks.map((brick) => brick.id));

      for (const [brickId, object] of objectsById.entries()) {
        if (!nextIds.has(brickId)) {
          root.remove(object);
          disposeObject(object);
          objectsById.delete(brickId);
        }
      }

      for (const brick of model.bricks) {
        this.updateBrick(brick);
      }
    },
    updateBrick(brick) {
      const existing = objectsById.get(brick.id);

      if (existing) {
        applyBrickTransform(existing, brick);
        updateVisualState(existing);
        return;
      }

      const object = createBrickObject(brick);

      if (!object) {
        return;
      }

      objectsById.set(brick.id, object);
      root.add(object);
      updateVisualState(object);
    },
    removeBrick(brickId) {
      const object = objectsById.get(brickId);

      if (!object) {
        return;
      }

      root.remove(object);
      disposeObject(object);
      objectsById.delete(brickId);
    },
    getBrickObject(brickId) {
      return objectsById.get(brickId) ?? null;
    },
    setSelectedBrick(brickId) {
      selectedBrickId = brickId;
      for (const object of objectsById.values()) {
        updateVisualState(object);
      }
    },
    setInvalidBrickIds(ids) {
      invalidBrickIds = new Set(ids);
      for (const object of objectsById.values()) {
        updateVisualState(object);
      }
    },
    dispose() {
      for (const object of objectsById.values()) {
        root.remove(object);
        disposeObject(object);
      }
      objectsById.clear();
      scene.remove(root);
    },
  };
}
```

- [ ] **Step 2: Add invalid highlight animation CSS hook**

Add to `src/preview/styles.css`:

```css
@keyframes invalidPulse {
  0% {
    opacity: 0.55;
  }

  50% {
    opacity: 1;
  }

  100% {
    opacity: 0.55;
  }
}
```

The Three.js outline itself is not controlled by CSS, but this keyframe is used by DOM validation issue rows in Task 6.

- [ ] **Step 3: Wire editable scene root in main without changing user behavior**

In `src/preview/main.js`, import the module:

```js
import { createBrickScene } from "./brickScene.js";
```

After `let activeGenerationRequest = null;`, add:

```js
let brickScene = null;
let currentEditorModel = null;
```

Add helper:

```js
function enterEditorScene(model) {
  if (!brickScene) {
    brickScene = createBrickScene(scene);
  }

  currentEditorModel = model;
  clearCurrentModel();
  brickScene.setModel(model);
}
```

At the end of `showModel`, after `renderModel(...)`, do not call `enterEditorScene` yet. This task only introduces the module. Task 6 switches the render path after controls and UI exist.

- [ ] **Step 4: Run tests**

Run: `npm test`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/preview/brickScene.js src/preview/main.js src/preview/styles.css
git commit -m "feat: add per-brick preview scene"
```

---

### Task 5: Editor Controls

**Files:**
- Create: `src/preview/editorControls.js`
- Modify: `src/preview/main.js`

**Interfaces:**
- Consumes:
  - `moveBrick(model, brickId, position, options)`
  - `rotateBrickQuarterTurn(model, brickId)`
  - `brickScene.getBrickObject(brickId)`
  - `brickScene.setSelectedBrick(brickId)`
- Produces:
  - `createEditorControls(options): EditorControls`
  - `EditorControls.setTool(tool: "hand" | "axis" | "rotate"): void`
  - `EditorControls.setModel(model: GeneratedModel): void`
  - `EditorControls.setSelectedBrickId(brickId: string | null): void`
  - `EditorControls.dispose(): void`

- [ ] **Step 1: Create editor controls module**

Create `src/preview/editorControls.js`:

```js
import * as THREE from "three";
import { TransformControls } from "three/addons/controls/TransformControls.js";

import { STUD_LDU, PLATE_UNIT_LDU, snapGridPosition } from "./editorGeometry.js";
import { moveBrick, rotateBrickQuarterTurn } from "./editorState.js";

function brickIdFromObject(object) {
  let current = object;

  while (current) {
    if (current.userData?.type === "editable-brick") {
      return current.userData.brickId;
    }
    current = current.parent;
  }

  return null;
}

function lduToGridPosition(position) {
  return {
    x: position.x / STUD_LDU,
    y: position.z / STUD_LDU,
    z: -position.y / PLATE_UNIT_LDU,
  };
}

export function createEditorControls({
  camera,
  domElement,
  scene,
  orbitControls,
  brickScene,
  getModel,
  setModel,
  onSelectionChange,
}) {
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const dragPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const dragPoint = new THREE.Vector3();
  const transformControls = new TransformControls(camera, domElement);
  transformControls.setMode("translate");
  transformControls.setTranslationSnap(STUD_LDU);
  scene.add(transformControls);

  let tool = "hand";
  let selectedBrickId = null;
  let draggingBrickId = null;

  function updatePointer(event) {
    const rect = domElement.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -(((event.clientY - rect.top) / rect.height) * 2 - 1);
  }

  function selectBrick(brickId) {
    selectedBrickId = brickId;
    brickScene.setSelectedBrick(brickId);
    onSelectionChange?.(brickId);

    if (tool === "axis" && brickId) {
      transformControls.attach(brickScene.getBrickObject(brickId));
    } else {
      transformControls.detach();
    }
  }

  function intersectBrick(event) {
    updatePointer(event);
    raycaster.setFromCamera(pointer, camera);
    const intersections = raycaster.intersectObjects([...brickScene.objectsById.values()], true);

    for (const intersection of intersections) {
      const brickId = brickIdFromObject(intersection.object);

      if (brickId) {
        return brickId;
      }
    }

    return null;
  }

  function pointerDown(event) {
    if (tool !== "hand") {
      return;
    }

    const brickId = intersectBrick(event);
    selectBrick(brickId);

    if (!brickId) {
      return;
    }

    draggingBrickId = brickId;
    orbitControls.enabled = false;
    const object = brickScene.getBrickObject(brickId);
    dragPlane.constant = -object.position.y;
    domElement.setPointerCapture(event.pointerId);
  }

  function pointerMove(event) {
    if (tool !== "hand" || !draggingBrickId) {
      return;
    }

    updatePointer(event);
    raycaster.setFromCamera(pointer, camera);

    if (!raycaster.ray.intersectPlane(dragPlane, dragPoint)) {
      return;
    }

    const model = getModel();
    const nextModel = moveBrick(model, draggingBrickId, lduToGridPosition(dragPoint), {
      snap: false,
      stackOnDrop: false,
    });
    setModel(nextModel, { editedBrickId: draggingBrickId });
  }

  function pointerUp(event) {
    if (tool !== "hand" || !draggingBrickId) {
      return;
    }

    const model = getModel();
    const brick = model.bricks.find((candidate) => candidate.id === draggingBrickId);
    const nextModel = moveBrick(model, draggingBrickId, snapGridPosition(brick.position), {
      snap: true,
      stackOnDrop: true,
    });

    setModel(nextModel, { editedBrickId: draggingBrickId });
    draggingBrickId = null;
    orbitControls.enabled = true;
    domElement.releasePointerCapture(event.pointerId);
  }

  transformControls.addEventListener("dragging-changed", (event) => {
    orbitControls.enabled = !event.value;
  });

  transformControls.addEventListener("objectChange", () => {
    if (!selectedBrickId || tool !== "axis") {
      return;
    }

    const object = brickScene.getBrickObject(selectedBrickId);
    const gridPosition = snapGridPosition(lduToGridPosition(object.position));
    const nextModel = moveBrick(getModel(), selectedBrickId, gridPosition, {
      snap: true,
      stackOnDrop: false,
    });
    setModel(nextModel, { editedBrickId: selectedBrickId });
  });

  domElement.addEventListener("pointerdown", pointerDown);
  domElement.addEventListener("pointermove", pointerMove);
  domElement.addEventListener("pointerup", pointerUp);

  return {
    setTool(nextTool) {
      tool = nextTool;

      if (tool === "rotate" && selectedBrickId) {
        setModel(rotateBrickQuarterTurn(getModel(), selectedBrickId), {
          editedBrickId: selectedBrickId,
        });
        tool = "hand";
      }

      if (tool === "axis" && selectedBrickId) {
        transformControls.attach(brickScene.getBrickObject(selectedBrickId));
      } else {
        transformControls.detach();
      }
    },
    setModel() {},
    setSelectedBrickId: selectBrick,
    dispose() {
      domElement.removeEventListener("pointerdown", pointerDown);
      domElement.removeEventListener("pointermove", pointerMove);
      domElement.removeEventListener("pointerup", pointerUp);
      transformControls.dispose();
      scene.remove(transformControls);
    },
  };
}
```

- [ ] **Step 2: Import editor controls in main**

In `src/preview/main.js`, add:

```js
import { createEditorControls } from "./editorControls.js";
```

After `let currentEditorModel = null;`, add:

```js
let editorControls = null;
let selectedBrickId = null;
```

Add:

```js
function setEditorModel(model, { editedBrickId = null } = {}) {
  currentEditorModel = model;

  if (editedBrickId) {
    const editedBrick = model.bricks.find((brick) => brick.id === editedBrickId);
    if (editedBrick) {
      brickScene.updateBrick(editedBrick);
    }
  } else {
    brickScene.setModel(model);
  }
}

function ensureEditorControls() {
  if (editorControls || !brickScene) {
    return;
  }

  editorControls = createEditorControls({
    camera,
    domElement: renderer.domElement,
    scene,
    orbitControls: controls,
    brickScene,
    getModel: () => currentEditorModel,
    setModel: setEditorModel,
    onSelectionChange: (brickId) => {
      selectedBrickId = brickId;
    },
  });
}
```

Update `enterEditorScene(model)`:

```js
function enterEditorScene(model) {
  if (!brickScene) {
    brickScene = createBrickScene(scene);
  }

  currentEditorModel = model;
  clearCurrentModel();
  brickScene.setModel(model);
  ensureEditorControls();
}
```

- [ ] **Step 3: Run tests**

Run: `npm test`

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/preview/editorControls.js src/preview/main.js
git commit -m "feat: add editor transform controls"
```

---

### Task 6: Catalogue, Toolbar, Compact Status, And Instructions Gate

**Files:**
- Modify: `index.html`
- Modify: `src/preview/main.js`
- Modify: `src/preview/styles.css`

**Interfaces:**
- Consumes:
  - `catalogueItemsForModel(inventory, model)`
  - `addBrickFromCatalogue(model, inventoryItem, draftPosition)`
  - `validateForInstructions(model, inventory)`
  - editor controls and brick scene from earlier tasks
- Produces:
  - Right catalogue UI
  - Top toolbar UI
  - Compact generation/editor status
  - Instructions validation gate

- [ ] **Step 1: Replace timeline DOM with status and add editor UI**

Modify `index.html` inside `.viewer-panel`:

```html
<div class="editor-toolbar" aria-label="Build editor tools">
  <button class="tool-button is-active" id="hand-tool" type="button" aria-pressed="true" title="Hand">H</button>
  <button class="tool-button" id="axis-tool" type="button" aria-pressed="false" title="Axis">A</button>
  <button class="tool-button" id="rotate-tool" type="button" aria-pressed="false" title="Rotate">R</button>
  <button class="instructions-button" id="instructions-button" type="button">Instructions</button>
</div>
<aside class="brick-catalogue" aria-label="Available bricks">
  <div class="brick-catalogue__header">
    <p>Bricks</p>
  </div>
  <div id="brick-catalogue-list" class="brick-catalogue__list"></div>
</aside>
```

Replace:

```html
<ol id="generation-timeline" class="generation-timeline" aria-label="Generation progress"></ol>
```

with:

```html
<div id="generation-status-line" class="generation-status-line" aria-live="polite">
  <span id="generation-spinner" class="generation-spinner" hidden></span>
  <span id="generation-status-text">Idle</span>
</div>
```

- [ ] **Step 2: Add UI element references in main**

In `src/preview/main.js`, replace:

```js
const timelineList = document.querySelector("#generation-timeline");
```

with:

```js
const generationStatusLine = document.querySelector("#generation-status-line");
const generationSpinner = document.querySelector("#generation-spinner");
const generationStatusText = document.querySelector("#generation-status-text");
const catalogueList = document.querySelector("#brick-catalogue-list");
const handTool = document.querySelector("#hand-tool");
const axisTool = document.querySelector("#axis-tool");
const rotateTool = document.querySelector("#rotate-tool");
const instructionsButton = document.querySelector("#instructions-button");
```

Remove `renderTimeline()`, `resetTimeline()`, and timeline row DOM creation. Keep `timelineState` only if needed for generation status mapping, or replace it with:

```js
function setStatusLine(text, { loading = false } = {}) {
  generationStatusText.textContent = text;
  generationSpinner.hidden = !loading;
}
```

Update `updateTimelineStage(stageId, status)` to:

```js
function updateTimelineStage(stageId, status) {
  const stage = timelineStages.find((candidate) => candidate.id === stageId);
  const label = stage?.label ?? stageId;
  setStatusLine(`${label}: ${timelineStatusLabels[status] ?? status}`, {
    loading: status === "running",
  });
}
```

Update `resetTimeline()` call sites to call:

```js
setStatusLine("Starting generation", { loading: true });
```

- [ ] **Step 3: Render catalogue cards**

In `src/preview/main.js`, import:

```js
import {
  addBrickFromCatalogue,
  catalogueItemsForModel,
  validateForInstructions,
} from "./editorState.js";
```

Add:

```js
function renderCatalogue() {
  if (!currentEditorModel) {
    catalogueList.replaceChildren();
    return;
  }

  const items = catalogueItemsForModel(selectedInventory(), currentEditorModel);
  const fragment = document.createDocumentFragment();

  for (const item of items) {
    const button = document.createElement("button");
    button.className = "catalogue-card";
    button.type = "button";
    button.disabled = item.disabled;
    button.dataset.key = item.key;
    button.innerHTML = `
      <span class="catalogue-card__model" aria-hidden="true"></span>
      <span class="catalogue-card__label">${item.label}</span>
      <span class="catalogue-card__count">${item.remaining} / ${item.count}</span>
    `;
    button.addEventListener("click", () => {
      if (item.disabled || !currentEditorModel) {
        return;
      }

      const inventoryItem = selectedInventory().items.find((candidate) =>
        candidate.part_id === item.part_id && candidate.color_id === item.color_id,
      );
      setEditorModel(addBrickFromCatalogue(currentEditorModel, inventoryItem, {
        x: 0,
        y: 0,
        z: 0,
      }));
      renderCatalogue();
      setStatusLine("Editing");
    });
    fragment.append(button);
  }

  catalogueList.replaceChildren(fragment);
}
```

The click-to-add behavior is the fallback. Drag-from-catalogue is added in Task 7.

Call `renderCatalogue()` at the end of `setEditorModel`.

- [ ] **Step 4: Wire toolbar**

Add:

```js
const toolButtons = {
  hand: handTool,
  axis: axisTool,
  rotate: rotateTool,
};

function setActiveTool(tool) {
  for (const [name, button] of Object.entries(toolButtons)) {
    button.classList.toggle("is-active", name === tool);
    button.setAttribute("aria-pressed", String(name === tool));
  }

  editorControls?.setTool(tool);
}

handTool.addEventListener("click", () => setActiveTool("hand"));
axisTool.addEventListener("click", () => setActiveTool("axis"));
rotateTool.addEventListener("click", () => setActiveTool("rotate"));
```

- [ ] **Step 5: Switch successful models into editor scene**

In `showModel`, after model metadata/status updates, replace the `renderModel(...)` call for non-generation draft completion with:

```js
if (options.editorMode) {
  enterEditorScene(model);
  renderCatalogue();
  setStatusLine("Editing");
  options.onRendered?.();
  return;
}
```

In the final successful generation path:

```js
showModel(result.model, result.validation, {
  generationRequest,
  editorMode: true,
});
```

For draft events, keep the existing `renderModel` behavior so live drafts still preview through the old path.

For the initial fixture:

```js
showModel(initialModel, initialValidation, { editorMode: true });
```

- [ ] **Step 6: Add instructions validation gate**

Add:

```js
function brickIdsFromValidation(validation) {
  return validation.errors
    .map((error) => error.brick_instance_id)
    .filter(Boolean);
}

instructionsButton.addEventListener("click", () => {
  if (!currentEditorModel) {
    return;
  }

  const validation = validateForInstructions(currentEditorModel, selectedInventory());

  if (validation.valid) {
    brickScene.setInvalidBrickIds([]);
    setStatusLine("Ready for instructions");
    validationStatus.textContent = "Ready";
    hideErrors();
    return;
  }

  const invalidBrickIds = brickIdsFromValidation(validation);
  brickScene.setInvalidBrickIds(invalidBrickIds);
  validationStatus.textContent = "Fix build";
  setStatusLine(`Invalid: fix ${invalidBrickIds.length || validation.errors.length} issue(s) before instructions`);
  showErrors(validation.errors);
});
```

- [ ] **Step 7: Add CSS**

Append to `src/preview/styles.css`:

```css
.editor-toolbar {
  position: absolute;
  top: 18px;
  left: 50%;
  z-index: 10;
  display: flex;
  align-items: center;
  gap: 8px;
  transform: translateX(-50%);
  padding: 8px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 8px;
  background: rgba(16, 18, 24, 0.78);
  backdrop-filter: blur(14px);
}

.tool-button,
.instructions-button {
  min-width: 38px;
  min-height: 34px;
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.06);
  color: #f5f7fb;
  font: inherit;
  font-weight: 800;
  cursor: pointer;
}

.tool-button.is-active {
  border-color: #f2cd37;
  background: rgba(242, 205, 55, 0.18);
  color: #f2cd37;
}

.instructions-button {
  padding: 0 12px;
  background: #f2cd37;
  color: #17130a;
}

.brick-catalogue {
  position: absolute;
  top: 82px;
  right: 18px;
  bottom: 18px;
  z-index: 9;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  width: 210px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 8px;
  background: rgba(16, 18, 24, 0.78);
  backdrop-filter: blur(14px);
}

.brick-catalogue__header {
  padding: 12px 12px 8px;
}

.brick-catalogue__header p {
  margin: 0;
  font-size: 13px;
  font-weight: 800;
}

.brick-catalogue__list {
  display: grid;
  align-content: start;
  gap: 8px;
  overflow: auto;
  padding: 0 10px 10px;
}

.catalogue-card {
  display: grid;
  grid-template-columns: 42px minmax(0, 1fr);
  grid-template-areas:
    "model label"
    "model count";
  gap: 3px 9px;
  width: 100%;
  min-height: 54px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.06);
  color: #f5f7fb;
  text-align: left;
  cursor: grab;
}

.catalogue-card:disabled {
  cursor: not-allowed;
  filter: grayscale(1);
  opacity: 0.42;
}

.catalogue-card__model {
  grid-area: model;
  align-self: center;
  width: 32px;
  height: 20px;
  margin-left: 8px;
  border-radius: 4px;
  background: #c91a09;
  box-shadow:
    7px -6px 0 -2px #e44434,
    17px -6px 0 -2px #e44434;
}

.catalogue-card__label {
  grid-area: label;
  align-self: end;
  overflow: hidden;
  font-size: 12px;
  font-weight: 800;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.catalogue-card__count {
  grid-area: count;
  color: #aeb6c7;
  font-size: 11px;
  font-weight: 700;
}

.generation-status-line {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 14px;
  color: #d8deeb;
  font-size: 12px;
  font-weight: 700;
}

.generation-spinner {
  width: 13px;
  height: 13px;
  border: 2px solid rgba(255, 255, 255, 0.22);
  border-top-color: #f2cd37;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

@media (max-width: 760px) {
  .brick-catalogue {
    top: auto;
    left: 14px;
    right: 14px;
    bottom: 184px;
    width: auto;
    max-height: 150px;
  }

  .brick-catalogue__list {
    grid-auto-flow: column;
    grid-auto-columns: 180px;
    overflow-x: auto;
    overflow-y: hidden;
  }
}
```

- [ ] **Step 8: Run tests**

Run: `npm test`

Expected: PASS.

- [ ] **Step 9: Run dev server and manually verify initial editor**

Run: `npm run dev`

Expected: Vite and generation server start. Browser preview shows:

- compact top toolbar
- right brick catalogue
- initial car rendered as editable per-brick objects
- clicking a brick selects it
- clicking rotate rotates the selected brick
- clicking instructions on an invalid build highlights invalid pieces and stays in editor mode

- [ ] **Step 10: Commit**

```bash
git add index.html src/preview/main.js src/preview/styles.css
git commit -m "feat: add build editor ui"
```

---

### Task 7: Catalogue Drag-To-Scene

**Files:**
- Modify: `src/preview/editorControls.js`
- Modify: `src/preview/main.js`

**Interfaces:**
- Consumes:
  - catalogue item DOM data
  - `addBrickFromCatalogue`
  - `moveBrick`
- Produces:
  - Dragging from catalogue into scene creates a new brick at the snapped drop position.

- [ ] **Step 1: Mark catalogue cards draggable**

In `renderCatalogue()`, add:

```js
button.draggable = !item.disabled;
button.addEventListener("dragstart", (event) => {
  event.dataTransfer.setData("application/x-lego-inventory-key", item.key);
  event.dataTransfer.effectAllowed = "copy";
});
```

- [ ] **Step 2: Add scene drop handling**

In `src/preview/main.js`, add:

```js
function gridPositionFromCanvasDrop(event) {
  const rect = renderer.domElement.getBoundingClientRect();
  const xRatio = (event.clientX - rect.left) / rect.width;
  const yRatio = (event.clientY - rect.top) / rect.height;

  return {
    x: Math.round((xRatio - 0.5) * 24),
    y: Math.round((yRatio - 0.5) * 18),
    z: 0,
  };
}

renderer.domElement.addEventListener("dragover", (event) => {
  if (event.dataTransfer.types.includes("application/x-lego-inventory-key")) {
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  }
});

renderer.domElement.addEventListener("drop", (event) => {
  const key = event.dataTransfer.getData("application/x-lego-inventory-key");

  if (!key || !currentEditorModel) {
    return;
  }

  event.preventDefault();
  const inventoryItem = selectedInventory().items.find((item) =>
    `${item.part_id}:${item.color_id}` === key,
  );

  if (!inventoryItem) {
    return;
  }

  const nextModel = addBrickFromCatalogue(
    currentEditorModel,
    inventoryItem,
    gridPositionFromCanvasDrop(event),
  );
  const addedBrick = nextModel.bricks.at(-1);
  const stackedModel = moveBrick(nextModel, addedBrick.id, addedBrick.position, {
    snap: true,
    stackOnDrop: true,
  });
  setEditorModel(stackedModel, { editedBrickId: addedBrick.id });
  brickScene.setSelectedBrick(addedBrick.id);
  selectedBrickId = addedBrick.id;
  renderCatalogue();
  setStatusLine("Editing");
});
```

This gives functional drag-to-scene. A later polish pass can replace `gridPositionFromCanvasDrop` with raycast-to-ground math if the camera projection feels imprecise.

- [ ] **Step 3: Run tests**

Run: `npm test`

Expected: PASS.

- [ ] **Step 4: Manual verification**

Run: `npm run dev`

Expected:

- drag a catalogue card onto the scene
- the new brick appears
- the catalogue count decreases
- a used-up item remains visible and disabled
- dropping over an existing footprint stacks on top

- [ ] **Step 5: Commit**

```bash
git add src/preview/main.js
git commit -m "feat: drag catalogue bricks into editor"
```

---

### Task 8: Final Browser Polish And Verification

**Files:**
- Modify: `src/preview/main.js`
- Modify: `src/preview/styles.css`
- Modify: `docs/superpowers/specs/2026-07-17-build-editor-design.md` only if implementation intentionally differs from the approved spec.

**Interfaces:**
- Consumes all prior tasks.
- Produces a verified editor experience.

- [ ] **Step 1: Run full automated tests**

Run: `npm test`

Expected: PASS.

- [ ] **Step 2: Start the app**

Run: `npm run dev`

Expected: Vite preview and local generation server are available.

- [ ] **Step 3: Verify desktop behavior**

Open the local URL from the dev server and verify:

- initial model loads in editable scene
- toolbar stays at the top of the viewport
- right catalogue is visible and scrollable
- hand tool is active by default
- dragging an existing brick follows the pointer smoothly
- releasing a hand drag snaps the brick to the grid
- axis tool shows handles and moves only along the chosen axis
- rotate tool rotates the selected brick by 90 degrees around its visual center
- invalid state is allowed while editing
- instructions gate blocks invalid model and highlights affected bricks red
- fixing invalid pieces allows instructions status to become ready
- no full-scene flicker happens for normal move or rotate edits

- [ ] **Step 4: Verify mobile/narrow layout**

Resize the browser below `760px` width and verify:

- toolbar does not overlap model card controls
- catalogue collapses into the smaller lower layout
- catalogue cards remain readable
- text does not overflow buttons or cards

- [ ] **Step 5: Fix any layout or interaction regressions**

If desktop or mobile verification reveals overlap, add targeted CSS corrections. Example acceptable fixes:

```css
.model-card {
  max-width: min(320px, calc(100vw - 260px));
}

@media (max-width: 760px) {
  .model-card {
    max-width: calc(100vw - 28px);
  }
}
```

If transform controls fight orbit controls, ensure the `dragging-changed` listener keeps this exact behavior:

```js
transformControls.addEventListener("dragging-changed", (event) => {
  orbitControls.enabled = !event.value;
});
```

- [ ] **Step 6: Re-run verification after fixes**

Run: `npm test`

Expected: PASS.

Run: `npm run dev`

Expected: manual checks from Steps 3 and 4 pass.

- [ ] **Step 7: Commit final polish**

```bash
git add src/preview/main.js src/preview/styles.css docs/superpowers/specs/2026-07-17-build-editor-design.md
git commit -m "polish: verify build editor experience"
```

---

## Self-Review Notes

- Spec coverage: The plan covers permissive editing, right catalogue, used-up disabled items, hand/axis/rotate tools, snap-on-release, stacking on drop, per-brick scene updates, instructions validation gate, red xray-style highlighting, compact status, and limited preview/editor scope.
- Scope: This is a single implementation plan because all tasks build one cohesive editor surface. The instructions builder itself remains out of scope.
- Type consistency: Shared helpers use the existing `GeneratedModel`, `PlacedBrick`, and `Inventory` shapes from `src/generation/types.js`. The editor stores positions in grid units and converts to LDU only in preview geometry/scene code.
