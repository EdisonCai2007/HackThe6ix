import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { randomBuildInventory } from "../../src/generation/fixtures/randomBuildInventory.js";
import { validateGeneratedModelShape } from "../../src/generation/generatedModelSchema.js";
import { validateModel } from "../../src/generation/validator.js";

const { buildTrafficLightModel } = await import(
  "../../src/generation/fixtures_old/trafficLightModel.js"
);

function bricksWithFeature(model, feature) {
  return model.bricks.filter((brick) => brick.feature === feature);
}

describe("buildTrafficLightModel", () => {
  it("builds a valid 100-piece traffic light from only the random inventory", () => {
    const model = buildTrafficLightModel(randomBuildInventory);
    const shape = validateGeneratedModelShape(model);
    const validation = validateModel(model, randomBuildInventory);

    assert.equal(model.created_from_inventory_id, randomBuildInventory.inventory_id);
    assert.equal(model.piece_count, 100);
    assert.equal(model.bricks.length, 100);
    assert.equal(new Set(model.bricks.map((brick) => brick.id)).size, 100);
    assert.deepEqual(model.dimensions, {
      width_studs: 4,
      depth_studs: 8,
      height_layers: 59,
    });
    assert.deepEqual(shape, { ok: true, errors: [] });
    assert.equal(
      validation.valid,
      true,
      validation.errors.map((error) => error.message).join("\n"),
    );
    assert.deepEqual(validation.errors, []);
  });

  it("uses black for the pole and body and orders the three signals vertically", () => {
    const model = buildTrafficLightModel();
    const pole = bricksWithFeature(model, "pole");
    const housing = bricksWithFeature(model, "signal-housing");
    const green = bricksWithFeature(model, "green-signal");
    const yellow = bricksWithFeature(model, "yellow-signal");
    const red = bricksWithFeature(model, "red-signal");

    assert.ok(pole.length > 0);
    assert.ok(housing.length > 0);
    assert.equal(pole.every((brick) => brick.color_name === "black"), true);
    assert.equal(housing.every((brick) => brick.color_name === "black"), true);
    assert.equal(green.every((brick) => brick.color_name === "green"), true);
    assert.equal(yellow.every((brick) => brick.color_name === "yellow"), true);
    assert.equal(red.every((brick) => brick.color_name === "red"), true);

    assert.ok(Math.max(...green.map((brick) => brick.position.z)) <
      Math.min(...yellow.map((brick) => brick.position.z)));
    assert.ok(Math.max(...yellow.map((brick) => brick.position.z)) <
      Math.min(...red.map((brick) => brick.position.z)));
  });

  it("uses the intended black parts without exceeding any inventory item", () => {
    const model = buildTrafficLightModel();
    const validation = validateModel(model, randomBuildInventory);
    const blackUsage = validation.inventory_usage.filter((usage) => usage.color_id === "0");
    const blackUsageByPart = new Map(
      blackUsage.map((usage) => [usage.part_id, usage]),
    );

    assert.equal(blackUsageByPart.get("3005").used, 38);
    assert.equal(blackUsageByPart.get("3023").used, 10);
    assert.equal(blackUsageByPart.get("3623").used, 10);

    for (const usage of blackUsage) {
      assert.ok(usage.used <= usage.available);
    }

    for (const usage of validation.inventory_usage) {
      assert.ok(usage.used <= usage.available);
    }
  });
});
