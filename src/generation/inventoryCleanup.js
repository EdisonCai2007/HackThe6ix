import { SUPPORTED_PARTS } from "./partCatalog.js";

function keyFor(partId, colorId) {
  return `${partId}:${colorId}`;
}

function buildAvailableInventory(inventory) {
  const available = new Map();

  for (const item of inventory.items) {
    if (!item.supported || !SUPPORTED_PARTS[item.part_id]) {
      continue;
    }

    const key = keyFor(item.part_id, item.color_id);
    available.set(key, (available.get(key) ?? 0) + item.count);
  }

  return available;
}

function removedBrickFor(brick, reason, message) {
  return {
    id: brick.id,
    feature: brick.feature,
    part_id: brick.part_id,
    color_id: brick.color_id,
    reason,
    message,
  };
}

export function cleanupIllegalInventoryUsage(model, inventory) {
  const available = buildAvailableInventory(inventory);
  const keptCounts = new Map();
  const keptBricks = [];
  const removedBricks = [];

  for (const brick of model.bricks) {
    if (!SUPPORTED_PARTS[brick.part_id]) {
      removedBricks.push(
        removedBrickFor(
          brick,
          "unsupported_part",
          `${brick.id} uses unsupported part ${brick.part_id}.`,
        ),
      );
      continue;
    }

    const inventoryKey = keyFor(brick.part_id, brick.color_id);
    const availableCount = available.get(inventoryKey) ?? 0;

    if (availableCount === 0) {
      removedBricks.push(
        removedBrickFor(
          brick,
          "inventory_missing",
          `${brick.id} uses part ${brick.part_id} color ${brick.color_id}, which is not in the confirmed supported inventory.`,
        ),
      );
      continue;
    }

    const keptCount = keptCounts.get(inventoryKey) ?? 0;

    if (keptCount >= availableCount) {
      removedBricks.push(
        removedBrickFor(
          brick,
          "inventory_exceeded",
          `${brick.id} exceeds available inventory for part ${brick.part_id} color ${brick.color_id}.`,
        ),
      );
      continue;
    }

    keptCounts.set(inventoryKey, keptCount + 1);
    keptBricks.push(brick);
  }

  return {
    model: {
      ...model,
      piece_count: keptBricks.length,
      bricks: keptBricks,
    },
    removedBricks,
  };
}
