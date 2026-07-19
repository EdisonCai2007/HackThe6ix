import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildBlockyGlobeModel } from "../../src/generation/fixtures/blockyGlobeModel.js";
import { randomBuildInventory } from "../../src/generation/fixtures/randomBuildInventory.js";
import { validateGeneratedModelShape } from "../../src/generation/generatedModelSchema.js";
import { validateModel } from "../../src/generation/validator.js";

function countsByColor(model) {
  const counts = new Map();

  for (const brick of model.bricks) {
    counts.set(brick.color_name, (counts.get(brick.color_name) ?? 0) + 1);
  }

  return counts;
}

describe("buildBlockyGlobeModel", () => {
  it("builds a valid 99-piece globe and stand from the random inventory", () => {
    const model = buildBlockyGlobeModel(randomBuildInventory);
    const shape = validateGeneratedModelShape(model);
    const validation = validateModel(model, randomBuildInventory);

    assert.equal(model.piece_count, 99);
    assert.equal(model.bricks.length, 99);
    assert.ok(model.piece_count < 100);
    assert.equal(new Set(model.bricks.map((brick) => brick.id)).size, 99);
    assert.equal(
      model.created_from_inventory_id,
      randomBuildInventory.inventory_id,
    );
    assert.deepEqual(model.dimensions, {
      width_studs: 8,
      depth_studs: 8,
      height_layers: 47,
    });
    assert.deepEqual(shape, { ok: true, errors: [] });
    assert.equal(
      validation.valid,
      true,
      validation.errors.map((error) => error.message).join("\n"),
    );
    assert.deepEqual(validation.errors, []);
  });

  it("uses blue and green for the globe and brown and black for the stand", () => {
    const model = buildBlockyGlobeModel(randomBuildInventory);
    const colors = countsByColor(model);
    const features = new Set(model.bricks.map((brick) => brick.feature));

    assert.deepEqual(Object.fromEntries(colors), {
      brown: 8,
      black: 29,
      blue: 52,
      green: 10,
    });

    assert.ok(colors.get("blue") > colors.get("green"));

    for (const feature of [
      "pedestal-base",
      "pedestal-base-trim",
      "pedestal-support",
      "pedestal-column",
      "globe-cradle",
      "globe-ocean-support",
      "globe-ocean",
      "globe-continent",
      "globe-axis",
    ]) {
      assert.equal(features.has(feature), true, `Expected globe to include ${feature}.`);
    }

    assert.equal(
      model.bricks
        .filter((brick) => brick.feature.startsWith("globe-ocean"))
        .every((brick) => brick.color_name === "blue"),
      true,
    );
    assert.equal(
      model.bricks
        .filter((brick) => brick.feature === "globe-continent")
        .every((brick) => brick.color_name === "green"),
      true,
    );
  });

  it("does not exceed any random inventory item", () => {
    const model = buildBlockyGlobeModel(randomBuildInventory);
    const validation = validateModel(model, randomBuildInventory);

    for (const usage of validation.inventory_usage) {
      assert.ok(
        usage.used <= usage.available,
        `${usage.part_id}/${usage.color_id} exceeds its inventory count.`,
      );
    }
  });
});
