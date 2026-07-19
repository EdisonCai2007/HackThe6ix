import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { fixedDemoInventory } from "../../src/generation/fixtures/fixedDemoInventory.js";
import { buildShowcaseBonsaiModel } from "../../src/generation/fixtures/showcaseBonsaiModel.js";
import { validateGeneratedModelShape } from "../../src/generation/generatedModelSchema.js";
import { validateModel } from "../../src/generation/validator.js";

const REQUIRED_FEATURES = [
  "display-base",
  "pot",
  "soil",
  "root",
  "trunk",
  "branch",
  "foliage",
];

function featureBricks(model, feature) {
  return model.bricks.filter((brick) => brick.feature === feature);
}

describe("buildShowcaseBonsaiModel", () => {
  it("builds a deterministic, schema-valid bonsai in the target piece range", () => {
    const model = buildShowcaseBonsaiModel(fixedDemoInventory);

    assert.equal(validateGeneratedModelShape(model).ok, true);
    assert.deepEqual(buildShowcaseBonsaiModel(), model);
    assert.deepEqual(buildShowcaseBonsaiModel(fixedDemoInventory), model);
    assert.ok(model.piece_count >= 80);
    assert.ok(model.piece_count <= 110);
    assert.equal(model.bricks.length, model.piece_count);
  });

  it("passes geometry, connectivity, build-order, and fixed-inventory validation", () => {
    const model = buildShowcaseBonsaiModel(fixedDemoInventory);
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

  it("contains a complete bonsai silhouette", () => {
    const model = buildShowcaseBonsaiModel(fixedDemoInventory);

    for (const feature of REQUIRED_FEATURES) {
      assert.ok(featureBricks(model, feature).length > 0, `Missing ${feature}.`);
    }
  });

  it("uses only the locked bonsai palette", () => {
    const model = buildShowcaseBonsaiModel(fixedDemoInventory);
    const expectedColors = new Map([
      ["display-base", "black"],
      ["pot", "red"],
      ["soil", "dark gray"],
      ["root", "brown"],
      ["trunk", "brown"],
      ["branch", "brown"],
      ["foliage", "green"],
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
