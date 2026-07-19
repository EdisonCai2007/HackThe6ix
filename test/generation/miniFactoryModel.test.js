import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { randomBuildInventory } from "../../src/generation/fixtures/randomBuildInventory.js";
import { validateGeneratedModelShape } from "../../src/generation/generatedModelSchema.js";
import { getPartDimensions } from "../../src/generation/partCatalog.js";
import { validateModel } from "../../src/generation/validator.js";

const { buildMiniFactoryModel } = await import(
  "../../src/generation/fixtures_old/miniFactoryModel.js"
);

function assertFeatureColor(model, feature, colorName) {
  const bricks = model.bricks.filter((brick) => brick.feature === feature);

  assert.ok(bricks.length > 0, `Expected mini factory to include ${feature}.`);
  assert.equal(
    bricks.every((brick) => brick.color_name === colorName),
    true,
    `Expected every ${feature} brick to be ${colorName}.`,
  );
}

describe("buildMiniFactoryModel", () => {
  it("builds a valid 99-piece factory from only the random inventory", () => {
    const model = buildMiniFactoryModel(randomBuildInventory);
    const shape = validateGeneratedModelShape(model);
    const validation = validateModel(model, randomBuildInventory);

    assert.equal(model.created_from_inventory_id, randomBuildInventory.inventory_id);
    assert.equal(model.piece_count, 99);
    assert.equal(model.bricks.length, 99);
    assert.ok(model.piece_count < 100);
    assert.deepEqual(model.dimensions, {
      width_studs: 12,
      depth_studs: 8,
      height_layers: 36,
    });
    assert.deepEqual(shape, { ok: true, errors: [] });
    assert.equal(validation.valid, true);
    assert.deepEqual(validation.errors, []);

    for (const usage of validation.inventory_usage) {
      assert.ok(usage.used <= usage.available);
    }
  });

  it("reserves each requested color for its intended factory feature", () => {
    const model = buildMiniFactoryModel();
    const allowedFeaturesByColor = new Map([
      ["green", new Set(["green-ground"])],
      ["brown", new Set(["brown-foundation"])],
      ["white", new Set(["white-walls", "white-smoke"])],
      ["blue", new Set(["blue-roof"])],
      ["red", new Set(["red-doors"])],
      ["yellow", new Set(["yellow-windows"])],
      ["black", new Set(["black-smokestacks", "black-roof-machinery"])],
    ]);

    assertFeatureColor(model, "green-ground", "green");
    assertFeatureColor(model, "brown-foundation", "brown");
    assertFeatureColor(model, "white-walls", "white");
    assertFeatureColor(model, "blue-roof", "blue");
    assertFeatureColor(model, "red-doors", "red");
    assertFeatureColor(model, "yellow-windows", "yellow");
    assertFeatureColor(model, "black-smokestacks", "black");
    assertFeatureColor(model, "black-roof-machinery", "black");
    assertFeatureColor(model, "white-smoke", "white");

    for (const brick of model.bricks) {
      assert.ok(
        allowedFeaturesByColor.get(brick.color_name)?.has(brick.feature),
        `${brick.id} uses ${brick.color_name} outside its intended feature.`,
      );
    }
  });

  it("has centered red double doors and smaller yellow windows on both sides", () => {
    const model = buildMiniFactoryModel();
    const doors = model.bricks.filter((brick) => brick.feature === "red-doors");
    const windows = model.bricks.filter((brick) => brick.feature === "yellow-windows");
    const leftWindows = windows.filter((brick) => brick.position.x < 4);
    const rightWindows = windows.filter((brick) => brick.position.x > 7);

    assert.equal(doors.length, 12);
    assert.deepEqual([...new Set(doors.map((brick) => brick.position.x))], [4, 5, 6, 7]);
    assert.deepEqual([...new Set(doors.map((brick) => brick.position.z))], [4, 7, 10]);
    assert.equal(
      doors.every((brick) =>
        brick.position.y + getPartDimensions(brick.part_id, brick.rotation).depth === 8
      ),
      true,
    );

    assert.equal(leftWindows.length, 4);
    assert.equal(rightWindows.length, 4);
    assert.deepEqual([...new Set(windows.map((brick) => brick.position.z))], [4, 7]);
    assert.equal(
      windows.every((brick) =>
        brick.position.y + getPartDimensions(brick.part_id, brick.rotation).depth === 8
      ),
      true,
    );
    assert.ok(Math.max(...windows.map((brick) => brick.position.z)) <
      Math.max(...doors.map((brick) => brick.position.z)));
  });

  it("uses a continuous blue roof with no red or yellow roof pieces", () => {
    const model = buildMiniFactoryModel();
    const roof = model.bricks.filter((brick) => brick.feature === "blue-roof");
    const redOrYellow = model.bricks.filter((brick) =>
      brick.color_name === "red" || brick.color_name === "yellow"
    );

    assert.equal(roof.length, 15);
    assert.equal(roof.every((brick) => brick.color_name === "blue"), true);
    assert.equal(redOrYellow.every((brick) => brick.position.z <= 10), true);
  });

  it("has exactly two matching four-brick smokestacks with separate stepped smoke", () => {
    const model = buildMiniFactoryModel();

    for (const name of ["west", "east"]) {
      const shaft = model.bricks.filter((brick) =>
        brick.id.startsWith(`${name}-smokestack-shaft-`)
      );
      const smoke = model.bricks.filter((brick) =>
        brick.id.startsWith(`${name}-smoke-`)
      );

      assert.equal(shaft.length, 4);
      assert.equal(smoke.length, 2);
      assert.ok(Math.min(...smoke.map((brick) => brick.position.z)) >
        Math.max(...shaft.map((brick) => brick.position.z)));
      assert.notEqual(smoke[0].position.x, smoke[1].position.x);
    }

    const stackBases = model.bricks.filter((brick) =>
      brick.id.endsWith("-smokestack-base")
    );
    const smoke = model.bricks.filter((brick) => brick.feature === "white-smoke");

    assert.equal(stackBases.length, 2);
    assert.equal(smoke.length, 4);
    assert.notEqual(stackBases[0].position.x, stackBases[1].position.x);
  });

  it("is not the default preview model on boot", () => {
    const previewSource = readFileSync(
      new URL("../../src/preview/main.js", import.meta.url),
      "utf8",
    );
    const pageSource = readFileSync(
      new URL("../../index.html", import.meta.url),
      "utf8",
    );

    assert.doesNotMatch(previewSource, /import \{ buildMiniFactoryModel \}/);
    assert.doesNotMatch(
      previewSource,
      /const initialModel = buildMiniFactoryModel\(randomBuildInventory\);/,
    );
    assert.doesNotMatch(
      pageSource,
      /value="Build a small rectangular factory with brown foundation trim, white walls, centered red double doors, yellow side windows, a blue roof, and two black smokestacks with white smoke\."/,
    );
  });
});
