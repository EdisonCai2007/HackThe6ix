import { getPartDimensions, SUPPORTED_PARTS } from "../generation/partCatalog.js";

export const STUD_LDU = 20;
export const PLATE_UNIT_LDU = 8;

function roundedGridValue(value) {
  const rounded = Math.round(value);
  return Object.is(rounded, -0) ? 0 : rounded;
}

export function snapGridPosition(position) {
  return {
    x: roundedGridValue(position.x),
    y: roundedGridValue(position.y),
    z: roundedGridValue(position.z),
  };
}

export function isSnappedGridPosition(position) {
  return Number.isInteger(position.x) &&
    Number.isInteger(position.y) &&
    Number.isInteger(position.z);
}

export function normalizedRotation(rotation) {
  const normalized = ((rotation % 360) + 360) % 360;
  return normalized % 90 === 0 ? normalized : null;
}

export function occupiedCellsForBrick(brick) {
  const dimensions = getPartDimensions(brick.part_id, brick.rotation);

  if (!dimensions) {
    return [];
  }

  const cells = [];

  for (let x = brick.position.x; x < brick.position.x + dimensions.width; x += 1) {
    for (let y = brick.position.y; y < brick.position.y + dimensions.depth; y += 1) {
      for (let z = brick.position.z; z < brick.position.z + dimensions.height; z += 1) {
        cells.push({ x, y, z });
      }
    }
  }

  return cells;
}

function footprintCells(brick) {
  const dimensions = getPartDimensions(brick.part_id, brick.rotation);

  if (!dimensions) {
    return [];
  }

  const cells = [];

  for (let x = brick.position.x; x < brick.position.x + dimensions.width; x += 1) {
    for (let y = brick.position.y; y < brick.position.y + dimensions.depth; y += 1) {
      cells.push({ x, y });
    }
  }

  return cells;
}

export function findDropZForFootprint(brick, bricks) {
  const movingFootprint = new Set(
    footprintCells(brick).map((cell) => `${cell.x},${cell.y}`),
  );
  let highestTop = 0;

  for (const existingBrick of bricks) {
    if (existingBrick.id === brick.id) {
      continue;
    }

    const dimensions = getPartDimensions(existingBrick.part_id, existingBrick.rotation);

    if (!dimensions) {
      continue;
    }

    const overlaps = footprintCells(existingBrick).some((cell) =>
      movingFootprint.has(`${cell.x},${cell.y}`),
    );

    if (overlaps) {
      highestTop = Math.max(
        highestTop,
        existingBrick.position.z + dimensions.height,
      );
    }
  }

  return highestTop;
}

function partHeightLdu(part) {
  return part.category === "plate" ? PLATE_UNIT_LDU : PLATE_UNIT_LDU * 3;
}

export function positionToLduCenter(brick) {
  const part = SUPPORTED_PARTS[brick.part_id];
  const dimensions = getPartDimensions(brick.part_id, brick.rotation);

  if (!part || !dimensions) {
    return { x: 0, y: 0, z: 0 };
  }

  return {
    x: (brick.position.x + dimensions.width / 2) * STUD_LDU,
    y: brick.position.z * PLATE_UNIT_LDU + partHeightLdu(part) / 2,
    z: (brick.position.y + dimensions.depth / 2) * STUD_LDU,
  };
}
