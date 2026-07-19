import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { cleanupObviousInvalidGeometry } from "../../src/generation/deterministicRepair.js";
import { validateModel } from "../../src/generation/validator.js";

const inventory = {
  inventory_id: "deterministic-repair-test",
  source: "manual_test_fixture",
  items: [
    {
      label: "1x2 brick",
      category: "brick",
      part_id: "3004",
      ldraw_id: "3004.dat",
      color_name: "red",
      color_id: "4",
      count: 10,
      supported: true,
    },
  ],
};

function brick(overrides = {}) {
  return {
    id: "brick-1",
    part_id: "3004",
    ldraw_id: "3004.dat",
    label: "1x2 brick",
    color_id: "4",
    color_name: "red",
    position: { x: 0, y: 0, z: 0 },
    rotation: 0,
    feature: "test",
    step: 1,
    ...overrides,
  };
}

function modelWith(bricks) {
  return {
    model_name: "Deterministic Repair Test",
    prompt: "test deterministic repair",
    piece_count: bricks.length,
    dimensions: { width_studs: 8, depth_studs: 4, height_layers: 9 },
    created_from_inventory_id: inventory.inventory_id,
    generator_version: "test",
    bricks,
    notes: [],
  };
}

describe("cleanupObviousInvalidGeometry", () => {
  it("preserves a model that is already valid", () => {
    const model = modelWith([
      brick({ id: "base", position: { x: 0, y: 0, z: 0 }, step: 1 }),
      brick({ id: "top", position: { x: 0, y: 0, z: 3 }, step: 2 }),
    ]);

    const result = cleanupObviousInvalidGeometry(model, inventory);

    assert.equal(validateModel(model, inventory).valid, true);
    assert.equal(result.model, model);
    assert.deepEqual(result.removedBricks, []);
    assert.equal(result.validationBefore.valid, true);
    assert.equal(result.validationAfter.valid, true);
    assert.equal(result.reasonMetadata.preservedAlreadyValid, true);
    assert.equal(
      result.reasonMetadata.actions[0].action,
      "preserve_already_valid_model",
    );
  });

  it("removes bricks reported as floating by the validator", () => {
    const model = modelWith([
      brick({ id: "base", position: { x: 0, y: 0, z: 0 }, step: 1 }),
      brick({ id: "floating", position: { x: 0, y: 0, z: 6 }, step: 2 }),
    ]);
    const validation = validateModel(model, inventory);

    assert.equal(validation.valid, false);
    assert.equal(
      validation.errors.some((error) => error.type === "floating_brick"),
      true,
    );

    const result = cleanupObviousInvalidGeometry(model, inventory);

    assert.deepEqual(
      result.model.bricks.map((modelBrick) => modelBrick.id),
      ["base"],
    );
    assert.deepEqual(
      result.removedBricks.map((removedBrick) => removedBrick.reason),
      ["floating_brick"],
    );
    assert.equal(
      result.removedBricks[0].metadata.validation_error_type,
      "floating_brick",
    );
    assert.equal(result.validationBefore.valid, false);
    assert.equal(result.validationAfter.valid, true);
    assert.equal(result.model.piece_count, 1);
  });

  it("keeps the largest connected component reported by the validator", () => {
    const model = modelWith([
      brick({ id: "main-base", position: { x: 0, y: 0, z: 0 }, step: 1 }),
      brick({ id: "main-top", position: { x: 0, y: 0, z: 3 }, step: 2 }),
      brick({ id: "separate-base", position: { x: 6, y: 0, z: 0 }, step: 3 }),
    ]);
    const validation = validateModel(model, inventory);

    assert.equal(validation.valid, false);
    assert.deepEqual(
      validation.errors.find((error) => error.type === "disconnected_component")
        .component_brick_ids,
      [["main-base", "main-top"], ["separate-base"]],
    );

    const result = cleanupObviousInvalidGeometry(model, inventory);

    assert.deepEqual(
      result.model.bricks.map((modelBrick) => modelBrick.id),
      ["main-base", "main-top"],
    );
    assert.deepEqual(
      result.removedBricks.map((removedBrick) => removedBrick.id),
      ["separate-base"],
    );
    assert.equal(result.removedBricks[0].reason, "disconnected_component");
    assert.equal(
      result.reasonMetadata.actions[0].action,
      "keep_largest_connected_component",
    );
    assert.deepEqual(
      result.reasonMetadata.actions[0].keptBrickIds,
      ["main-base", "main-top"],
    );
    assert.equal(result.validationAfter.valid, true);
  });

  it("leaves unrelated validator failures for the existing repair flow", () => {
    const model = modelWith([
      brick({ id: "off-grid", position: { x: 0.5, y: 0, z: 0 } }),
    ]);
    const validation = validateModel(model, inventory);

    assert.equal(validation.valid, false);
    assert.equal(validation.errors[0].type, "off_grid_position");

    const result = cleanupObviousInvalidGeometry(model, inventory);

    assert.equal(result.model, model);
    assert.deepEqual(result.removedBricks, []);
    assert.equal(result.validationBefore.valid, false);
    assert.equal(result.validationAfter.valid, false);
    assert.equal(result.validationAfter.errors[0].type, "off_grid_position");
  });
});
