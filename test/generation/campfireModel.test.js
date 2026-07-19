import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildCampfireModel } from "../../src/generation/fixtures/campfireModel.js";
import { randomBuildInventory } from "../../src/generation/fixtures/randomBuildInventory.js";
import { validateGeneratedModelShape } from "../../src/generation/generatedModelSchema.js";
import { validateModel } from "../../src/generation/validator.js";

function bricksWithFeature(model, feature) {
  return model.bricks.filter((brick) => brick.feature === feature);
}

describe("buildCampfireModel", () => {
  it("builds a valid 80-piece campfire from only the random build inventory", () => {
    const model = buildCampfireModel(randomBuildInventory);
    const shape = validateGeneratedModelShape(model);
    const validation = validateModel(model, randomBuildInventory);

    assert.equal(model.created_from_inventory_id, randomBuildInventory.inventory_id);
    assert.equal(model.piece_count, 80);
    assert.equal(model.bricks.length, 80);
    assert.equal(new Set(model.bricks.map((brick) => brick.id)).size, 80);
    assert.deepEqual(model.dimensions, {
      width_studs: 16,
      depth_studs: 16,
      height_layers: 32,
    });
    assert.deepEqual(shape, { ok: true, errors: [] });
    assert.equal(
      validation.valid,
      true,
      validation.errors.map((error) => error.message).join("\n"),
    );
    assert.deepEqual(validation.errors, []);
  });

  it("uses green plates for the base, brown logs, black ash, and red/yellow flame", () => {
    const model = buildCampfireModel();

    assert.equal(
      bricksWithFeature(model, "grass-base").every((brick) =>
        brick.color_name === "green" && brick.label.endsWith("plate")
      ),
      true,
    );
    assert.equal(
      bricksWithFeature(model, "stacked-log").every((brick) =>
        brick.color_name === "brown"
      ),
      true,
    );
    assert.equal(
      bricksWithFeature(model, "charred-ash").every((brick) =>
        brick.color_name === "black"
      ),
      true,
    );
    assert.equal(
      bricksWithFeature(model, "flame-shell").every((brick) =>
        brick.color_name === "red"
      ),
      true,
    );
    assert.equal(
      bricksWithFeature(model, "flame-core").every((brick) =>
        brick.color_name === "yellow"
      ),
      true,
    );
  });

  it("alternates the main log directions before the flame rises from the center", () => {
    const model = buildCampfireModel();
    const logCourses = new Map();

    for (const brick of bricksWithFeature(model, "stacked-log")) {
      const course = logCourses.get(brick.position.z) ?? new Set();
      if (brick.part_id === "3008") {
        course.add(brick.rotation);
      }
      logCourses.set(brick.position.z, course);
    }

    assert.deepEqual([...logCourses.get(2)], [90]);
    assert.deepEqual([...logCourses.get(5)], [0]);
    assert.deepEqual([...logCourses.get(8)], [90]);
    assert.deepEqual([...logCourses.get(11)], [0]);

    const flameBottom = model.bricks.filter((brick) => brick.position.z === 14);
    assert.ok(flameBottom.length > 0);
    assert.equal(
      flameBottom.every((brick) =>
        brick.feature === "flame-shell" || brick.feature === "flame-core"
      ),
      true,
    );
  });
});
