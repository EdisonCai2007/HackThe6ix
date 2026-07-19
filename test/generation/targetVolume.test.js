import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { normalizeBrickGptTarget } from "../../src/generation/hybrid/targetVolume.js";

describe("normalizeBrickGptTarget", () => {
  it("converts one BrickGPT brick layer into three plate layers", () => {
    const target = normalizeBrickGptTarget({
      seed: 7,
      worldDim: 20,
      bricks: [{ width: 1, depth: 2, x: 4, y: 8, z: 1 }],
    });

    assert.deepEqual(target.bounds, { width: 1, depth: 2, height: 3 });
    assert.deepEqual([...target.cells].sort(), [
      "0,0,0",
      "0,0,1",
      "0,0,2",
      "0,1,0",
      "0,1,1",
      "0,1,2",
    ]);
    assert.equal(target.seed, 7);
  });

  it("translates the complete target to the origin and preserves voids", () => {
    const target = normalizeBrickGptTarget({
      seed: 3,
      worldDim: 20,
      bricks: [
        { width: 1, depth: 1, x: 5, y: 6, z: 2 },
        { width: 1, depth: 1, x: 7, y: 6, z: 2 },
      ],
    });

    assert.deepEqual(target.bounds, { width: 3, depth: 1, height: 3 });
    assert.equal(target.cells.has("0,0,0"), true);
    assert.equal(target.cells.has("1,0,0"), false);
    assert.equal(target.cells.has("2,0,0"), true);
  });

  it("marks only cells with an exposed face as exterior", () => {
    const target = normalizeBrickGptTarget({
      seed: 1,
      worldDim: 20,
      bricks: [{ width: 3, depth: 3, x: 0, y: 0, z: 0 }],
    });

    assert.equal(target.cells.has("1,1,1"), true);
    assert.equal(target.exteriorCells.has("1,1,1"), false);
    assert.equal(target.exteriorCells.has("1,1,2"), true);
  });

  it("rejects overlapping BrickGPT placements", () => {
    assert.throws(
      () => normalizeBrickGptTarget({
        seed: 1,
        worldDim: 20,
        bricks: [
          { width: 2, depth: 2, x: 0, y: 0, z: 0 },
          { width: 1, depth: 1, x: 1, y: 1, z: 0 },
        ],
      }),
      /overlap/i,
    );
  });

  it("rejects malformed and out-of-world placements", () => {
    const base = { seed: 1, worldDim: 20 };

    assert.throws(
      () => normalizeBrickGptTarget({
        ...base,
        bricks: [{ width: 0, depth: 1, x: 0, y: 0, z: 0 }],
      }),
      /positive integer/i,
    );
    assert.throws(
      () => normalizeBrickGptTarget({
        ...base,
        bricks: [{ width: 1, depth: 1, x: -1, y: 0, z: 0 }],
      }),
      /non-negative integer/i,
    );
    assert.throws(
      () => normalizeBrickGptTarget({
        ...base,
        bricks: [{ width: 2, depth: 1, x: 19, y: 0, z: 0 }],
      }),
      /world_dim/i,
    );
  });
});
