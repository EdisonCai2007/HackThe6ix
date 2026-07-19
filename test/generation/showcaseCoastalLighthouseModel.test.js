import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { fixedDemoInventory } from "../../src/generation/fixtures/fixedDemoInventory.js";
import { buildShowcaseCoastalLighthouseModel } from "../../src/generation/fixtures/showcaseCoastalLighthouseModel.js";
import { validateGeneratedModelShape } from "../../src/generation/generatedModelSchema.js";
import { validateModel } from "../../src/generation/validator.js";

const REQUIRED_FEATURES = [
  "water",
  "island-rock",
  "keeper-cottage",
  "cottage-roof",
  "tower-white",
  "tower-red",
  "tower-door",
  "tower-window",
  "balcony",
  "lantern-room",
  "beacon",
  "lantern-roof",
];

function featureBricks(model, feature) {
  return model.bricks.filter((brick) => brick.feature === feature);
}

describe("buildShowcaseCoastalLighthouseModel", () => {
  it("builds a deterministic, schema-valid lighthouse with substantial detail", () => {
    const model = buildShowcaseCoastalLighthouseModel(fixedDemoInventory);

    assert.equal(validateGeneratedModelShape(model).ok, true);
    assert.deepEqual(buildShowcaseCoastalLighthouseModel(), model);
    assert.deepEqual(buildShowcaseCoastalLighthouseModel(fixedDemoInventory), model);
    assert.ok(model.piece_count >= 110);
    assert.ok(model.dimensions.height_layers >= 28);
    assert.equal(model.bricks.length, model.piece_count);
  });

  it("passes geometry, connectivity, and fixed-inventory validation", () => {
    const model = buildShowcaseCoastalLighthouseModel(fixedDemoInventory);
    const validation = validateModel(model, fixedDemoInventory);

    assert.equal(
      validation.valid,
      true,
      validation.errors.map(({ message }) => message).join("\n"),
    );
  });

  it("contains the complete coastal lighthouse silhouette", () => {
    const model = buildShowcaseCoastalLighthouseModel(fixedDemoInventory);

    for (const feature of REQUIRED_FEATURES) {
      assert.ok(featureBricks(model, feature).length > 0, `Missing ${feature}.`);
    }
  });

  it("uses clear nautical color blocking", () => {
    const model = buildShowcaseCoastalLighthouseModel(fixedDemoInventory);

    assert.equal(featureBricks(model, "water").every(({ color_name }) => color_name === "blue"), true);
    assert.equal(featureBricks(model, "tower-white").every(({ color_name }) => color_name === "white"), true);
    assert.equal(featureBricks(model, "tower-red").every(({ color_name }) => color_name === "red"), true);
    assert.equal(featureBricks(model, "beacon").every(({ color_name }) => color_name === "yellow"), true);
    assert.equal(featureBricks(model, "lantern-roof").every(({ color_name }) => color_name === "black"), true);
  });
});
