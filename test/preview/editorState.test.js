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
      category: "brick",
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

test("rotateBrickQuarterTurn preserves a non-square brick's visual center", () => {
  const brick = {
    id: "a",
    part_id: "3004",
    ldraw_id: "3004.dat",
    label: "1x2 brick",
    color_id: "4",
    color_name: "red",
    position: { x: 0, y: 0, z: 3 },
    rotation: 0,
    feature: "editor",
    step: 1,
  };

  const rotated = rotateBrickQuarterTurn(modelWith([brick]), "a").bricks[0];

  assert.equal(rotated.rotation, 90);
  assert.deepEqual(rotated.position, { x: -0.5, y: 0.5, z: 3 });
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
