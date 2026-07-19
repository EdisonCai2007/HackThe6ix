import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { randomBuildInventory } from "../../src/generation/fixtures/randomBuildInventory.js";
import { buildRobotHeadBustModel } from "../../src/generation/fixtures/robotHeadBustModel.js";
import { validateGeneratedModelShape } from "../../src/generation/generatedModelSchema.js";
import { validateModel } from "../../src/generation/validator.js";
import { exportModelToLDraw } from "../../src/ldraw/exportLDraw.js";

describe("buildRobotHeadBustModel", () => {
  it("builds a valid 100-piece robot bust from only the random inventory", () => {
    const model = buildRobotHeadBustModel();
    const shape = validateGeneratedModelShape(model);
    const validation = validateModel(model, randomBuildInventory);

    assert.equal(model.created_from_inventory_id, randomBuildInventory.inventory_id);
    assert.equal(model.piece_count, 100);
    assert.equal(model.bricks.length, 100);
    assert.deepEqual(shape, { ok: true, errors: [] });
    assert.equal(validation.valid, true);
    assert.deepEqual(validation.errors, []);

    for (const usage of validation.inventory_usage) {
      assert.ok(usage.used <= usage.available);
    }
  });

  it("includes the requested face, bust, and antenna details", () => {
    const model = buildRobotHeadBustModel();
    const colorsByFeature = new Map();

    for (const brick of model.bricks) {
      const colors = colorsByFeature.get(brick.feature) ?? new Set();
      colors.add(brick.color_name);
      colorsByFeature.set(brick.feature, colors);
    }

    for (const feature of [
      "shoulder-armor",
      "neck-core",
      "head-shell",
      "face-plate",
      "eye",
      "mouth",
      "antenna",
    ]) {
      assert.equal(colorsByFeature.has(feature), true, `Expected ${feature}.`);
    }

    assert.deepEqual([...colorsByFeature.get("eye")], ["blue"]);
    assert.deepEqual([...colorsByFeature.get("mouth")], ["red"]);
    assert.deepEqual([...colorsByFeature.get("antenna")], ["yellow"]);
  });

  it("exports all 100 placements with a blue LDraw material", () => {
    const ldraw = exportModelToLDraw(buildRobotHeadBustModel());
    const placementLines = ldraw
      .split("\n")
      .filter((line) => line.startsWith("1 "));

    assert.equal(placementLines.length, 100);
    assert.match(ldraw, /0 !COLOUR Blue CODE 1 VALUE #0055BF/);
    assert.equal(placementLines.some((line) => line.startsWith("1 1 ")), true);
  });
});
