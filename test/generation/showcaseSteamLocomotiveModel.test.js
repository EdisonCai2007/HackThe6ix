import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { fixedDemoInventory } from "../../src/generation/fixtures/fixedDemoInventory.js";
import { buildShowcaseSteamLocomotiveModel } from "../../src/generation/fixtures/showcaseSteamLocomotiveModel.js";
import { validateGeneratedModelShape } from "../../src/generation/generatedModelSchema.js";
import { validateModel } from "../../src/generation/validator.js";

const REQUIRED_FEATURES = [
  "chassis",
  "running-board",
  "driving-wheel",
  "boiler",
  "smokestack",
  "cowcatcher",
  "cab",
  "cab-window",
  "roof",
  "coupling-rod",
];

function usageByPartAndColor(model) {
  const usage = new Map();

  for (const brick of model.bricks) {
    const key = `${brick.part_id}:${brick.color_id}`;
    usage.set(key, (usage.get(key) ?? 0) + 1);
  }

  return usage;
}

function availableByPartAndColor(inventory) {
  return new Map(
    inventory.items
      .filter((item) => item.supported)
      .map((item) => [`${item.part_id}:${item.color_id}`, item.count]),
  );
}

function featureBricks(model, feature) {
  return model.bricks.filter((brick) => brick.feature === feature);
}

describe("buildShowcaseSteamLocomotiveModel", () => {
  it("builds a deterministic, schema-valid locomotive with substantial detail", () => {
    const model = buildShowcaseSteamLocomotiveModel(fixedDemoInventory);

    assert.equal(validateGeneratedModelShape(model).ok, true);
    assert.deepEqual(
      buildShowcaseSteamLocomotiveModel(fixedDemoInventory),
      model,
    );
    assert.ok(model.piece_count >= 120);
    assert.equal(model.bricks.length, model.piece_count);
    assert.ok(
      model.dimensions.width_studs >= 20 || model.dimensions.depth_studs >= 20,
    );
  });

  it("passes full geometry, connectivity, and inventory validation", () => {
    const model = buildShowcaseSteamLocomotiveModel(fixedDemoInventory);
    const validation = validateModel(model, fixedDemoInventory);

    assert.equal(
      validation.valid,
      true,
      validation.errors.map(({ message }) => message).join("\n"),
    );
    assert.deepEqual(validation.errors, []);
  });

  it("contains every silhouette and mechanical feature", () => {
    const model = buildShowcaseSteamLocomotiveModel(fixedDemoInventory);

    for (const feature of REQUIRED_FEATURES) {
      assert.ok(
        featureBricks(model, feature).length > 0,
        `Expected locomotive feature ${feature}.`,
      );
    }
  });

  it("uses deliberate showcase colors for recognizable features", () => {
    const model = buildShowcaseSteamLocomotiveModel(fixedDemoInventory);

    assert.equal(featureBricks(model, "driving-wheel").every(({ color_name }) => color_name === "black"), true);
    assert.equal(featureBricks(model, "boiler").every(({ color_name }) => color_name === "red"), true);
    assert.equal(featureBricks(model, "cab").every(({ color_name }) => color_name === "red"), true);
    assert.equal(featureBricks(model, "cab-window").every(({ color_name }) => color_name === "blue"), true);
    assert.equal(featureBricks(model, "roof").every(({ color_name }) => color_name === "black"), true);
    assert.equal(featureBricks(model, "coupling-rod").every(({ color_name }) => color_name === "yellow"), true);
  });

  it("independently stays within every fixed part/color quantity", () => {
    const model = buildShowcaseSteamLocomotiveModel(fixedDemoInventory);
    const used = usageByPartAndColor(model);
    const available = availableByPartAndColor(fixedDemoInventory);

    for (const [key, usedCount] of used) {
      assert.ok(available.has(key), `Missing inventory pair ${key}.`);
      assert.ok(
        usedCount <= available.get(key),
        `Used ${usedCount} of ${key}, only ${available.get(key)} available.`,
      );
    }
  });
});
