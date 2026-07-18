import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";

import { createBrickScene } from "../../src/preview/brickScene.js";

test("createBrickScene places studs above the editable brick body", () => {
  const scene = new THREE.Scene();
  const brickScene = createBrickScene(scene);

  brickScene.setModel({
    bricks: [
      {
        id: "brick-1",
        part_id: "3005",
        color_id: "4",
        position: { x: 0, y: 0, z: 0 },
        rotation: 0,
      },
    ],
  });

  const object = brickScene.getBrickObject("brick-1");
  const stud = object.children.find((child) => child.geometry?.type === "CylinderGeometry");

  assert.ok(stud);
  assert.equal(stud.position.y > 0, true);
});

test("createBrickScene centers the editable model footprint on the world origin", () => {
  const scene = new THREE.Scene();
  const brickScene = createBrickScene(scene);

  brickScene.setModel({
    bricks: [
      {
        id: "brick-1",
        part_id: "3001",
        color_id: "4",
        position: { x: 4, y: 2, z: 0 },
        rotation: 0,
      },
    ],
  });
  scene.updateMatrixWorld(true);

  const object = brickScene.getBrickObject("brick-1");
  const worldPosition = object.getWorldPosition(new THREE.Vector3());

  assert.deepEqual(brickScene.root.position.toArray(), [-100, 0, -80]);
  assert.deepEqual(worldPosition.toArray(), [0, 12, 0]);
});

test("createBrickScene keeps the initial root placement after an edited brick moves", () => {
  const scene = new THREE.Scene();
  const brickScene = createBrickScene(scene);

  brickScene.setModel({
    bricks: [
      {
        id: "brick-1",
        part_id: "3005",
        color_id: "4",
        position: { x: 0, y: 0, z: 0 },
        rotation: 0,
      },
    ],
  });
  const initialRootPosition = brickScene.root.position.toArray();

  brickScene.updateBrick({
    id: "brick-1",
    part_id: "3005",
    color_id: "4",
    position: { x: 6, y: -2, z: 0 },
    rotation: 0,
  });
  scene.updateMatrixWorld(true);

  const object = brickScene.getBrickObject("brick-1");
  const worldPosition = object.getWorldPosition(new THREE.Vector3());

  assert.deepEqual(brickScene.root.position.toArray(), initialRootPosition);
  assert.deepEqual(worldPosition.toArray(), [120, 12, -40]);
});

test("createBrickScene can preserve root placement during a full model refresh", () => {
  const scene = new THREE.Scene();
  const brickScene = createBrickScene(scene);

  brickScene.setModel({
    bricks: [
      {
        id: "brick-1",
        part_id: "3005",
        color_id: "4",
        position: { x: 0, y: 0, z: 0 },
        rotation: 0,
      },
    ],
  });
  const initialRootPosition = brickScene.root.position.toArray();

  brickScene.setModel({
    bricks: [
      {
        id: "brick-1",
        part_id: "3005",
        color_id: "4",
        position: { x: 6, y: -2, z: 0 },
        rotation: 0,
      },
    ],
  }, { preserveRootPlacement: true });
  scene.updateMatrixWorld(true);

  const object = brickScene.getBrickObject("brick-1");
  const worldPosition = object.getWorldPosition(new THREE.Vector3());

  assert.deepEqual(brickScene.root.position.toArray(), initialRootPosition);
  assert.deepEqual(worldPosition.toArray(), [120, 12, -40]);
});

test("createBrickScene does not recenter the committed model around drag previews", () => {
  const scene = new THREE.Scene();
  const brickScene = createBrickScene(scene);

  brickScene.setModel({
    bricks: [
      {
        id: "brick-1",
        part_id: "3005",
        color_id: "4",
        position: { x: 0, y: 0, z: 0 },
        rotation: 0,
      },
    ],
  });

  assert.deepEqual(brickScene.root.position.toArray(), [-10, 0, -10]);

  brickScene.updateBrick({
    id: "catalogue-drag-preview",
    part_id: "3005",
    color_id: "14",
    position: { x: 10, y: 0, z: 0 },
    rotation: 0,
    preview: true,
  });

  assert.deepEqual(brickScene.root.position.toArray(), [-10, 0, -10]);
});
