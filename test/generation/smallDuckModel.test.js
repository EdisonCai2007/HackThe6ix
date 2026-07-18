import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { duckInventory } from "../../src/generation/fixtures/duckInventory.js";
import { buildSmallDuckModel } from "../../src/generation/fixtures/smallDuckModel.js";
import { validateModel } from "../../src/generation/validator.js";

describe("buildSmallDuckModel", () => {
  it("builds a valid 15-piece duck with recognizable features", () => {
    const model = buildSmallDuckModel(duckInventory);
    const validation = validateModel(model, duckInventory);
    const features = new Set(model.bricks.map((brick) => brick.feature));

    assert.equal(model.piece_count, 15);
    assert.equal(model.bricks.length, 15);
    assert.equal(validation.valid, true);

    for (const feature of ["body", "head", "beak", "eye", "wing", "tail"]) {
      assert.equal(features.has(feature), true, `Expected duck to include ${feature}.`);
    }
  });
});
