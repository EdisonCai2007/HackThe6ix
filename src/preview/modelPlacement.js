import * as THREE from "three";

import { getPartDimensions } from "../generation/partCatalog.js";
import { PLATE_UNIT_LDU, STUD_LDU } from "./editorGeometry.js";

function cleanZero(value) {
  return Object.is(value, -0) ? 0 : value;
}

export function placementOffsetForBox(box) {
  const center = box.getCenter(new THREE.Vector3());

  return new THREE.Vector3(
    cleanZero(-center.x),
    cleanZero(-box.min.y),
    cleanZero(-center.z),
  );
}

export function modelFootprintBounds(model) {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;

  for (const brick of model.bricks ?? []) {
    const dimensions = getPartDimensions(brick.part_id, brick.rotation);

    if (!dimensions) {
      continue;
    }

    minX = Math.min(minX, brick.position.x * STUD_LDU);
    maxX = Math.max(maxX, (brick.position.x + dimensions.width) * STUD_LDU);
    minY = Math.min(minY, brick.position.z * PLATE_UNIT_LDU);
    maxY = Math.max(maxY, (brick.position.z + dimensions.height) * PLATE_UNIT_LDU);
    minZ = Math.min(minZ, brick.position.y * STUD_LDU);
    maxZ = Math.max(maxZ, (brick.position.y + dimensions.depth) * STUD_LDU);
  }

  if (!Number.isFinite(minX)) {
    return null;
  }

  return {
    minX,
    maxX,
    minY,
    maxY,
    minZ,
    maxZ,
    centerX: (minX + maxX) / 2,
    centerZ: (minZ + maxZ) / 2,
    width: maxX - minX,
    height: maxY - minY,
    depth: maxZ - minZ,
  };
}

export function placementOffsetForModel(model) {
  const bounds = modelFootprintBounds(model);

  if (!bounds) {
    return { x: 0, y: 0, z: 0 };
  }

  return {
    x: cleanZero(-bounds.centerX),
    y: cleanZero(-bounds.minY),
    z: cleanZero(-bounds.centerZ),
  };
}
