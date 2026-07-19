import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  applyModelPatch,
  ModelPatchError,
  validateModelPatch,
} from "../../src/generation/modelPatch.js";

const baseModel = {
  model_name: "Patch Test Model",
  prompt: "build a patch test model",
  piece_count: 2,
  dimensions: { width_studs: 99, depth_studs: 99, height_layers: 99 },
  created_from_inventory_id: "test-inventory",
  generator_version: "test-generator",
  bricks: [
    {
      id: "body-1",
      part_id: "3001",
      ldraw_id: "3001.dat",
      label: "2x4 brick",
      color_id: "14",
      color_name: "yellow",
      position: { x: 0, y: 0, z: 0 },
      rotation: 0,
      feature: "body",
      step: 1,
    },
    {
      id: "detail-1",
      part_id: "3005",
      ldraw_id: "3005.dat",
      label: "1x1 brick",
      color_id: "4",
      color_name: "red",
      position: { x: 2, y: 4, z: 0 },
      rotation: 0,
      feature: "detail",
      step: 2,
    },
  ],
  notes: ["Preserve this note."],
};

function model() {
  return {
    ...baseModel,
    dimensions: { ...baseModel.dimensions },
    bricks: baseModel.bricks.map((brick) => ({
      ...brick,
      position: { ...brick.position },
    })),
    notes: [...baseModel.notes],
  };
}

function plate(overrides = {}) {
  return {
    id: "added-plate",
    part_id: "3710",
    ldraw_id: "3710.dat",
    label: "1x4 plate",
    color_id: "15",
    color_name: "white",
    position: { x: -1, y: 4, z: 3 },
    rotation: 90,
    feature: "stripe",
    step: 3,
    ...overrides,
  };
}

describe("model patch", () => {
  it("moves a brick without mutating the source model", () => {
    const source = model();
    const result = applyModelPatch(source, {
      operations: [
        { type: "move", id: "detail-1", position: { x: 5, y: 1, z: 0 } },
      ],
    });

    assert.notEqual(result, source);
    assert.deepEqual(source.bricks[1].position, { x: 2, y: 4, z: 0 });
    assert.deepEqual(result.bricks[1].position, { x: 5, y: 1, z: 0 });
    assert.equal(result.piece_count, 2);
    assert.deepEqual(result.dimensions, {
      width_studs: 6,
      depth_studs: 4,
      height_layers: 3,
    });
  });

  it("removes a brick and preserves model metadata", () => {
    const source = model();
    const result = applyModelPatch(source, {
      operations: [{ type: "remove", id: "detail-1" }],
    });

    assert.deepEqual(result.bricks.map((brick) => brick.id), ["body-1"]);
    assert.equal(result.piece_count, 1);
    assert.deepEqual(result.dimensions, {
      width_studs: 2,
      depth_studs: 4,
      height_layers: 3,
    });
    assert.equal(result.model_name, source.model_name);
    assert.equal(result.prompt, source.prompt);
    assert.equal(result.created_from_inventory_id, source.created_from_inventory_id);
    assert.equal(result.generator_version, source.generator_version);
    assert.deepEqual(result.notes, source.notes);
    assert.notEqual(result.notes, source.notes);
  });

  it("adds a full brick record", () => {
    const result = applyModelPatch(model(), {
      operations: [{ type: "add", brick: plate() }],
    });

    assert.deepEqual(
      result.bricks.map((brick) => brick.id),
      ["body-1", "detail-1", "added-plate"],
    );
    assert.equal(result.piece_count, 3);
    assert.deepEqual(result.dimensions, {
      width_studs: 4,
      depth_studs: 5,
      height_layers: 4,
    });
  });

  it("updates scoped brick fields", () => {
    const result = applyModelPatch(model(), {
      operations: [
        {
          type: "update",
          id: "detail-1",
          updates: {
            part_id: "3020",
            ldraw_id: "3020.dat",
            label: "2x4 plate",
            rotation: 90,
            feature: "wide detail",
          },
        },
      ],
    });

    const updated = result.bricks.find((brick) => brick.id === "detail-1");

    assert.equal(updated.part_id, "3020");
    assert.equal(updated.label, "2x4 plate");
    assert.equal(updated.feature, "wide detail");
    assert.deepEqual(updated.position, { x: 2, y: 4, z: 0 });
    assert.equal(result.piece_count, 2);
    assert.deepEqual(result.dimensions, {
      width_studs: 6,
      depth_studs: 6,
      height_layers: 3,
    });
  });

  it("replaces a brick with a full brick record", () => {
    const result = applyModelPatch(model(), {
      operations: [
        {
          type: "replace",
          id: "detail-1",
          brick: plate({ id: "detail-1", position: { x: 0, y: 0, z: 3 } }),
        },
      ],
    });

    assert.equal(result.bricks[1].part_id, "3710");
    assert.deepEqual(result.bricks[1].position, { x: 0, y: 0, z: 3 });
    assert.deepEqual(result.dimensions, {
      width_studs: 4,
      depth_studs: 4,
      height_layers: 4,
    });
  });

  it("reports invalid brick ids", () => {
    const validation = validateModelPatch(model(), {
      operations: [
        { type: "move", id: "missing-brick", position: { x: 0, y: 0, z: 0 } },
      ],
    });

    assert.equal(validation.ok, false);
    assert.deepEqual(validation.errors, [
      {
        field: "patch.operations[0].id",
        message: 'No brick exists with id "missing-brick".',
      },
    ]);
    assert.throws(
      () => applyModelPatch(model(), {
        operations: [
          { type: "move", id: "missing-brick", position: { x: 0, y: 0, z: 0 } },
        ],
      }),
      ModelPatchError,
    );
  });

  it("reports malformed patches", () => {
    const validation = validateModelPatch(model(), {
      operations: [
        { type: "move", id: "body-1", position: { x: 0, y: 0 } },
        { type: "update", id: "body-1", updates: { position: null } },
        { type: "update", id: "body-1", updates: { id: "renamed" } },
        { type: "add", brick: { ...plate(), id: "" } },
      ],
    });

    assert.equal(validation.ok, false);
    assert.deepEqual(
      validation.errors.map((error) => error.field),
      [
        "patch.operations[0].position.z",
        "patch.operations[1].updates.position",
        "patch.operations[2].updates.id",
        "patch.operations[3].brick.id",
      ],
    );
  });

  it("rejects unsupported parts when dimensions cannot be recalculated", () => {
    const validation = validateModelPatch(model(), {
      operations: [
        {
          type: "add",
          brick: plate({ part_id: "9999", ldraw_id: "9999.dat" }),
        },
      ],
    });

    assert.equal(validation.ok, false);
    assert.deepEqual(validation.errors, [
      {
        field: "bricks[2].part_id",
        message: "Cannot calculate dimensions for added-plate; unsupported part 9999.",
      },
    ]);
  });
});
