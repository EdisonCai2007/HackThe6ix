import { getPartDimensions } from "../partCatalog.js";

function inventoryKey(partId, colorName) {
  return `${partId}:${colorName}`;
}

export function createShowcaseBrickFactory(inventory, buildLabel) {
  const inventoryItems = new Map(
    inventory.items
      .filter((item) => item.supported)
      .map((item) => [inventoryKey(item.part_id, item.color_name), item]),
  );
  const used = new Map();

  return function brick({
    id,
    part_id,
    color_name,
    position,
    rotation = 0,
    feature,
    step,
  }) {
    const key = inventoryKey(part_id, color_name);
    const item = inventoryItems.get(key);

    if (!item) {
      throw new Error(
        `${buildLabel} requires ${color_name} part ${part_id}, which is not in inventory ${inventory.inventory_id}.`,
      );
    }

    const nextUsedCount = (used.get(key) ?? 0) + 1;

    if (nextUsedCount > item.count) {
      throw new Error(
        `${buildLabel} requires ${nextUsedCount} ${color_name} ${item.label}s, but inventory ${inventory.inventory_id} only has ${item.count}.`,
      );
    }

    used.set(key, nextUsedCount);

    return {
      id,
      part_id: item.part_id,
      ldraw_id: item.ldraw_id,
      label: item.label,
      color_id: item.color_id,
      color_name: item.color_name,
      position,
      rotation,
      feature,
      step,
    };
  };
}

export function dimensionsForBricks(bricks) {
  const extents = bricks.map((brick) => {
    const dimensions = getPartDimensions(brick.part_id, brick.rotation);

    return {
      minX: brick.position.x,
      maxX: brick.position.x + dimensions.width,
      minY: brick.position.y,
      maxY: brick.position.y + dimensions.depth,
      minZ: brick.position.z,
      maxZ: brick.position.z + dimensions.height,
    };
  });

  return {
    width_studs: Math.max(...extents.map(({ maxX }) => maxX)) -
      Math.min(...extents.map(({ minX }) => minX)),
    depth_studs: Math.max(...extents.map(({ maxY }) => maxY)) -
      Math.min(...extents.map(({ minY }) => minY)),
    height_layers: Math.max(...extents.map(({ maxZ }) => maxZ)) -
      Math.min(...extents.map(({ minZ }) => minZ)),
  };
}

export function completeShowcaseModel({
  modelName,
  prompt,
  generatorVersion,
  inventory,
  bricks,
  notes,
}) {
  return {
    model_name: modelName,
    prompt,
    piece_count: bricks.length,
    dimensions: dimensionsForBricks(bricks),
    created_from_inventory_id: inventory.inventory_id,
    generator_version: generatorVersion,
    bricks,
    notes: [...notes],
  };
}
