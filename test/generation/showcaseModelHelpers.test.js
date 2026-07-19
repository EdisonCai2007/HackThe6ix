import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  completeShowcaseModel,
  createShowcaseBrickFactory,
  dimensionsForBricks,
} from "../../src/generation/fixtures/showcaseModelHelpers.js";

const inventory = {
  inventory_id: "showcase-helper-test",
  source: "manual_test_fixture",
  items: [
    {
      label: "1x1 brick",
      category: "brick",
      part_id: "3005",
      ldraw_id: "3005.dat",
      color_name: "red",
      color_id: "4",
      count: 2,
      supported: true,
    },
    {
      label: "1x2 plate",
      category: "plate",
      part_id: "3023",
      ldraw_id: "3023.dat",
      color_name: "black",
      color_id: "0",
      count: 1,
      supported: true,
    },
  ],
};

function redBrick(factory, overrides = {}) {
  return factory({
    id: "red-one",
    part_id: "3005",
    color_name: "red",
    position: { x: 0, y: 0, z: 0 },
    feature: "test",
    step: 1,
    ...overrides,
  });
}

describe("showcase model helpers", () => {
  it("copies canonical inventory metadata into each placement", () => {
    const brick = createShowcaseBrickFactory(inventory, "Test Build");

    assert.deepEqual(redBrick(brick), {
      id: "red-one",
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
  });

  it("rejects missing and over-allocated part/color pairs", () => {
    const missing = createShowcaseBrickFactory(inventory, "Test Build");

    assert.throws(
      () => redBrick(missing, { color_name: "blue" }),
      /Test Build requires blue part 3005.*showcase-helper-test/,
    );

    const overused = createShowcaseBrickFactory(inventory, "Test Build");
    redBrick(overused, { id: "red-one" });
    redBrick(overused, { id: "red-two" });

    assert.throws(
      () => redBrick(overused, { id: "red-three" }),
      /Test Build requires 3 red 1x1 bricks.*only has 2/,
    );
  });

  it("computes dimensions across rotated brick and plate extents", () => {
    const brick = createShowcaseBrickFactory(inventory, "Test Build");
    const bricks = [
      redBrick(brick, { position: { x: -1, y: 2, z: 0 } }),
      brick({
        id: "plate",
        part_id: "3023",
        color_name: "black",
        position: { x: 3, y: -1, z: 3 },
        rotation: 90,
        feature: "test",
        step: 2,
      }),
    ];

    assert.deepEqual(dimensionsForBricks(bricks), {
      width_studs: 6,
      depth_studs: 4,
      height_layers: 4,
    });
  });

  it("completes standard GeneratedModel metadata from placed bricks", () => {
    const brick = createShowcaseBrickFactory(inventory, "Test Build");
    const bricks = [redBrick(brick)];
    const notes = ["One note."];
    const model = completeShowcaseModel({
      modelName: "Test Build",
      prompt: "build a test",
      generatorVersion: "test-v1",
      inventory,
      bricks,
      notes,
    });

    assert.equal(model.model_name, "Test Build");
    assert.equal(model.piece_count, 1);
    assert.equal(model.created_from_inventory_id, inventory.inventory_id);
    assert.deepEqual(model.dimensions, {
      width_studs: 1,
      depth_studs: 1,
      height_layers: 3,
    });
    assert.deepEqual(model.notes, notes);
    assert.notEqual(model.notes, notes);
  });
});
