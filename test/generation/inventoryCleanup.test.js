import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { cleanupIllegalInventoryUsage } from "../../src/generation/inventoryCleanup.js";

const baseModel = {
  model_name: "Tiny Test",
  prompt: "build me a tiny test",
  piece_count: 1,
  dimensions: { width_studs: 4, depth_studs: 4, height_layers: 3 },
  created_from_inventory_id: "test-inventory",
  generator_version: "test",
  bricks: [
    {
      id: "body-1",
      part_id: "3001",
      ldraw_id: "3001.dat",
      label: "2x4 brick",
      color_id: "14",
      color_name: "yellow",
      position: { x: 0, y: 0, z: 0 },
      rotation: 0,
      feature: "body",
      step: 1,
    },
  ],
  notes: ["test model"],
};

const inventory = {
  inventory_id: "test-inventory",
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
      label: "1x2 plate",
      category: "plate",
      part_id: "3023",
      ldraw_id: "3023.dat",
      color_name: "white",
      color_id: "15",
      count: 1,
      supported: true,
    },
  ],
};

function withBricks(bricks) {
  return {
    ...baseModel,
    piece_count: bricks.length,
    bricks,
  };
}

describe("cleanupIllegalInventoryUsage", () => {
  it("removes unsupported part ids and reports the removed feature", () => {
    const illegalBrick = {
      ...baseModel.bricks[0],
      id: "fake-eye",
      part_id: "9999",
      ldraw_id: "9999.dat",
      feature: "eye",
    };

    const result = cleanupIllegalInventoryUsage(withBricks([illegalBrick]), inventory);

    assert.deepEqual(result.model.bricks, []);
    assert.equal(result.model.piece_count, 0);
    assert.deepEqual(result.removedBricks, [
      {
        id: "fake-eye",
        feature: "eye",
        part_id: "9999",
        color_id: "14",
        reason: "unsupported_part",
        message: "fake-eye uses unsupported part 9999.",
      },
    ]);
  });

  it("removes supported part/color combinations absent from inventory", () => {
    const absentColorBrick = {
      ...baseModel.bricks[0],
      id: "red-body",
      color_id: "4",
      color_name: "red",
    };

    const result = cleanupIllegalInventoryUsage(withBricks([absentColorBrick]), inventory);

    assert.deepEqual(result.model.bricks, []);
    assert.equal(result.removedBricks[0].reason, "inventory_missing");
    assert.equal(
      result.removedBricks[0].message,
      "red-body uses part 3001 color 4, which is not in the confirmed supported inventory.",
    );
  });

  it("keeps the first allowed bricks and removes later excess bricks by model order", () => {
    const first = { ...baseModel.bricks[0], id: "body-1" };
    const second = { ...baseModel.bricks[0], id: "body-2", position: { x: 0, y: 0, z: 3 } };
    const third = { ...baseModel.bricks[0], id: "body-3", position: { x: 0, y: 0, z: 6 } };

    const result = cleanupIllegalInventoryUsage(withBricks([first, second, third]), inventory);

    assert.deepEqual(
      result.model.bricks.map((brick) => brick.id),
      ["body-1"],
    );
    assert.equal(result.model.piece_count, 1);
    assert.deepEqual(
      result.removedBricks.map((brick) => brick.id),
      ["body-2", "body-3"],
    );
    assert.deepEqual(
      result.removedBricks.map((brick) => brick.reason),
      ["inventory_exceeded", "inventory_exceeded"],
    );
  });

  it("leaves legal inventory usage unchanged", () => {
    const result = cleanupIllegalInventoryUsage(baseModel, inventory);

    assert.deepEqual(result.model, baseModel);
    assert.deepEqual(result.removedBricks, []);
  });
});
