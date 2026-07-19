import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { fixedDemoInventory } from "../../src/generation/fixtures/fixedDemoInventory.js";
import { buildShowcaseDuckModel } from "../../src/generation/fixtures/showcaseDuckModel.js";
import { validateGeneratedModelShape } from "../../src/generation/generatedModelSchema.js";
import { validateModel } from "../../src/generation/validator.js";

const REQUIRED_FEATURES = [
  "water",
  "ripple",
  "duck-body",
  "wing",
  "tail",
  "neck",
  "head",
  "eye",
  "beak",
];

function featureBricks(model, feature) {
  return model.bricks.filter((brick) => brick.feature === feature);
}

describe("buildShowcaseDuckModel", () => {
  it("builds a deterministic, schema-valid duck in the target piece range", () => {
    const model = buildShowcaseDuckModel(fixedDemoInventory);

    assert.equal(validateGeneratedModelShape(model).ok, true);
    assert.deepEqual(buildShowcaseDuckModel(), model);
    assert.deepEqual(buildShowcaseDuckModel(fixedDemoInventory), model);
    assert.ok(model.piece_count >= 70);
    assert.ok(model.piece_count <= 100);
    assert.equal(model.bricks.length, model.piece_count);
  });

  it("passes geometry, connectivity, build-order, and fixed-inventory validation", () => {
    const model = buildShowcaseDuckModel(fixedDemoInventory);
    const validation = validateModel(model, fixedDemoInventory);

    assert.equal(
      validation.valid,
      true,
      validation.errors.map(({ message }) => message).join("\n"),
    );
    assert.equal(
      model.bricks.every((brick, index, bricks) =>
        index === 0 || brick.step >= bricks[index - 1].step
      ),
      true,
    );
  });

  it("contains a recognizable rubber-duck silhouette", () => {
    const model = buildShowcaseDuckModel(fixedDemoInventory);

    for (const feature of REQUIRED_FEATURES) {
      assert.ok(featureBricks(model, feature).length > 0, `Missing ${feature}.`);
    }
    assert.equal(featureBricks(model, "eye").length, 2);
    assert.equal(featureBricks(model, "beak").length, 2);
  });

  it("uses only the locked duck palette", () => {
    const model = buildShowcaseDuckModel(fixedDemoInventory);
    const expectedColors = new Map([
      ["water", "blue"],
      ["ripple", "white"],
      ["duck-body", "yellow"],
      ["wing", "yellow"],
      ["tail", "yellow"],
      ["neck", "yellow"],
      ["head", "yellow"],
      ["eye", "black"],
      ["beak", "orange"],
    ]);

    for (const [feature, colorName] of expectedColors) {
      assert.equal(
        featureBricks(model, feature).every(({ color_name }) => color_name === colorName),
        true,
        `${feature} should be ${colorName}.`,
      );
    }
  });
});
