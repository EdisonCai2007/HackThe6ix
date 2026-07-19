import { getPartDimensions, SUPPORTED_PARTS } from "./partCatalog.js";

function keyFor(partId, colorId) {
  return `${partId}:${colorId}`;
}

function cellKey({ x, y, z }) {
  return `${x},${y},${z}`;
}

function createError(type, message, extra = {}) {
  return {
    type,
    severity: "hard",
    message,
    ...extra,
  };
}

function isGridAligned(position) {
  return Number.isInteger(position.x) &&
    Number.isInteger(position.y) &&
    Number.isInteger(position.z);
}

function isQuarterTurn(rotation) {
  const normalized = ((rotation % 360) + 360) % 360;
  return normalized === 0 ||
    normalized === 90 ||
    normalized === 180 ||
    normalized === 270;
}

function buildAvailableInventory(inventory) {
  const available = new Map();
  const labels = new Map();

  for (const item of inventory.items) {
    if (!item.supported) {
      continue;
    }

    const key = keyFor(item.part_id, item.color_id);
    available.set(key, (available.get(key) ?? 0) + item.count);
    labels.set(key, {
      label: item.label,
      color_name: item.color_name,
      part_id: item.part_id,
      color_id: item.color_id,
    });
  }

  return { available, labels };
}

function occupiedCellsForBrick(brick) {
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

function hasSupport(brick, occupiedByCell) {
  if (brick.position.z === 0) {
    return true;
  }

  return occupiedCellsForBrick(brick).some((cell) => {
    if (cell.z !== brick.position.z) {
      return false;
    }

    const below = cellKey({ x: cell.x, y: cell.y, z: cell.z - 1 });
    const supporter = occupiedByCell.get(below);
    return supporter && supporter !== brick.id;
  });
}

function verticalStudOverlapCount(firstBrick, secondBrick, cellsByBrick) {
  const firstCells = cellsByBrick.get(firstBrick.id) ?? [];
  const secondCells = new Set(
    (cellsByBrick.get(secondBrick.id) ?? []).map((cell) => cellKey(cell)),
  );
  let overlapCount = 0;

  for (const cell of firstCells) {
    const above = cellKey({ x: cell.x, y: cell.y, z: cell.z + 1 });
    const below = cellKey({ x: cell.x, y: cell.y, z: cell.z - 1 });

    if (secondCells.has(above) || secondCells.has(below)) {
      overlapCount += 1;
    }
  }

  return overlapCount;
}

function bricksConnectThroughStuds(firstBrick, secondBrick, cellsByBrick) {
  return verticalStudOverlapCount(firstBrick, secondBrick, cellsByBrick) > 0;
}

function connectedComponents(bricks, cellsByBrick) {
  if (bricks.length === 0) {
    return [];
  }

  const adjacency = new Map(bricks.map((brick) => [brick.id, []]));

  for (let i = 0; i < bricks.length; i += 1) {
    for (let j = i + 1; j < bricks.length; j += 1) {
      const first = bricks[i];
      const second = bricks[j];

      if (bricksConnectThroughStuds(first, second, cellsByBrick)) {
        adjacency.get(first.id).push(second.id);
        adjacency.get(second.id).push(first.id);
      }
    }
  }

  const seen = new Set();
  const components = [];

  for (const brick of bricks) {
    if (seen.has(brick.id)) {
      continue;
    }

    const stack = [brick.id];
    const component = [];

    while (stack.length > 0) {
      const current = stack.pop();

      if (seen.has(current)) {
        continue;
      }

      seen.add(current);
      component.push(current);

      for (const neighbor of adjacency.get(current) ?? []) {
        stack.push(neighbor);
      }
    }

    components.push(component);
  }

  return components;
}

/**
 * Validate a generated model against MVP inventory and geometry rules.
 *
 * @param {import("./types.js").GeneratedModel} model
 * @param {import("./types.js").Inventory} inventory
 * @returns {import("./types.js").ValidationResult}
 */
export function validateModel(model, inventory) {
  const errors = [];
  const warnings = [];
  const { available, labels } = buildAvailableInventory(inventory);
  const used = new Map();
  const cellsByBrick = new Map();
  const occupiedByCell = new Map();

  for (const brick of model.bricks) {
    const inventoryKey = keyFor(brick.part_id, brick.color_id);
    used.set(inventoryKey, (used.get(inventoryKey) ?? 0) + 1);

    if (!isGridAligned(brick.position)) {
      errors.push(
        createError(
          "off_grid_position",
          `${brick.id} is not snapped to the LEGO grid.`,
          {
            brick_instance_id: brick.id,
          },
        ),
      );
    }

    if (!isQuarterTurn(brick.rotation)) {
      errors.push(
        createError(
          "invalid_rotation",
          `${brick.id} rotation must be 0, 90, 180, or 270 degrees.`,
          {
            brick_instance_id: brick.id,
          },
        ),
      );
    }

    if (!SUPPORTED_PARTS[brick.part_id]) {
      errors.push(
        createError(
          "unsupported_part",
          `${brick.id} uses unsupported part ${brick.part_id}.`,
          {
            brick_instance_id: brick.id,
            part_id: brick.part_id,
            color_id: brick.color_id,
          },
        ),
      );
      continue;
    }

    const cells = occupiedCellsForBrick(brick);
    cellsByBrick.set(brick.id, cells);

    for (const cell of cells) {
      const occupiedKey = cellKey(cell);
      const existingBrickId = occupiedByCell.get(occupiedKey);

      if (existingBrickId) {
        errors.push(
          createError(
            "overlapping_bricks",
            `${brick.id} overlaps ${existingBrickId} at grid cell ${occupiedKey}.`,
            {
              brick_instance_id: brick.id,
            },
          ),
        );
      } else {
        occupiedByCell.set(occupiedKey, brick.id);
      }
    }
  }

  for (const [inventoryKey, usedCount] of used.entries()) {
    const availableCount = available.get(inventoryKey) ?? 0;
    const label = labels.get(inventoryKey);
    const [partId, colorId] = inventoryKey.split(":");

    if (availableCount === 0) {
      errors.push(
        createError(
          "inventory_missing",
          `Model uses part ${partId} color ${colorId}, which is not in the confirmed supported inventory.`,
          {
            part_id: partId,
            color_id: colorId,
            available: 0,
            used: usedCount,
          },
        ),
      );
    } else if (usedCount > availableCount) {
      const pieceName = label ? `${label.color_name} ${label.label}s` : `${partId}/${colorId} pieces`;
      errors.push(
        createError(
          "inventory_exceeded",
          `Used ${usedCount} ${pieceName} but only ${availableCount} are available.`,
          {
            part_id: partId,
            color_id: colorId,
            available: availableCount,
            used: usedCount,
          },
        ),
      );
    }
  }

  for (const brick of model.bricks) {
    if (!SUPPORTED_PARTS[brick.part_id]) {
      continue;
    }

    if (!hasSupport(brick, occupiedByCell)) {
      errors.push(
        createError(
          "floating_brick",
          `${brick.id} is above the ground layer without support underneath.`,
          {
            brick_instance_id: brick.id,
          },
        ),
      );
    }
  }

  const connectedBricks = model.bricks.filter((brick) => SUPPORTED_PARTS[brick.part_id]);
  const components = connectedComponents(connectedBricks, cellsByBrick);

  if (components.length > 1) {
    errors.push(
      createError(
        "disconnected_component",
        `Model contains ${components.length} disconnected brick groups.`,
        { component_brick_ids: components },
      ),
    );
  }

  if (
    model.bricks.length > 0 &&
    !model.bricks.some((brick) =>
      occupiedCellsForBrick(brick).some((cell) => cell.z === 0),
    )
  ) {
    errors.push(
      createError(
        "no_ground_contact",
        "Model must have at least one brick on the ground layer.",
      ),
    );
  }

  const inventory_usage = Array.from(available.entries()).map(
    ([inventoryKey, availableCount]) => {
      const [part_id, color_id] = inventoryKey.split(":");

      return {
        part_id,
        color_id,
        available: availableCount,
        used: used.get(inventoryKey) ?? 0,
      };
    },
  );

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    inventory_usage,
  };
}
