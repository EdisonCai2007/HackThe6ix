import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { randomBuildInventory } from "../../src/generation/fixtures/randomBuildInventory.js";
import { validateGeneratedModelShape } from "../../src/generation/generatedModelSchema.js";
import { validateModel } from "../../src/generation/validator.js";

const { buildWindmillModel } = await import(
  "../../src/generation/fixtures_old/windmillModel.js"
);

function bricksWithFeature(model, feature) {
  return model.bricks.filter((brick) => brick.feature === feature);
}

describe("buildWindmillModel", () => {
  it("builds a valid 99-piece windmill from only the random inventory", () => {
    const model = buildWindmillModel(randomBuildInventory);
    const shape = validateGeneratedModelShape(model);
    const validation = validateModel(model, randomBuildInventory);

    assert.equal(model.created_from_inventory_id, randomBuildInventory.inventory_id);
    assert.equal(model.piece_count, 99);
    assert.equal(model.bricks.length, 99);
    assert.equal(new Set(model.bricks.map((brick) => brick.id)).size, 99);
    assert.deepEqual(model.dimensions, {
      width_studs: 16,
      depth_studs: 16,
      height_layers: 40,
    });
    assert.deepEqual(shape, { ok: true, errors: [] });
    assert.equal(
      validation.valid,
      true,
      validation.errors.map((error) => error.message).join("\n"),
    );
    assert.deepEqual(validation.errors, []);
  });

  it("has a green base, tall white tower, and four brown blades with yellow tips", () => {
    const model = buildWindmillModel();
    const base = bricksWithFeature(model, "green-base");
    const tower = bricksWithFeature(model, "white-tower");
    const bladeFeatures = [
      "blade-north",
      "blade-east",
      "blade-south",
      "blade-west",
    ];

    assert.ok(base.length > 0);
    assert.equal(base.every((brick) => brick.color_name === "green"), true);
    assert.ok(tower.length > 0);
    assert.equal(tower.every((brick) => brick.color_name === "white"), true);
    assert.ok(Math.max(...tower.map((brick) => brick.position.z)) >= 28);

    for (const feature of bladeFeatures) {
      const blade = bricksWithFeature(model, feature);
      const colors = new Set(blade.map((brick) => brick.color_name));

      assert.ok(blade.length > 0, `Expected ${feature}.`);
      assert.equal(colors.has("brown"), true, `${feature} needs brown structure.`);
      assert.equal(colors.has("yellow"), true, `${feature} needs a yellow tip.`);
    }

    assert.equal(
      bricksWithFeature(model, "black-hub").every((brick) =>
        brick.color_name === "black"
      ),
      true,
    );
    assert.equal(bricksWithFeature(model, "black-doorway").length, 4);
    assert.equal(bricksWithFeature(model, "yellow-window").length, 1);
  });

  it("does not exceed any random inventory item", () => {
    const validation = validateModel(buildWindmillModel(), randomBuildInventory);

    for (const usage of validation.inventory_usage) {
      assert.ok(usage.used <= usage.available);
    }
  });
});
