import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildPizzaSliceModel } from "../../src/generation/fixtures/pizzaSliceModel.js";
import { randomBuildInventory } from "../../src/generation/fixtures/randomBuildInventory.js";
import { validateGeneratedModelShape } from "../../src/generation/generatedModelSchema.js";
import { validateModel } from "../../src/generation/validator.js";

function countsByColor(model) {
  const counts = new Map();

  for (const brick of model.bricks) {
    counts.set(brick.color_name, (counts.get(brick.color_name) ?? 0) + 1);
  }

  return Object.fromEntries(counts);
}

describe("buildPizzaSliceModel", () => {
  it("builds one valid connected 100-piece pizza slice", () => {
    const model = buildPizzaSliceModel(randomBuildInventory);
    const shape = validateGeneratedModelShape(model);
    const validation = validateModel(model, randomBuildInventory);

    assert.equal(model.piece_count, 100);
    assert.equal(model.bricks.length, 100);
    assert.equal(new Set(model.bricks.map((brick) => brick.id)).size, 100);
    assert.equal(
      model.created_from_inventory_id,
      randomBuildInventory.inventory_id,
    );
    assert.deepEqual(model.dimensions, {
      width_studs: 24,
      depth_studs: 26,
      height_layers: 8,
    });
    assert.deepEqual(shape, { ok: true, errors: [] });
    assert.equal(
      validation.valid,
      true,
      validation.errors.map((error) => error.message).join("\n"),
    );
    assert.deepEqual(validation.errors, []);
  });

  it("uses the requested colors for recognizable pizza features", () => {
    const model = buildPizzaSliceModel(randomBuildInventory);
    const features = new Set(model.bricks.map((brick) => brick.feature));

    assert.deepEqual(countsByColor(model), {
      yellow: 50,
      red: 20,
      green: 10,
      black: 20,
    });

    for (const feature of [
      "cheese-base",
      "sauce",
      "cheese",
      "crust",
      "green-topping",
      "black-olive",
    ]) {
      assert.equal(features.has(feature), true, `Expected ${feature}.`);
    }
  });

  it("constructs every placement from an available random inventory item", () => {
    const model = buildPizzaSliceModel(randomBuildInventory);
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
