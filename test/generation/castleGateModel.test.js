import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildCastleGateModel } from "../../src/generation/fixtures/castleGateModel.js";
import { randomBuildInventory } from "../../src/generation/fixtures/randomBuildInventory.js";
import { validateGeneratedModelShape } from "../../src/generation/generatedModelSchema.js";
import { getPartDimensions } from "../../src/generation/partCatalog.js";
import { validateModel } from "../../src/generation/validator.js";

function bricksWithFeature(model, feature) {
  return model.bricks.filter((brick) => brick.feature === feature);
}

function assertFeatureColor(model, feature, colorName) {
  const bricks = bricksWithFeature(model, feature);

  assert.ok(bricks.length > 0, `Expected castle gate to include ${feature}.`);
  assert.equal(
    bricks.every((brick) => brick.color_name === colorName),
    true,
    `Expected every ${feature} brick to be ${colorName}.`,
  );
}

function occupiesCell(brick, target) {
  const dimensions = getPartDimensions(brick.part_id, brick.rotation);

  return target.x >= brick.position.x &&
    target.x < brick.position.x + dimensions.width &&
    target.y >= brick.position.y &&
    target.y < brick.position.y + dimensions.depth &&
    target.z >= brick.position.z &&
    target.z < brick.position.z + dimensions.height;
}

describe("buildCastleGateModel", () => {
  it("builds a valid 100-piece castle gate from only the random inventory", () => {
    const model = buildCastleGateModel(randomBuildInventory);
    const shape = validateGeneratedModelShape(model);
    const validation = validateModel(model, randomBuildInventory);

    assert.equal(model.created_from_inventory_id, randomBuildInventory.inventory_id);
    assert.equal(model.piece_count, 100);
    assert.equal(model.bricks.length, 100);
    assert.deepEqual(model.dimensions, {
      width_studs: 32,
      depth_studs: 40,
      height_layers: 32,
    });
    assert.deepEqual(shape, { ok: true, errors: [] });
    assert.equal(validation.valid, true);
    assert.deepEqual(validation.errors, []);

    for (const usage of validation.inventory_usage) {
      assert.ok(usage.used <= usage.available);
    }
  });

  it("uses the requested castle colors for each architectural feature", () => {
    const model = buildCastleGateModel();

    assertFeatureColor(model, "approach-path", "green");
    assertFeatureColor(model, "wall-foundation", "brown");
    assertFeatureColor(model, "tower", "brown");
    assertFeatureColor(model, "gate-jamb", "brown");
    assertFeatureColor(model, "gate-lintel", "brown");
    assertFeatureColor(model, "wall-panel", "white");
    assertFeatureColor(model, "battlement", "black");
    assertFeatureColor(model, "flagpole", "black");
    assertFeatureColor(model, "flag", "red");
  });

  it("leaves a six-stud-wide passage beneath the supported lintel", () => {
    const model = buildCastleGateModel();

    for (let x = 13; x < 19; x += 1) {
      for (let z = 4; z < 13; z += 1) {
        assert.equal(
          model.bricks.some((brick) => occupiesCell(brick, { x, y: 32, z })),
          false,
          `Expected gate cell ${x},32,${z} to remain open.`,
        );
      }
    }
  });

});
