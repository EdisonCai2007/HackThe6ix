import * as THREE from "three";
import { LDrawLoader } from "three/addons/loaders/LDrawLoader.js";
import { LDrawConditionalLineMaterial } from "three/addons/materials/LDrawConditionalLineMaterial.js";

import { exportModelToLDraw } from "../ldraw/exportLDraw.js";
import { cameraFrameForModelSize } from "./cameraFraming.js";
import { placementOffsetForBox } from "./modelPlacement.js";

export const ISOMETRIC_SNAPSHOT_CONFIG = Object.freeze({
  width: 768,
  height: 768,
  fieldOfViewDegrees: 35,
  viewDirection: Object.freeze({ x: 1, y: 0.85, z: 1 }),
  backgroundColor: 0xf3f5f8,
});

function defaultCreateCanvas() {
  return document.createElement("canvas");
}

function defaultCreateRenderer(canvas) {
  return new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: false,
    preserveDrawingBuffer: true,
  });
}

function defaultCreateLoader() {
  const loader = new LDrawLoader();
  loader.setConditionalLineMaterial(LDrawConditionalLineMaterial);
  return loader;
}

function parseModel(loader, model) {
  return new Promise((resolve, reject) => {
    loader.parse(exportModelToLDraw(model), resolve, reject);
  });
}

function disposeGroup(group) {
  group.traverse((child) => {
    child.geometry?.dispose?.();

    if (Array.isArray(child.material)) {
      child.material.forEach((material) => material.dispose?.());
    } else {
      child.material?.dispose?.();
    }
  });
}

function imagePayloadFromCanvas(canvas) {
  const dataUrl = canvas.toDataURL("image/png");
  const marker = ";base64,";
  const markerIndex = dataUrl.indexOf(marker);

  if (!dataUrl.startsWith("data:image/png") || markerIndex === -1) {
    throw new Error("Isometric snapshot canvas did not produce a PNG data URL.");
  }

  return {
    mimeType: "image/png",
    data: dataUrl.slice(markerIndex + marker.length),
  };
}

/**
 * Creates a dedicated, fixed-camera renderer so image capture never mutates
 * the editor scene, editor camera, selection, validation overlays, or grid.
 */
export function createIsometricSnapshotRenderer({
  createCanvas = defaultCreateCanvas,
  createRenderer = defaultCreateRenderer,
  createLoader = defaultCreateLoader,
} = {}) {
  return {
    async capture(model) {
      const canvas = createCanvas();
      canvas.width = ISOMETRIC_SNAPSHOT_CONFIG.width;
      canvas.height = ISOMETRIC_SNAPSHOT_CONFIG.height;

      const renderer = createRenderer(canvas);
      const scene = new THREE.Scene();
      scene.background = new THREE.Color(ISOMETRIC_SNAPSHOT_CONFIG.backgroundColor);
      const camera = new THREE.PerspectiveCamera(
        ISOMETRIC_SNAPSHOT_CONFIG.fieldOfViewDegrees,
        ISOMETRIC_SNAPSHOT_CONFIG.width / ISOMETRIC_SNAPSHOT_CONFIG.height,
        0.1,
        5000,
      );
      let group = null;

      try {
        renderer.setPixelRatio(1);
        renderer.setSize(
          ISOMETRIC_SNAPSHOT_CONFIG.width,
          ISOMETRIC_SNAPSHOT_CONFIG.height,
          false,
        );
        renderer.outputColorSpace = THREE.SRGBColorSpace;

        scene.add(new THREE.HemisphereLight(0xffffff, 0x3e4754, 2));
        const keyLight = new THREE.DirectionalLight(0xffffff, 2.4);
        keyLight.position.set(220, 300, 180);
        scene.add(keyLight);
        const fillLight = new THREE.DirectionalLight(0xaec8ff, 1.1);
        fillLight.position.set(-180, 130, -160);
        scene.add(fillLight);

        group = await parseModel(createLoader(), model);
        group.rotation.x = Math.PI;
        group.updateMatrixWorld(true);

        const initialBox = new THREE.Box3().setFromObject(group);
        if (!initialBox.isEmpty()) {
          group.position.add(placementOffsetForBox(initialBox));
        }
        group.updateMatrixWorld(true);
        scene.add(group);

        const box = new THREE.Box3().setFromObject(group);
        const hasGeometry = !box.isEmpty();
        const size = hasGeometry
          ? box.getSize(new THREE.Vector3())
          : new THREE.Vector3(40, 40, 40);
        const target = hasGeometry
          ? box.getCenter(new THREE.Vector3())
          : new THREE.Vector3();
        const fovRadians = THREE.MathUtils.degToRad(camera.fov);
        const boundingSphereDiameter = size.length();
        const framingSize = new THREE.Vector3().setScalar(boundingSphereDiameter);
        const frame = cameraFrameForModelSize(framingSize, fovRadians);
        const viewDirection = new THREE.Vector3(
          ISOMETRIC_SNAPSHOT_CONFIG.viewDirection.x,
          ISOMETRIC_SNAPSHOT_CONFIG.viewDirection.y,
          ISOMETRIC_SNAPSHOT_CONFIG.viewDirection.z,
        ).normalize();

        camera.position.copy(target).add(viewDirection.multiplyScalar(frame.distance));
        camera.near = frame.near;
        camera.far = frame.far;
        camera.lookAt(target);
        camera.updateProjectionMatrix();
        renderer.render(scene, camera);

        return imagePayloadFromCanvas(canvas);
      } finally {
        if (group) {
          scene.remove(group);
          disposeGroup(group);
        }

        renderer.dispose?.();
        renderer.forceContextLoss?.();
      }
    },
  };
}
