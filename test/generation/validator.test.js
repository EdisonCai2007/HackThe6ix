import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { validateModel } from "../../src/generation/validator.js";

const inventory = {
  inventory_id: "plate-height-test",
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
      label: "2x4 plate",
      category: "plate",
      part_id: "3020",
      ldraw_id: "3020.dat",
      color_name: "yellow",
      color_id: "14",
      count: 2,
      supported: true,
    },
  ],
};

function placedBrick(overrides) {
  return {
    id: "brick",
    part_id: "3001",
    ldraw_id: "3001.dat",
    label: "2x4 brick",
    color_id: "14",
    color_name: "yellow",
    position: { x: 0, y: 0, z: 0 },
    rotation: 0,
    feature: "test",
    step: 1,
    ...overrides,
  };
}

function modelWith(bricks) {
  return {
    model_name: "Plate Height Test",
    prompt: "test plate-height stacking",
    piece_count: bricks.length,
    dimensions: { width_studs: 2, depth_studs: 4, height_layers: 4 },
    created_from_inventory_id: inventory.inventory_id,
    generator_version: "test",
    bricks,
    notes: [],
  };
}

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

describe("validateModel plate-height geometry", () => {
  it("rejects a plate placed inside the vertical volume of a brick", () => {
    const result = validateModel(
      modelWith([
        placedBrick({ id: "base-brick" }),
        placedBrick({
          id: "embedded-plate",
          part_id: "3020",
          ldraw_id: "3020.dat",
          label: "2x4 plate",
          position: { x: 0, y: 0, z: 1 },
          step: 2,
        }),
      ]),
      inventory,
    );

    assert.equal(result.valid, false);
    assert.equal(
      result.errors.some((error) => error.type === "overlapping_bricks"),
      true,
    );
  });

  it("accepts a plate placed directly on top of a brick at z 3", () => {
    const result = validateModel(
      modelWith([
        placedBrick({ id: "base-brick" }),
        placedBrick({
          id: "top-plate",
          part_id: "3020",
          ldraw_id: "3020.dat",
          label: "2x4 plate",
          position: { x: 0, y: 0, z: 3 },
          step: 2,
        }),
      ]),
      inventory,
    );

    assert.equal(result.valid, true);
  });
});

it("validateModel rejects off-grid brick positions", () => {
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

it("validateModel rejects non-quarter-turn brick rotations", () => {
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

it("validateModel reports every disconnected component's brick ids", () => {
  const result = validateModel(
    validModel({
      bricks: [
        brick({ id: "grounded", position: { x: 0, y: 0, z: 0 } }),
        brick({ id: "separate", position: { x: 4, y: 0, z: 0 } }),
      ],
    }),
    testInventory,
  );

  const disconnectedError = result.errors.find(
    (error) => error.type === "disconnected_component",
  );

  assert.deepEqual(disconnectedError.component_brick_ids, [
    ["grounded"],
    ["separate"],
  ]);
});
