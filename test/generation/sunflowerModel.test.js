import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { randomBuildInventory } from "../../src/generation/fixtures/randomBuildInventory.js";
import { buildSunflowerModel } from "../../src/generation/fixtures/sunflowerModel.js";
import { validateModel } from "../../src/generation/validator.js";

function countsByColor(model) {
  const counts = new Map();

  for (const brick of model.bricks) {
    counts.set(brick.color_name, (counts.get(brick.color_name) ?? 0) + 1);
  }

  return counts;
}

describe("buildSunflowerModel", () => {
  it("builds a valid 100-piece freestanding sunflower from the random inventory", () => {
    const model = buildSunflowerModel(randomBuildInventory);
    const validation = validateModel(model, randomBuildInventory);

    assert.equal(model.piece_count, 100);
    assert.equal(model.bricks.length, 100);
    assert.equal(new Set(model.bricks.map((brick) => brick.id)).size, 100);
    assert.equal(
      model.created_from_inventory_id,
      randomBuildInventory.inventory_id,
    );
    assert.equal(
      validation.valid,
      true,
      validation.errors.map((error) => error.message).join("\n"),
    );
    assert.deepEqual(model.dimensions, {
      width_studs: 17,
      depth_studs: 12,
      height_layers: 44,
    });
  });

  it("uses the requested colors and recognizable planter and flower features", () => {
    const model = buildSunflowerModel(randomBuildInventory);
    const colors = countsByColor(model);
    const features = new Set(model.bricks.map((brick) => brick.feature));

    assert.deepEqual(Object.fromEntries(colors), {
      brown: 34,
      green: 24,
      yellow: 38,
      black: 4,
    });

    for (const feature of [
      "planter-base",
      "planter-wall",
      "planter-rim",
      "stem",
      "leaf-left",
      "leaf-right",
      "calyx",
      "petal",
      "flower-center",
    ]) {
      assert.equal(features.has(feature), true, `Expected sunflower to include ${feature}.`);
    }
  });

  it("constructs every placement from an available random inventory item", () => {
    const model = buildSunflowerModel(randomBuildInventory);
    const inventoryItems = new Map(
      randomBuildInventory.items.map((item) => [
        `${item.part_id}:${item.color_id}`,
        item,
      ]),
    );

    for (const brick of model.bricks) {
      const item = inventoryItems.get(`${brick.part_id}:${brick.color_id}`);

      assert.ok(item, `${brick.id} should come from randomBuildInventory.`);
      assert.equal(brick.ldraw_id, item.ldraw_id);
      assert.equal(brick.label, item.label);
      assert.equal(brick.color_name, item.color_name);
    }
  });
});
