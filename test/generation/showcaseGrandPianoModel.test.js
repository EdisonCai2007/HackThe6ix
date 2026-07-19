import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { fixedDemoInventory } from "../../src/generation/fixtures/fixedDemoInventory.js";
import { buildShowcaseGrandPianoModel } from "../../src/generation/fixtures/showcaseGrandPianoModel.js";
import { validateGeneratedModelShape } from "../../src/generation/generatedModelSchema.js";
import { validateModel } from "../../src/generation/validator.js";

const REQUIRED_FEATURES = [
  "case-base",
  "curved-rim",
  "soundboard",
  "keyboard-bed",
  "white-key",
  "black-key",
  "music-desk",
  "leg",
  "pedal",
  "bench",
  "raised-lid",
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

describe("buildShowcaseGrandPianoModel", () => {
  it("builds a deterministic, schema-valid concert grand with substantial detail", () => {
    const model = buildShowcaseGrandPianoModel(fixedDemoInventory);

    assert.equal(validateGeneratedModelShape(model).ok, true);
    assert.deepEqual(buildShowcaseGrandPianoModel(fixedDemoInventory), model);
    assert.ok(model.piece_count >= 95);
    assert.equal(model.bricks.length, model.piece_count);
    assert.ok(model.dimensions.depth_studs >= 16);
  });

  it("passes full geometry, connectivity, and inventory validation", () => {
    const model = buildShowcaseGrandPianoModel(fixedDemoInventory);
    const validation = validateModel(model, fixedDemoInventory);

    assert.equal(
      validation.valid,
      true,
      validation.errors.map(({ message }) => message).join("\n"),
    );
    assert.deepEqual(validation.errors, []);
  });

  it("contains every recognizable piano and bench feature", () => {
    const model = buildShowcaseGrandPianoModel(fixedDemoInventory);

    for (const feature of REQUIRED_FEATURES) {
      assert.ok(
        featureBricks(model, feature).length > 0,
        `Expected piano feature ${feature}.`,
      );
    }
  });

  it("uses a black case, contrasting keyboard, warm soundboard, and gold pedals", () => {
    const model = buildShowcaseGrandPianoModel(fixedDemoInventory);

    for (const feature of ["case-base", "curved-rim", "keyboard-bed", "black-key", "music-desk", "raised-lid"]) {
      assert.equal(
        featureBricks(model, feature).every(({ color_name }) => color_name === "black"),
        true,
        `${feature} should be black.`,
      );
    }

    assert.equal(featureBricks(model, "white-key").every(({ color_name }) => color_name === "white"), true);
    assert.equal(featureBricks(model, "soundboard").every(({ color_name }) => color_name === "brown"), true);
    assert.equal(featureBricks(model, "bench").every(({ color_name }) => color_name === "brown"), true);
    assert.equal(featureBricks(model, "pedal").every(({ color_name }) => color_name === "yellow"), true);
  });

  it("keeps the raised case silhouette black instead of adding a gray wall", () => {
    const model = buildShowcaseGrandPianoModel(fixedDemoInventory);

    assert.equal(
      model.bricks.some(({ color_name }) => color_name === "dark gray"),
      false,
    );
  });

  it("independently stays within every fixed part/color quantity", () => {
    const model = buildShowcaseGrandPianoModel(fixedDemoInventory);
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
