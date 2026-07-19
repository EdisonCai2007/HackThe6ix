import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildLighthouseModel } from "../../src/generation/fixtures/lighthouseModel.js";
import { randomBuildInventory } from "../../src/generation/fixtures/randomBuildInventory.js";
import { validateModel } from "../../src/generation/validator.js";

function bricksWithFeature(model, feature) {
  return model.bricks.filter((brick) => brick.feature === feature);
}

function assertFeatureColor(model, feature, expectedColorId) {
  const bricks = bricksWithFeature(model, feature);

  assert.ok(bricks.length > 0, `Expected lighthouse to include ${feature}.`);
  assert.equal(
    bricks.every((brick) => brick.color_id === expectedColorId),
    true,
    `Expected every ${feature} brick to use color ${expectedColorId}.`,
  );
}

describe("buildLighthouseModel", () => {
  it("builds a valid 100-piece lighthouse from the random build inventory", () => {
    const model = buildLighthouseModel(randomBuildInventory);
    const validation = validateModel(model, randomBuildInventory);

    assert.equal(model.piece_count, 100);
    assert.equal(model.bricks.length, 100);
    assert.equal(
      model.created_from_inventory_id,
      randomBuildInventory.inventory_id,
    );
    assert.deepEqual(model.dimensions, {
      width_studs: 10,
      depth_studs: 12,
      height_layers: 46,
    });
    assert.equal(validation.valid, true);
    assert.deepEqual(validation.errors, []);
  });

  it("includes the requested lighthouse, island, and water colors", () => {
    const model = buildLighthouseModel(randomBuildInventory);

    assertFeatureColor(model, "water", "1");
    assertFeatureColor(model, "island-rock", "6");
    assertFeatureColor(model, "island-grass", "2");
    assertFeatureColor(model, "tower-foundation", "6");
    assertFeatureColor(model, "tower-white", "15");
    assertFeatureColor(model, "tower-red", "4");
    assertFeatureColor(model, "observation-deck", "15");
    assertFeatureColor(model, "beacon", "14");
    assertFeatureColor(model, "cap", "0");
  });

  it("constructs every placement from an available inventory item", () => {
    const model = buildLighthouseModel(randomBuildInventory);
    const availableKeys = new Set(
      randomBuildInventory.items.map(
        (item) => `${item.part_id}:${item.color_id}`,
      ),
    );

    for (const brick of model.bricks) {
      assert.equal(
        availableKeys.has(`${brick.part_id}:${brick.color_id}`),
        true,
        `${brick.id} should come from randomBuildInventory.`,
      );
    }
  });
});
