const NEIGHBOR_OFFSETS = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
];

export function targetCellKey(x, y, z) {
  return `${x},${y},${z}`;
}

export function parseTargetCellKey(key) {
  return key.split(",").map(Number);
}

function requirePositiveInteger(value, field) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${field} must be a positive integer.`);
  }
}

function requireNonNegativeInteger(value, field) {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${field} must be a non-negative integer.`);
  }
}

function validatePlacement(brick, index, worldDim) {
  if (!brick || typeof brick !== "object" || Array.isArray(brick)) {
    throw new Error(`bricks[${index}] must be an object.`);
  }

  requirePositiveInteger(brick.width, `bricks[${index}].width`);
  requirePositiveInteger(brick.depth, `bricks[${index}].depth`);
  requireNonNegativeInteger(brick.x, `bricks[${index}].x`);
  requireNonNegativeInteger(brick.y, `bricks[${index}].y`);
  requireNonNegativeInteger(brick.z, `bricks[${index}].z`);

  if (
    brick.x + brick.width > worldDim ||
    brick.y + brick.depth > worldDim ||
    brick.z >= worldDim
  ) {
    throw new Error(`bricks[${index}] exceeds world_dim ${worldDim}.`);
  }
}

function translatedCells(rawCells, minimums) {
  return new Set(
    [...rawCells].map((key) => {
      const [x, y, z] = parseTargetCellKey(key);
      return targetCellKey(x - minimums.x, y - minimums.y, z - minimums.z);
    }),
  );
}

function exteriorCells(cells) {
  return new Set(
    [...cells].filter((key) => {
      const [x, y, z] = parseTargetCellKey(key);
      return NEIGHBOR_OFFSETS.some(([dx, dy, dz]) => (
        !cells.has(targetCellKey(x + dx, y + dy, z + dz))
      ));
    }),
  );
}

export function normalizeBrickGptTarget({ seed, bricks, worldDim = 20 }) {
  requirePositiveInteger(worldDim, "worldDim");

  if (!Array.isArray(bricks) || bricks.length === 0) {
    throw new Error("bricks must contain at least one BrickGPT placement.");
  }

  const rawCells = new Set();
  const minimums = { x: Infinity, y: Infinity, z: Infinity };
  const maximums = { x: -Infinity, y: -Infinity, z: -Infinity };

  bricks.forEach((brick, index) => {
    validatePlacement(brick, index, worldDim);

    for (let x = brick.x; x < brick.x + brick.width; x += 1) {
      for (let y = brick.y; y < brick.y + brick.depth; y += 1) {
        for (let z = brick.z * 3; z < brick.z * 3 + 3; z += 1) {
          const key = targetCellKey(x, y, z);

          if (rawCells.has(key)) {
            throw new Error(`BrickGPT placements overlap at target cell ${key}.`);
          }

          rawCells.add(key);
          minimums.x = Math.min(minimums.x, x);
          minimums.y = Math.min(minimums.y, y);
          minimums.z = Math.min(minimums.z, z);
          maximums.x = Math.max(maximums.x, x);
          maximums.y = Math.max(maximums.y, y);
          maximums.z = Math.max(maximums.z, z);
        }
      }
    }
  });

  const cells = translatedCells(rawCells, minimums);

  return {
    seed,
    cells,
    exteriorCells: exteriorCells(cells),
    bounds: {
      width: maximums.x - minimums.x + 1,
      depth: maximums.y - minimums.y + 1,
      height: maximums.z - minimums.z + 1,
    },
    sourceBricks: bricks.map((brick) => ({ ...brick })),
    translation: { ...minimums },
  };
}
