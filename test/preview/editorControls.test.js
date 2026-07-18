import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";

import {
  configureAxisTransformControls,
  createEditorControls,
  editorToolAvailability,
  lduToGridPosition,
} from "../../src/preview/editorControls.js";
import { createBrickScene } from "../../src/preview/brickScene.js";
import { positionToLduCenter } from "../../src/preview/editorGeometry.js";

function createDomElement() {
  const listeners = new Map();
  const documentListeners = new Map();

  return {
    addEventListener(type, listener) {
      const existing = listeners.get(type) ?? [];
      listeners.set(type, [...existing, listener]);
    },
    removeEventListener(type, listener) {
      listeners.set(
        type,
        (listeners.get(type) ?? []).filter((candidate) => candidate !== listener),
      );
    },
    dispatchPointerEvent(type, event) {
      const pointerEvent = {
        pointerId: 1,
        clientX: 100,
        clientY: 100,
        ...event,
      };
      for (const listener of listeners.get(type) ?? []) {
        listener(pointerEvent);
      }
    },
    dispatchContextMenuEvent(event) {
      const contextMenuEvent = {
        clientX: 100,
        clientY: 100,
        preventDefault() {},
        ...event,
      };
      for (const listener of listeners.get("contextmenu") ?? []) {
        listener(contextMenuEvent);
      }
    },
    getBoundingClientRect() {
      return {
        left: 0,
        top: 0,
        width: 200,
        height: 200,
      };
    },
    setPointerCapture() {},
    releasePointerCapture() {},
    ownerDocument: {
      addEventListener(type, listener) {
        const existing = documentListeners.get(type) ?? [];
        documentListeners.set(type, [...existing, listener]);
      },
      removeEventListener(type, listener) {
        documentListeners.set(
          type,
          (documentListeners.get(type) ?? []).filter((candidate) => candidate !== listener),
        );
      },
    },
    style: {},
  };
}

function createTopDownCamera() {
  const camera = new THREE.OrthographicCamera(-100, 100, 100, -100, 1, 1000);
  camera.position.set(10, 200, 10);
  camera.lookAt(10, 0, 10);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();
  return camera;
}

function createRotatedCamera() {
  const camera = new THREE.OrthographicCamera(-100, 100, 100, -100, 1, 1000);
  camera.position.set(120, 200, 120);
  camera.lookAt(10, 0, 10);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();
  return camera;
}

function worldToClient(camera, domElement, position) {
  const rect = domElement.getBoundingClientRect();
  const projected = position.clone().project(camera);

  return {
    clientX: rect.left + (projected.x + 1) * rect.width / 2,
    clientY: rect.top + (1 - projected.y) * rect.height / 2,
  };
}

function createEditableModel() {
  return {
    model_name: "test",
    piece_count: 1,
    bricks: [
      {
        id: "brick-1",
        part_id: "3005",
        color_id: "4",
        position: { x: 0, y: 0, z: 0 },
        rotation: 0,
      },
    ],
  };
}

function createStackableDragModel() {
  return {
    model_name: "test",
    piece_count: 2,
    bricks: [
      {
        id: "base",
        part_id: "3005",
        color_id: "14",
        position: { x: 0, y: 0, z: 0 },
        rotation: 0,
      },
      {
        id: "moving",
        part_id: "3005",
        color_id: "4",
        position: { x: 4, y: 0, z: 0 },
        rotation: 0,
      },
    ],
  };
}

class FakeTransformControls extends THREE.EventDispatcher {
  constructor() {
    super();
    this.attachedObject = null;
    this.disposed = false;
  }

  setMode(mode) {
    this.mode = mode;
  }

  getHelper() {
    return new THREE.Group();
  }

  attach(object) {
    this.attachedObject = object;
  }

  detach() {
    this.attachedObject = null;
  }

  dispose() {
    this.disposed = true;
  }
}

test("createEditorControls adds and removes the TransformControls helper", () => {
  const scene = new THREE.Scene();
  const domElement = createDomElement();
  const controls = createEditorControls({
    camera: new THREE.PerspectiveCamera(),
    domElement,
    scene,
    orbitControls: { enabled: true },
    brickScene: {
      objectsById: new Map(),
      setSelectedBrick() {},
      getBrickObject() {},
    },
    getModel: () => ({ bricks: [] }),
    setModel() {},
  });

  assert.equal(scene.children.length, 4);
  assert.equal(scene.children.some((child) => child.isTransformControlsRoot), true);

  controls.dispose();

  assert.equal(scene.children.length, 0);
});

test("rotate tool stays active and selects the clicked brick before ring dragging", () => {
  const scene = new THREE.Scene();
  const domElement = createDomElement();
  const brickScene = createBrickScene(scene);
  const models = [];
  let model = createEditableModel();
  let selectedBrickId = null;

  brickScene.setModel(model);
  brickScene.getBrickObject("brick-1").traverse((child) => {
    if (child.isMesh) {
      child.raycast = (_raycaster, intersections) => {
        intersections.push({ distance: 1, object: child });
      };
    }
  });
  scene.updateMatrixWorld(true);
  const camera = createTopDownCamera();
  const controls = createEditorControls({
    camera,
    domElement,
    scene,
    orbitControls: { enabled: true },
    brickScene,
    getModel: () => model,
    setModel(nextModel) {
      model = nextModel;
      models.push(nextModel);
    },
    onSelectionChange(brickId) {
      selectedBrickId = brickId;
    },
    createTransformControls: () => new FakeTransformControls(),
  });

  assert.equal(controls.setTool("rotate"), "rotate");

  const brickClient = worldToClient(
    camera,
    domElement,
    brickScene.getBrickObject("brick-1").position,
  );
  domElement.dispatchPointerEvent("pointerdown", brickClient);

  assert.equal(selectedBrickId, "brick-1");
  assert.equal(models.length, 0);
  assert.equal(model.bricks[0].rotation, 0);

  controls.dispose();
  brickScene.dispose();
});

test("lduToGridPosition converts a rotated brick center back to its grid anchor", () => {
  const brick = {
    part_id: "3010",
    rotation: 90,
  };

  assert.deepEqual(
    lduToGridPosition({ x: 100, y: 36, z: 50 }, brick),
    { x: 3, y: 2, z: 3 },
  );
});

test("lduToGridPosition converts a plate center to a whole plate-layer anchor", () => {
  const brick = {
    part_id: "3023",
    rotation: 0,
  };

  assert.deepEqual(
    lduToGridPosition({ x: 30, y: 28, z: 60 }, brick),
    { x: 1, y: 2, z: 3 },
  );
});

test("configureAxisTransformControls disables plane and center handles", () => {
  const centers = [
    { visible: true },
    { visible: true },
    { visible: true },
  ];
  const transformControls = {
    _gizmo: {
      gizmo: { translate: { getObjectByName: () => centers[0] } },
      picker: { translate: { getObjectByName: () => centers[1] } },
      helper: { translate: { getObjectByName: () => centers[2] } },
      updateMatrixWorld() {
        for (const center of centers) {
          center.visible = true;
        }
      },
    },
  };

  configureAxisTransformControls(transformControls);

  assert.equal(transformControls.showX, true);
  assert.equal(transformControls.showY, true);
  assert.equal(transformControls.showZ, true);
  assert.equal(transformControls.showXY, false);
  assert.equal(transformControls.showYZ, false);
  assert.equal(transformControls.showXZ, false);
  assert.deepEqual(centers.map((center) => center.visible), [false, false, false]);

  transformControls._gizmo.updateMatrixWorld();

  assert.deepEqual(centers.map((center) => center.visible), [false, false, false]);
});

test("editorToolAvailability keeps tools available before selecting a brick", () => {
  assert.deepEqual(editorToolAvailability(null), {
    hand: true,
    axis: true,
    rotate: true,
  });
  assert.deepEqual(editorToolAvailability("brick-1"), {
    hand: true,
    axis: true,
    rotate: true,
  });
});

test("axis tool stays active before selection and attaches to the clicked brick", () => {
  const scene = new THREE.Scene();
  const domElement = createDomElement();
  const brickScene = createBrickScene(scene);
  const fakeTransformControls = new FakeTransformControls();
  let selectedBrickId = null;

  brickScene.setModel(createEditableModel());
  brickScene.getBrickObject("brick-1").traverse((child) => {
    if (child.isMesh) {
      child.raycast = (_raycaster, intersections) => {
        intersections.push({ distance: 1, object: child });
      };
    }
  });
  scene.updateMatrixWorld(true);
  const camera = createTopDownCamera();
  const controls = createEditorControls({
    camera,
    domElement,
    scene,
    orbitControls: { enabled: true },
    brickScene,
    getModel: createEditableModel,
    setModel() {},
    onSelectionChange(brickId) {
      selectedBrickId = brickId;
    },
    createTransformControls: () => fakeTransformControls,
  });

  assert.equal(controls.setTool("axis"), "axis");

  const brickClient = worldToClient(
    camera,
    domElement,
    brickScene.getBrickObject("brick-1").position,
  );
  domElement.dispatchPointerEvent("pointerdown", brickClient);

  assert.equal(selectedBrickId, "brick-1");
  assert.equal(fakeTransformControls.attachedObject, brickScene.getBrickObject("brick-1"));

  controls.dispose();
  brickScene.dispose();
});

test("hand dragging follows the pointer visually with a rotated camera", () => {
  const scene = new THREE.Scene();
  const domElement = createDomElement();
  const brickScene = createBrickScene(scene);
  const orbitControls = { enabled: true };
  let model = createEditableModel();
  const commits = [];

  brickScene.setModel(model);
  brickScene.getBrickObject("brick-1").traverse((child) => {
    if (child.isMesh) {
      child.raycast = (_raycaster, intersections) => {
        intersections.push({ distance: 1, object: child });
      };
    }
  });
  scene.updateMatrixWorld(true);
  const camera = createRotatedCamera();
  const controls = createEditorControls({
    camera,
    domElement,
    scene,
    orbitControls,
    brickScene,
    getModel: () => model,
    setModel(nextModel, options) {
      model = nextModel;
      commits.push({ model: nextModel, options });
    },
    createTransformControls: () => new FakeTransformControls(),
  });

  controls.setSelectedBrickId("brick-1");
  const startClient = worldToClient(
    camera,
    domElement,
    brickScene.getBrickObject("brick-1").position,
  );
  const targetVisualCenter = positionToLduCenter({
    ...model.bricks[0],
    position: { x: 1, y: -1, z: 0 },
  });
  const targetClient = worldToClient(
    camera,
    domElement,
    new THREE.Vector3(
      targetVisualCenter.x,
      targetVisualCenter.y,
      targetVisualCenter.z,
    ),
  );

  domElement.dispatchPointerEvent("pointerdown", startClient);
  domElement.dispatchPointerEvent("pointermove", targetClient);

  const snappedVisualCenter = positionToLduCenter({
    ...model.bricks[0],
    position: { x: 1, y: -1, z: 0 },
  });

  assert.equal(commits.length, 0);
  assert.equal(orbitControls.enabled, false);
  assert.deepEqual(
    brickScene.getBrickObject("brick-1").position.toArray(),
    [snappedVisualCenter.x, snappedVisualCenter.y, snappedVisualCenter.z],
  );

  domElement.dispatchPointerEvent("pointerup", targetClient);

  assert.equal(commits.length, 1);
  assert.deepEqual(commits[0].options, { editedBrickId: "brick-1" });
  assert.deepEqual(model.bricks[0].position, { x: 1, y: -1, z: 0 });
  assert.equal(orbitControls.enabled, true);

  controls.dispose();
  brickScene.dispose();
});

test("right-clicking a brick selects it and reports the context menu position", () => {
  const scene = new THREE.Scene();
  const domElement = createDomElement();
  const brickScene = createBrickScene(scene);
  let selectedBrickId = null;
  let contextMenuRequest = null;

  brickScene.setModel(createEditableModel());
  brickScene.getBrickObject("brick-1").traverse((child) => {
    if (child.isMesh) {
      child.raycast = (_raycaster, intersections) => {
        intersections.push({ distance: 1, object: child });
      };
    }
  });
  scene.updateMatrixWorld(true);
  const controls = createEditorControls({
    camera: createTopDownCamera(),
    domElement,
    scene,
    orbitControls: { enabled: true },
    brickScene,
    getModel: createEditableModel,
    setModel() {},
    onSelectionChange(brickId) {
      selectedBrickId = brickId;
    },
    onBrickContextMenu(request) {
      contextMenuRequest = request;
    },
    createTransformControls: () => new FakeTransformControls(),
  });

  const brickClient = worldToClient(
    createTopDownCamera(),
    domElement,
    brickScene.getBrickObject("brick-1").position,
  );
  domElement.dispatchContextMenuEvent(brickClient);

  assert.equal(selectedBrickId, "brick-1");
  assert.deepEqual(contextMenuRequest, {
    brickId: "brick-1",
    clientX: brickClient.clientX,
    clientY: brickClient.clientY,
  });

  controls.dispose();
  brickScene.dispose();
});

test("hand dragging live-stacks under the pointer and commits without a release jump", () => {
  const scene = new THREE.Scene();
  const domElement = createDomElement();
  const brickScene = createBrickScene(scene);
  const orbitControls = { enabled: true };
  let model = createStackableDragModel();
  const commits = [];

  brickScene.setModel(model);
  brickScene.getBrickObject("moving").traverse((child) => {
    if (child.isMesh) {
      child.raycast = (_raycaster, intersections) => {
        intersections.push({ distance: 1, object: child });
      };
    }
  });
  scene.updateMatrixWorld(true);
  const camera = createTopDownCamera();
  const controls = createEditorControls({
    camera,
    domElement,
    scene,
    orbitControls,
    brickScene,
    getModel: () => model,
    setModel(nextModel, options) {
      model = nextModel;
      commits.push({ model: nextModel, options });
    },
    createTransformControls: () => new FakeTransformControls(),
  });

  controls.setSelectedBrickId("moving");
  const movingBrick = model.bricks.find((brick) => brick.id === "moving");
  const startClient = worldToClient(
    camera,
    domElement,
    brickScene.getBrickObject("moving").position,
  );
  const stackedClient = worldToClient(
    camera,
    domElement,
    new THREE.Vector3(10, 12, 10),
  );
  const groundClient = worldToClient(
    camera,
    domElement,
    new THREE.Vector3(50, 12, 10),
  );

  domElement.dispatchPointerEvent("pointerdown", startClient);
  domElement.dispatchPointerEvent("pointermove", stackedClient);

  const stackedCenter = positionToLduCenter({
    ...movingBrick,
    position: { x: 0, y: 0, z: 3 },
  });

  assert.equal(commits.length, 0);
  assert.deepEqual(
    brickScene.getBrickObject("moving").position.toArray(),
    [stackedCenter.x, stackedCenter.y, stackedCenter.z],
  );

  domElement.dispatchPointerEvent("pointermove", groundClient);

  const groundCenter = positionToLduCenter({
    ...movingBrick,
    position: { x: 2, y: 0, z: 0 },
  });

  assert.deepEqual(
    brickScene.getBrickObject("moving").position.toArray(),
    [groundCenter.x, groundCenter.y, groundCenter.z],
  );

  domElement.dispatchPointerEvent("pointermove", stackedClient);
  domElement.dispatchPointerEvent("pointerup", stackedClient);

  assert.equal(commits.length, 1);
  assert.deepEqual(commits[0].options, { editedBrickId: "moving" });
  assert.deepEqual(
    model.bricks.find((brick) => brick.id === "moving").position,
    { x: 0, y: 0, z: 3 },
  );

  controls.dispose();
  brickScene.dispose();
});

test("axis dragging snaps the visual brick while deferring model commits until drag end", () => {
  const scene = new THREE.Scene();
  const domElement = createDomElement();
  const brickScene = createBrickScene(scene);
  const fakeTransformControls = new FakeTransformControls();
  let model = createEditableModel();
  const commits = [];

  brickScene.setModel(model);
  const controls = createEditorControls({
    camera: new THREE.PerspectiveCamera(),
    domElement,
    scene,
    orbitControls: { enabled: true },
    brickScene,
    getModel: () => model,
    setModel(nextModel, options) {
      model = nextModel;
      commits.push({ model: nextModel, options });
    },
    createTransformControls: () => fakeTransformControls,
  });

  controls.setSelectedBrickId("brick-1");
  assert.equal(controls.setTool("axis"), "axis");

  const object = brickScene.getBrickObject("brick-1");
  object.position.set(74, 12, 21);
  fakeTransformControls.dispatchEvent({ type: "dragging-changed", value: true });
  fakeTransformControls.dispatchEvent({ type: "objectChange" });

  const firstSnappedCenter = positionToLduCenter({
    ...model.bricks[0],
    position: { x: 3, y: 1, z: 0 },
  });

  assert.deepEqual(
    object.position.toArray(),
    [firstSnappedCenter.x, firstSnappedCenter.y, firstSnappedCenter.z],
  );
  assert.equal(commits.length, 0);

  object.position.set(95, 12, 41);
  fakeTransformControls.dispatchEvent({ type: "objectChange" });

  const secondSnappedCenter = positionToLduCenter({
    ...model.bricks[0],
    position: { x: 4, y: 2, z: 0 },
  });

  assert.deepEqual(
    object.position.toArray(),
    [secondSnappedCenter.x, secondSnappedCenter.y, secondSnappedCenter.z],
  );
  assert.equal(commits.length, 0);

  fakeTransformControls.dispatchEvent({ type: "dragging-changed", value: false });

  assert.equal(commits.length, 1);
  assert.deepEqual(commits[0].options, { editedBrickId: "brick-1" });
  assert.deepEqual(model.bricks[0].position, { x: 4, y: 2, z: 0 });

  controls.dispose();
  brickScene.dispose();
});

test("axis dragging snaps scene Y movement to plate-layer height during drag", () => {
  const scene = new THREE.Scene();
  const domElement = createDomElement();
  const brickScene = createBrickScene(scene);
  const fakeTransformControls = new FakeTransformControls();
  let model = createEditableModel();

  brickScene.setModel(model);
  const controls = createEditorControls({
    camera: new THREE.PerspectiveCamera(),
    domElement,
    scene,
    orbitControls: { enabled: true },
    brickScene,
    getModel: () => model,
    setModel(nextModel) {
      model = nextModel;
    },
    createTransformControls: () => fakeTransformControls,
  });

  controls.setSelectedBrickId("brick-1");
  assert.equal(controls.setTool("axis"), "axis");

  const object = brickScene.getBrickObject("brick-1");
  object.position.set(10, 27, 10);
  fakeTransformControls.dispatchEvent({ type: "dragging-changed", value: true });
  fakeTransformControls.dispatchEvent({ type: "objectChange" });

  assert.deepEqual(
    object.position.toArray(),
    [10, 28, 10],
  );

  fakeTransformControls.dispatchEvent({ type: "dragging-changed", value: false });

  assert.deepEqual(model.bricks[0].position, { x: 0, y: 0, z: 2 });

  controls.dispose();
  brickScene.dispose();
});
