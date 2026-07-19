import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { fixedDemoInventory } from "../../src/generation/fixtures/fixedDemoInventory.js";
import { buildShowcaseElectricGuitarModel } from "../../src/generation/fixtures/showcaseElectricGuitarModel.js";
import { validateGeneratedModelShape } from "../../src/generation/generatedModelSchema.js";
import { validateModel } from "../../src/generation/validator.js";

const REQUIRED_FEATURES = [
  "display-stand",
  "guitar-body",
  "pickguard",
  "pickup",
  "bridge",
  "control-knob",
  "neck",
  "fretboard",
  "fret-marker",
  "headstock",
  "tuning-peg",
];

function featureBricks(model, feature) {
  return model.bricks.filter((brick) => brick.feature === feature);
}

function inventoryCounts(inventory) {
  return new Map(
    inventory.items
      .filter((item) => item.supported)
      .map((item) => [`${item.part_id}:${item.color_id}`, item.count]),
  );
}

describe("buildShowcaseElectricGuitarModel", () => {
  it("builds a deterministic, schema-valid display guitar in the target piece range", () => {
    const model = buildShowcaseElectricGuitarModel(fixedDemoInventory);

    assert.equal(validateGeneratedModelShape(model).ok, true);
    assert.deepEqual(buildShowcaseElectricGuitarModel(), model);
    assert.deepEqual(buildShowcaseElectricGuitarModel(fixedDemoInventory), model);
    assert.ok(model.piece_count >= 95);
    assert.ok(model.piece_count <= 125);
    assert.equal(model.bricks.length, model.piece_count);
    assert.ok(model.dimensions.width_studs >= 36);
    assert.ok(model.dimensions.height_layers <= 10);
  });

  it("passes geometry, connectivity, build-order, and fixed-inventory validation", () => {
    const model = buildShowcaseElectricGuitarModel(fixedDemoInventory);
    const validation = validateModel(model, fixedDemoInventory);

    assert.equal(
      validation.valid,
      true,
      validation.errors.map(({ message }) => message).join("\n"),
    );
    assert.deepEqual(validation.errors, []);
    assert.equal(
      model.bricks.every((brick, index, bricks) =>
        index === 0 || brick.step >= bricks[index - 1].step
      ),
      true,
      "Guitar bricks should be ordered from stand and body through headstock.",
    );
  });

  it("contains every recognizable electric-guitar feature", () => {
    const model = buildShowcaseElectricGuitarModel(fixedDemoInventory);

    for (const feature of REQUIRED_FEATURES) {
      assert.ok(
        featureBricks(model, feature).length > 0,
        `Expected guitar feature ${feature}.`,
      );
    }

    assert.equal(featureBricks(model, "tuning-peg").length, 6);
  });

  it("uses the locked guitar palette on the intended features", () => {
    const model = buildShowcaseElectricGuitarModel(fixedDemoInventory);
    const expectedColors = new Map([
      ["display-stand", "black"],
      ["guitar-body", "red"],
      ["pickguard", "white"],
      ["pickup", "black"],
      ["bridge", "dark gray"],
      ["control-knob", "yellow"],
      ["neck", "brown"],
      ["fretboard", "black"],
      ["fret-marker", "white"],
      ["headstock", "brown"],
      ["tuning-peg", "dark gray"],
    ]);

    for (const [feature, colorName] of expectedColors) {
      assert.equal(
        featureBricks(model, feature).every(({ color_name }) => color_name === colorName),
        true,
        `${feature} should be ${colorName}.`,
      );
    }
  });

  it("independently stays within every fixed part/color quantity", () => {
    const model = buildShowcaseElectricGuitarModel(fixedDemoInventory);
    const available = inventoryCounts(fixedDemoInventory);
    const used = new Map();

    for (const brick of model.bricks) {
      const key = `${brick.part_id}:${brick.color_id}`;
      used.set(key, (used.get(key) ?? 0) + 1);
    }

    for (const [key, usedCount] of used) {
      assert.ok(available.has(key), `Missing inventory pair ${key}.`);
      assert.ok(
        usedCount <= available.get(key),
        `Used ${usedCount} of ${key}, only ${available.get(key)} available.`,
      );
    }
  });
});
