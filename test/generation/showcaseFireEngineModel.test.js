import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { fixedDemoInventory } from "../../src/generation/fixtures/fixedDemoInventory.js";
import { buildShowcaseFireEngineModel } from "../../src/generation/fixtures/showcaseFireEngineModel.js";
import { validateGeneratedModelShape } from "../../src/generation/generatedModelSchema.js";
import { validateModel } from "../../src/generation/validator.js";

const REQUIRED_FEATURES = [
  "chassis",
  "wheel",
  "cab",
  "windshield",
  "grille",
  "headlight",
  "equipment-body",
  "equipment-compartment",
  "hose-reel",
  "roof-ladder",
  "emergency-light",
  "rear-platform",
];

function featureBricks(model, feature) {
  return model.bricks.filter((brick) => brick.feature === feature);
}

describe("buildShowcaseFireEngineModel", () => {
  it("builds a deterministic, schema-valid fire engine with substantial detail", () => {
    const model = buildShowcaseFireEngineModel(fixedDemoInventory);

    assert.equal(validateGeneratedModelShape(model).ok, true);
    assert.deepEqual(buildShowcaseFireEngineModel(), model);
    assert.deepEqual(buildShowcaseFireEngineModel(fixedDemoInventory), model);
    assert.ok(model.piece_count >= 120);
    assert.ok(model.dimensions.width_studs >= 24 || model.dimensions.depth_studs >= 24);
    assert.equal(model.bricks.length, model.piece_count);
  });

  it("passes geometry, connectivity, and fixed-inventory validation", () => {
    const model = buildShowcaseFireEngineModel(fixedDemoInventory);
    const validation = validateModel(model, fixedDemoInventory);

    assert.equal(
      validation.valid,
      true,
      validation.errors.map(({ message }) => message).join("\n"),
    );
  });

  it("contains a detailed rescue-truck silhouette", () => {
    const model = buildShowcaseFireEngineModel(fixedDemoInventory);

    for (const feature of REQUIRED_FEATURES) {
      assert.ok(featureBricks(model, feature).length > 0, `Missing ${feature}.`);
    }
  });

  it("uses deliberate fire-engine colors", () => {
    const model = buildShowcaseFireEngineModel(fixedDemoInventory);

    assert.equal(featureBricks(model, "cab").every(({ color_name }) => color_name === "red"), true);
    assert.equal(featureBricks(model, "equipment-body").every(({ color_name }) => color_name === "red"), true);
    assert.equal(featureBricks(model, "wheel").every(({ color_name }) => color_name === "black"), true);
    assert.equal(featureBricks(model, "windshield").every(({ color_name }) => color_name === "blue"), true);
    assert.equal(featureBricks(model, "headlight").every(({ color_name }) => color_name === "yellow"), true);
  });
});
