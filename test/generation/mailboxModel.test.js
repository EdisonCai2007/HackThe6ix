import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildMailboxModel } from "../../src/generation/fixtures/mailboxModel.js";
import { randomInventoryV2 } from "../../src/generation/fixtures/randomInventoryV2.js";
import { validateGeneratedModelShape } from "../../src/generation/generatedModelSchema.js";
import { validateModel } from "../../src/generation/validator.js";

function bricksWithFeature(model, feature) {
  return model.bricks.filter((brick) => brick.feature === feature);
}

function bricksWithColor(model, colorName) {
  return model.bricks.filter((brick) => brick.color_name === colorName);
}

describe("buildMailboxModel", () => {
  it("builds a valid 48-piece mailbox from only randomInventoryV2", () => {
    const model = buildMailboxModel(randomInventoryV2);
    const shape = validateGeneratedModelShape(model);
    const validation = validateModel(model, randomInventoryV2);

    assert.equal(model.created_from_inventory_id, randomInventoryV2.inventory_id);
    assert.equal(model.piece_count, 48);
    assert.equal(model.bricks.length, 48);
    assert.equal(new Set(model.bricks.map((brick) => brick.id)).size, 48);
    assert.deepEqual(model.dimensions, {
      width_studs: 8,
      depth_studs: 8,
      height_layers: 21,
    });
    assert.deepEqual(shape, { ok: true, errors: [] });
    assert.equal(
      validation.valid,
      true,
      validation.errors.map((error) => error.message).join("\n"),
    );
    assert.deepEqual(validation.errors, []);
  });

  it("keeps red dominant and reserves black and white for the requested details", () => {
    const model = buildMailboxModel();
    const red = bricksWithColor(model, "red");
    const black = bricksWithColor(model, "black");
    const white = bricksWithColor(model, "white");

    assert.ok(red.length > black.length);
    assert.equal(white.length, 2);
    assert.equal(
      black.every((brick) => brick.feature === "base" || brick.feature === "post"),
      true,
    );
    assert.equal(
      white.every((brick) => brick.feature === "front-label"),
      true,
    );
    assert.ok(bricksWithFeature(model, "mail-compartment").length > 0);
    assert.ok(bricksWithFeature(model, "raised-lid").length > 0);
    assert.equal(
      Math.min(...bricksWithFeature(model, "raised-lid").map((brick) => brick.position.z)),
      20,
    );
  });

  it("uses only available randomInventoryV2 pieces", () => {
    const validation = validateModel(buildMailboxModel(), randomInventoryV2);

    for (const usage of validation.inventory_usage) {
      assert.ok(usage.used <= usage.available);
    }
  });
});
