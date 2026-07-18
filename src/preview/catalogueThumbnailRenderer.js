import * as THREE from "three";
import { LDrawLoader } from "three/addons/loaders/LDrawLoader.js";
import { LDrawConditionalLineMaterial } from "three/addons/materials/LDrawConditionalLineMaterial.js";

import { exportModelToLDraw } from "../ldraw/exportLDraw.js";

function defaultRendererFactory() {
  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: true,
    preserveDrawingBuffer: true,
  });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  return renderer;
}

function defaultLoaderFactory() {
  const loader = new LDrawLoader();
  loader.setConditionalLineMaterial(LDrawConditionalLineMaterial);
  return loader;
}

function thumbnailModelForItem(item) {
  return {
    model_name: item.label,
    prompt: `Catalogue thumbnail for ${item.label}`,
    piece_count: 1,
    dimensions: { width_studs: 0, depth_studs: 0, height_layers: 0 },
    created_from_inventory_id: "catalogue-thumbnail",
    generator_version: "preview-ui",
    notes: [],
    bricks: [
      {
        id: "thumbnail-brick",
        part_id: item.part_id,
        ldraw_id: item.ldraw_id,
        label: item.label,
        color_id: item.color_id,
        color_name: item.color_name,
        position: { x: 0, y: 0, z: 0 },
        rotation: item.category === "plate" ? 90 : 0,
        feature: "catalogue-thumbnail",
        step: 1,
      },
    ],
  };
}

function disposeObject(object) {
  object.traverse((child) => {
    child.geometry?.dispose?.();
    if (Array.isArray(child.material)) {
      child.material.forEach((material) => material.dispose?.());
    } else {
      child.material?.dispose?.();
    }
  });
}

function rasterizeToCanvas(renderer, canvas, group, requestedPixelRatio) {
  const width = canvas.clientWidth || 170;
  const height = canvas.clientHeight || 112;
  const pixelRatio = Math.max(1, Number(requestedPixelRatio) || 1);

  renderer.setPixelRatio(pixelRatio);
  renderer.setSize(width, height, false);

  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x2b3038, 2));

  const keyLight = new THREE.DirectionalLight(0xffffff, 2.4);
  keyLight.position.set(80, 110, 70);
  scene.add(keyLight);

  group.rotation.x = Math.PI;
  const box = new THREE.Box3().setFromObject(group);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  group.position.sub(center);
  scene.add(group);

  const camera = new THREE.PerspectiveCamera(34, width / height, 0.1, 1200);
  const maxDimension = Math.max(size.x, size.y, size.z, 1);
  const fov = THREE.MathUtils.degToRad(camera.fov);
  const distance = (maxDimension / (2 * Math.tan(fov / 2))) * 1.75;
  camera.position.copy(
    new THREE.Vector3(0.95, 0.85, 1.15).normalize().multiplyScalar(distance),
  );
  camera.lookAt(0, 0, 0);

  renderer.render(scene, camera);

  canvas.width = Math.max(1, Math.round(width * pixelRatio));
  canvas.height = Math.max(1, Math.round(height * pixelRatio));
  const context = canvas.getContext("2d");

  if (!context) {
    throw new Error("Catalogue thumbnail canvas does not support 2D rendering.");
  }

  context.clearRect(0, 0, canvas.width, canvas.height);
  context.drawImage(renderer.domElement, 0, 0, canvas.width, canvas.height);
}

export function createCatalogueThumbnailRenderer({
  createRenderer = defaultRendererFactory,
  createLoader = defaultLoaderFactory,
  pixelRatio = () => Math.min(window.devicePixelRatio, 1.5),
} = {}) {
  let renderer = null;

  function getRenderer() {
    renderer ??= createRenderer();
    return renderer;
  }

  return {
    render(canvas, item, { isCurrent = () => true, onError } = {}) {
      return new Promise((resolve, reject) => {
        function fail(error) {
          const normalizedError = error instanceof Error
            ? error
            : new Error("Catalogue thumbnail failed to load.");
          onError?.(normalizedError);
          reject(normalizedError);
        }

        try {
          createLoader().parse(
            exportModelToLDraw(thumbnailModelForItem(item)),
            (group) => {
              if (!isCurrent()) {
                disposeObject(group);
                resolve(false);
                return;
              }

              try {
                rasterizeToCanvas(getRenderer(), canvas, group, pixelRatio());
                resolve(true);
              } catch (error) {
                fail(error);
              } finally {
                disposeObject(group);
              }
            },
            fail,
          );
        } catch (error) {
          fail(error);
        }
      });
    },
  };
}
