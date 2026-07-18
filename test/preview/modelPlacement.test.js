import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";

import {
  modelFootprintBounds,
  placementOffsetForBox,
  placementOffsetForModel,
} from "../../src/preview/modelPlacement.js";

test("placementOffsetForBox centers X/Z and keeps the bottom on the floor", () => {
  const box = new THREE.Box3(
    new THREE.Vector3(20, -14, 40),
    new THREE.Vector3(100, 30, 80),
  );
  const offset = placementOffsetForBox(box);
  const placedBox = box.clone().translate(offset);
  const placedCenter = placedBox.getCenter(new THREE.Vector3());

  assert.deepEqual(offset.toArray(), [-60, 14, -60]);
  assert.equal(placedCenter.x, 0);
  assert.equal(placedCenter.z, 0);
  assert.equal(placedBox.min.y, 0);
});

test("modelFootprintBounds maps LEGO grid anchors to Three.js footprint bounds", () => {
  const bounds = modelFootprintBounds({
    bricks: [
      {
        id: "base",
        part_id: "3020",
        position: { x: -2, y: 1, z: 0 },
        rotation: 90,
      },
      {
        id: "upper",
        part_id: "3004",
        position: { x: 2, y: -1, z: 1 },
        rotation: 0,
      },
    ],
  });

  assert.deepEqual(bounds, {
    minX: -40,
    maxX: 60,
    minY: 0,
    maxY: 32,
    minZ: -20,
    maxZ: 60,
    centerX: 10,
    centerZ: 20,
    width: 100,
    height: 32,
    depth: 80,
  });
});

test("placementOffsetForModel centers the footprint while preserving floor height", () => {
  const offset = placementOffsetForModel({
    bricks: [
      {
        id: "brick",
        part_id: "3001",
        position: { x: 4, y: 2, z: 0 },
        rotation: 0,
      },
    ],
  });

  assert.deepEqual(offset, { x: -100, y: 0, z: -80 });
});
