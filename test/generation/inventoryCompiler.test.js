import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { compileTargetVolume } from "../../src/generation/hybrid/inventoryCompiler.js";
import { normalizeBrickGptTarget } from "../../src/generation/hybrid/targetVolume.js";

function item(partId, colorName, colorId, count) {
  const parts = {
    3001: ["2x4 brick", "brick", "3001.dat"],
    3004: ["1x2 brick", "brick", "3004.dat"],
    3005: ["1x1 brick", "brick", "3005.dat"],
    3023: ["1x2 plate", "plate", "3023.dat"],
  };
  const [label, category, ldrawId] = parts[partId];

  return {
    label,
    category,
    part_id: String(partId),
    ldraw_id: ldrawId,
    color_name: colorName,
    color_id: colorId,
    count,
    supported: true,
  };
}

function inventory(items) {
  return {
    inventory_id: "compiler-test",
    source: "manual_test_fixture",
    items,
  };
}

function target(bricks) {
  return normalizeBrickGptTarget({ seed: 11, worldDim: 20, bricks });
}

describe("compileTargetVolume", () => {
  it("covers a target exactly with one available matching brick", () => {
    const [candidate] = compileTargetVolume({
      target: target([{ width: 2, depth: 4, x: 0, y: 0, z: 0 }]),
      inventory: inventory([item(3001, "red", "4", 1)]),
      prompt: "red block",
      beamWidth: 8,
      variants: 1,
    });

    assert.equal(candidate.validation.valid, true);
    assert.equal(candidate.coveredCells.size, candidate.targetCellCount);
    assert.equal(candidate.model.bricks.length, 1);
    assert.equal(candidate.model.bricks[0].part_id, "3001");
    assert.equal(candidate.model.bricks[0].rotation, 0);
  });

  it("rotates an available part to match the target", () => {
    const [candidate] = compileTargetVolume({
      target: target([{ width: 4, depth: 2, x: 0, y: 0, z: 0 }]),
      inventory: inventory([item(3001, "blue", "1", 1)]),
      prompt: "blue block",
      variants: 1,
    });

    assert.equal(candidate.validation.valid, true);
    assert.equal(candidate.model.bricks[0].rotation, 90);
    assert.equal(candidate.coverage, 1);
  });

  it("substitutes a three-plate stack when a matching brick is unavailable", () => {
    const [candidate] = compileTargetVolume({
      target: target([{ width: 1, depth: 2, x: 0, y: 0, z: 0 }]),
      inventory: inventory([item(3023, "yellow", "14", 3)]),
      prompt: "yellow bar",
      variants: 1,
    });

    assert.equal(candidate.validation.valid, true);
    assert.equal(candidate.coverage, 1);
    assert.deepEqual(candidate.model.bricks.map((brick) => brick.position.z), [0, 1, 2]);
  });

  it("returns a validator-safe partial model when inventory is exhausted", () => {
    const [candidate] = compileTargetVolume({
      target: target([
        { width: 1, depth: 1, x: 0, y: 0, z: 0 },
        { width: 1, depth: 1, x: 0, y: 0, z: 1 },
      ]),
      inventory: inventory([item(3005, "white", "15", 1)]),
      prompt: "white tower",
      variants: 1,
    });

    assert.equal(candidate.validation.valid, true);
    assert.equal(candidate.model.bricks.length, 1);
    assert.equal(candidate.coverage, 0.5);
    assert.equal(candidate.omittedCells.size, 3);
  });

  it("prefers a prompt color and remains deterministic", () => {
    const options = {
      target: target([{ width: 1, depth: 2, x: 0, y: 0, z: 0 }]),
      inventory: inventory([
        item(3004, "blue", "1", 2),
        item(3004, "red", "4", 1),
      ]),
      prompt: "a red bar",
      beamWidth: 8,
      variants: 2,
    };

    const first = compileTargetVolume(options);
    const second = compileTargetVolume(options);

    assert.equal(first[0].model.bricks[0].color_name, "red");
    assert.deepEqual(first.map((candidate) => candidate.model), second.map((candidate) => candidate.model));
  });
});
