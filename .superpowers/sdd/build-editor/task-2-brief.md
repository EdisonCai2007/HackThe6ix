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

