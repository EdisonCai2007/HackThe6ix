import assert from "node:assert/strict";
import test from "node:test";

import {
  findDropZForFootprint,
  isSnappedGridPosition,
  normalizedRotation,
  occupiedCellsForBrick,
  positionToLduCenter,
  snapGridPosition,
} from "../../src/preview/editorGeometry.js";

test("snapGridPosition rounds studs and plate layers", () => {
  assert.deepEqual(
    snapGridPosition({ x: 1.49, y: 2.51, z: 3.2 }),
    { x: 1, y: 3, z: 3 },
  );
});

test("isSnappedGridPosition rejects off-grid editor positions", () => {
  assert.equal(isSnappedGridPosition({ x: 1, y: 2, z: 3 }), true);
  assert.equal(isSnappedGridPosition({ x: 1.2, y: 2, z: 3 }), false);
  assert.equal(isSnappedGridPosition({ x: 1, y: 2.4, z: 3 }), false);
  assert.equal(isSnappedGridPosition({ x: 1, y: 2, z: 3.1 }), false);
});

test("normalizedRotation accepts only quarter turns", () => {
  assert.equal(normalizedRotation(0), 0);
  assert.equal(normalizedRotation(90), 90);
  assert.equal(normalizedRotation(450), 90);
  assert.equal(normalizedRotation(-90), 270);
  assert.equal(normalizedRotation(45), null);
});

test("occupiedCellsForBrick respects plate-unit part height", () => {
  const cells = occupiedCellsForBrick({
    id: "brick-1",
    part_id: "3004",
    position: { x: 2, y: 4, z: 1 },
    rotation: 0,
  });

  assert.equal(cells.length, 6);
  assert.deepEqual(cells[0], { x: 2, y: 4, z: 1 });
  assert.deepEqual(cells.at(-1), { x: 2, y: 5, z: 3 });
});

test("findDropZForFootprint places a brick on top of the highest overlapping stack", () => {
  const moving = {
    id: "moving",
    part_id: "3004",
    position: { x: 0, y: 0, z: 0 },
    rotation: 0,
  };
  const existing = [
    {
      id: "base",
      part_id: "3035",
      position: { x: 0, y: 0, z: 0 },
      rotation: 0,
    },
    {
      id: "upper",
      part_id: "3005",
      position: { x: 0, y: 0, z: 1 },
      rotation: 0,
    },
  ];

  assert.equal(findDropZForFootprint(moving, existing), 4);
});

test("positionToLduCenter converts grid anchor to visible center coordinates", () => {
  assert.deepEqual(
    positionToLduCenter({
      id: "plate",
      part_id: "3020",
      position: { x: 2, y: 3, z: 1 },
      rotation: 90,
    }),
    { x: 80, y: 12, z: 80 },
  );
});
