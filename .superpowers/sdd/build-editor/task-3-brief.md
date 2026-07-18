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

