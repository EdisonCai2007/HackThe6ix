import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildHorseModel } from "../../src/generation/fixtures/horseModel.js";
import { randomInventoryV2 } from "../../src/generation/fixtures/randomInventoryV2.js";
import { validateGeneratedModelShape } from "../../src/generation/generatedModelSchema.js";
import { validateModel } from "../../src/generation/validator.js";

function bricksWithFeature(model, feature) {
  return model.bricks.filter((brick) => brick.feature === feature);
}

function bricksWithColor(model, colorName) {
  return model.bricks.filter((brick) => brick.color_name === colorName);
}

describe("buildHorseModel", () => {
  it("builds a valid 62-piece 3D horse from only randomInventoryV2", () => {
    const model = buildHorseModel(randomInventoryV2);
    const shape = validateGeneratedModelShape(model);
    const validation = validateModel(model, randomInventoryV2);

    assert.equal(model.created_from_inventory_id, randomInventoryV2.inventory_id);
    assert.equal(model.piece_count, 62);
    assert.equal(model.bricks.length, 62);
    assert.equal(new Set(model.bricks.map((brick) => brick.id)).size, 62);
    assert.deepEqual(model.dimensions, {
      width_studs: 21,
      depth_studs: 6,
      height_layers: 26,
    });
    assert.deepEqual(shape, { ok: true, errors: [] });
    assert.equal(
      validation.valid,
      true,
      validation.errors.map((error) => error.message).join("\n"),
    );
    assert.deepEqual(validation.errors, []);
  });

  it("keeps the required horse silhouette features readable from all sides", () => {
    const model = buildHorseModel();
    const red = bricksWithColor(model, "red");
    const black = bricksWithColor(model, "black");

    assert.ok(red.length > black.length);
    assert.equal(bricksWithFeature(model, "hoof").length, 8);
    assert.equal(bricksWithFeature(model, "leg").length, 8);
    assert.equal(bricksWithFeature(model, "head").length, 1);
    assert.equal(bricksWithFeature(model, "neck").length, 2);
    assert.equal(bricksWithFeature(model, "muzzle").length, 2);
    assert.equal(bricksWithFeature(model, "mane").length, 6);
    assert.equal(bricksWithFeature(model, "tail").length, 5);

    const legPositions = bricksWithFeature(model, "leg").map((brick) => [
      brick.position.x,
      brick.position.y,
    ]);

    assert.ok(legPositions.some(([x, y]) => x === 3 && y === 0));
    assert.ok(legPositions.some(([x, y]) => x === 3 && y === 4));
    assert.ok(legPositions.some(([x, y]) => x === 14 && y === 0));
    assert.ok(legPositions.some(([x, y]) => x === 14 && y === 4));
    assert.equal(
      model.bricks.some((brick) => /eye/i.test(`${brick.id} ${brick.feature}`)),
      false,
    );
  });
});
