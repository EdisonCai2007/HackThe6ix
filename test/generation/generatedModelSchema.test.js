import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { validateGeneratedModelShape } from "../../src/generation/generatedModelSchema.js";

const validModel = {
  model_name: "Small Duck",
  prompt: "build me a duck",
  piece_count: 1,
  dimensions: { width_studs: 2, depth_studs: 4, height_layers: 3 },
  created_from_inventory_id: "duck-demo",
  generator_version: "openrouter-test",
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
  ],
  notes: ["Valid shape for schema tests."],
};

describe("generated model schema", () => {
  it("accepts a GeneratedModel-shaped object", () => {
    const result = validateGeneratedModelShape(validModel);

    assert.equal(result.ok, true);
    assert.deepEqual(result.errors, []);
  });

  it("rejects missing model metadata", () => {
    const result = validateGeneratedModelShape({
      ...validModel,
      model_name: "",
      created_from_inventory_id: undefined,
    });

    assert.equal(result.ok, false);
    assert.equal(result.errors.some((error) => error.field === "model_name"), true);
    assert.equal(result.errors.some((error) => error.field === "created_from_inventory_id"), true);
  });

  it("rejects malformed brick fields before validator runs", () => {
    const result = validateGeneratedModelShape({
      ...validModel,
      bricks: [{ ...validModel.bricks[0], position: { x: 0, y: 0 }, rotation: 45 }],
    });

    assert.equal(result.ok, false);
    assert.equal(result.errors.some((error) => error.field === "bricks[0].position.z"), true);
    assert.equal(result.errors.some((error) => error.field === "bricks[0].rotation"), true);
  });
});
