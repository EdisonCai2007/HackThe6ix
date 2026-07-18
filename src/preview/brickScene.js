import * as THREE from "three";

import { getPartDimensions, SUPPORTED_PARTS } from "../generation/partCatalog.js";
import { PLATE_UNIT_LDU, STUD_LDU, positionToLduCenter } from "./editorGeometry.js";
import { placementOffsetForModel } from "./modelPlacement.js";

const COLOR_HEX = {
  0: 0x05131d,
  2: 0x237841,
  4: 0xc91a09,
  6: 0x583927,
  14: 0xf2cd37,
  15: 0xffffff,
  19: 0xe4cd9e,
  25: 0xfe8a18,
  43: 0xaeefec,
  72: 0x6c6e68,
};

function partHeightLdu(part) {
  return part.category === "plate" ? PLATE_UNIT_LDU : PLATE_UNIT_LDU * 3;
}

function bodySizeLdu(part) {
  return {
    width: part.width * STUD_LDU,
    height: partHeightLdu(part),
    depth: part.depth * STUD_LDU,
  };
}

function materialForBrick(brick) {
  const transparent = brick.preview || brick.color_id === "43";

  return new THREE.MeshStandardMaterial({
    color: COLOR_HEX[brick.color_id] ?? 0xd9d9d9,
    roughness: 0.46,
    metalness: 0.02,
    transparent,
    opacity: brick.preview ? 0.48 : transparent ? 0.62 : 1,
    depthWrite: !brick.preview,
  });
}

function createStudMesh(material) {
  const geometry = new THREE.CylinderGeometry(6, 6, 4, 16);
  const stud = new THREE.Mesh(geometry, material);
  stud.castShadow = true;
  stud.receiveShadow = true;
  return stud;
}

function createSelectionOutline(part) {
  const size = bodySizeLdu(part);
  const boxGeometry = new THREE.BoxGeometry(size.width, size.height, size.depth);
  const outline = new THREE.LineSegments(
    new THREE.EdgesGeometry(boxGeometry),
    new THREE.LineBasicMaterial({
      color: 0x000000,
      transparent: true,
      depthTest: true,
      depthWrite: false,
      toneMapped: false,
    }),
  );

  boxGeometry.dispose();
  outline.visible = false;
  outline.renderOrder = 3;
  outline.raycast = () => {};
  outline.userData.type = "selection-outline";
  return outline;
}

function createInvalidOverlay(part) {
  const height = partHeightLdu(part) + 4;
  const overlay = new THREE.Mesh(
    new THREE.BoxGeometry(
      part.width * STUD_LDU + 4,
      height,
      part.depth * STUD_LDU + 4,
    ),
    new THREE.MeshBasicMaterial({
      color: 0xff1e1e,
      transparent: true,
      opacity: 0.25,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  );
  overlay.visible = false;
  overlay.renderOrder = 2;
  overlay.raycast = () => {};
  overlay.userData.type = "invalid-overlay";
  return overlay;
}

function createBrickObject(brick) {
  const part = SUPPORTED_PARTS[brick.part_id];
  const dimensions = getPartDimensions(brick.part_id, brick.rotation);

  if (!part || !dimensions) {
    return null;
  }

  const group = new THREE.Group();
  group.name = brick.id;
  group.userData.brickId = brick.id;
  group.userData.type = "editable-brick";

  const material = materialForBrick(brick);
  const size = bodySizeLdu(part);
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(size.width, size.height, size.depth),
    material,
  );
  body.castShadow = true;
  body.receiveShadow = true;
  group.add(body);

  const topY = size.height / 2 + 2;

  for (let x = 0; x < part.width; x += 1) {
    for (let z = 0; z < part.depth; z += 1) {
      const stud = createStudMesh(material);
      stud.position.set(
        -(part.width * STUD_LDU) / 2 + STUD_LDU / 2 + x * STUD_LDU,
        topY,
        -(part.depth * STUD_LDU) / 2 + STUD_LDU / 2 + z * STUD_LDU,
      );
      group.add(stud);
    }
  }

  const outline = createSelectionOutline(part);
  group.add(outline);
  group.userData.outline = outline;

  const invalidOverlay = createInvalidOverlay(part);
  group.add(invalidOverlay);
  group.userData.invalidOverlay = invalidOverlay;

  applyBrickTransform(group, brick);
  return group;
}

function applyBrickTransform(object, brick) {
  const center = positionToLduCenter(brick);
  object.position.set(center.x, center.y, center.z);
  object.rotation.y = THREE.MathUtils.degToRad(brick.rotation);
  object.userData.brick = brick;
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

export function createBrickScene(scene) {
  const root = new THREE.Group();
  root.name = "editable-brick-root";
  scene.add(root);

  const objectsById = new Map();
  const bricksById = new Map();
  let selectedBrickId = null;
  let invalidBrickIds = new Set();

  function updateRootPlacement() {
    const placedBricks = [...bricksById.values()].filter((brick) => !brick.preview);
    const offset = placementOffsetForModel({ bricks: placedBricks });
    root.position.set(offset.x, offset.y, offset.z);
    root.updateMatrixWorld(true);
  }

  function updateVisualState(object) {
    const brickId = object.userData.brickId;
    const outline = object.userData.outline;
    const invalidOverlay = object.userData.invalidOverlay;
    const invalid = invalidBrickIds.has(brickId);
    const selected = selectedBrickId === brickId;
    const preview = object.userData.brick?.preview === true;

    if (outline) {
      outline.visible = invalid || selected || !preview;
      outline.material.color.set(invalid ? 0xff2f2f : selected ? 0xf2cd37 : 0x000000);
      outline.material.depthTest = !invalid && !selected;
    }

    if (invalidOverlay) {
      invalidOverlay.visible = invalid;
    }

    object.traverse((child) => {
      if (child.isMesh && child.material) {
        child.material.emissive?.setHex(invalid ? 0x661111 : 0x000000);
      }
    });
  }

  return {
    root,
    objectsById,
    setModel(model, { preserveRootPlacement = false } = {}) {
      const nextIds = new Set(model.bricks.map((brick) => brick.id));

      for (const [brickId, object] of objectsById.entries()) {
        if (!nextIds.has(brickId)) {
          root.remove(object);
          disposeObject(object);
          objectsById.delete(brickId);
          bricksById.delete(brickId);
        }
      }

      for (const brick of model.bricks) {
        updateBrickObject(brick);
      }

      if (!preserveRootPlacement) {
        updateRootPlacement();
      }
    },
    updateBrick(brick) {
      updateBrickObject(brick);
    },
    removeBrick(brickId) {
      removeBrickObject(brickId);
    },
    getBrickObject(brickId) {
      return objectsById.get(brickId) ?? null;
    },
    setSelectedBrick(brickId) {
      selectedBrickId = brickId;
      for (const object of objectsById.values()) {
        updateVisualState(object);
      }
    },
    setInvalidBrickIds(ids) {
      invalidBrickIds = new Set(ids);
      for (const object of objectsById.values()) {
        updateVisualState(object);
      }
    },
    update(time) {
      const opacity = 0.2 + (Math.sin(time * 8) + 1) * 0.22;

      for (const brickId of invalidBrickIds) {
        const overlay = objectsById.get(brickId)?.userData.invalidOverlay;
        if (overlay?.visible) {
          overlay.material.opacity = opacity;
        }
      }
    },
    dispose() {
      for (const object of objectsById.values()) {
        root.remove(object);
        disposeObject(object);
      }
      objectsById.clear();
      bricksById.clear();
      scene.remove(root);
    },
  };

  function updateBrickObject(brick) {
    bricksById.set(brick.id, brick);
    const existing = objectsById.get(brick.id);

    if (existing) {
      applyBrickTransform(existing, brick);
      updateVisualState(existing);
      return;
    }

    const object = createBrickObject(brick);

    if (!object) {
      bricksById.delete(brick.id);
      return;
    }

    objectsById.set(brick.id, object);
    root.add(object);
    updateVisualState(object);
  }

  function removeBrickObject(brickId) {
    const object = objectsById.get(brickId);

    if (!object) {
      bricksById.delete(brickId);
      return;
    }

    root.remove(object);
    disposeObject(object);
    objectsById.delete(brickId);
    bricksById.delete(brickId);
  }
}
