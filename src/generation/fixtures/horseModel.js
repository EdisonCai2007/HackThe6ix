import { getPartDimensions } from "../partCatalog.js";
import { randomInventoryV2 } from "./randomInventoryV2.js";

function inventoryKey(partId, colorName) {
  return `${partId}:${colorName}`;
}

function createBrickFactory(inventory) {
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
        `Horse requires ${color_name} part ${part_id}, which is not in inventory ${inventory.inventory_id}.`,
      );
    }

    const nextUsedCount = (used.get(key) ?? 0) + 1;

    if (nextUsedCount > item.count) {
      throw new Error(
        `Horse requires ${nextUsedCount} ${color_name} ${item.label}s, but inventory ${inventory.inventory_id} only has ${item.count}.`,
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

function dimensionsFor(bricks) {
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
    width_studs: Math.max(...extents.map((extent) => extent.maxX)) -
      Math.min(...extents.map((extent) => extent.minX)),
    depth_studs: Math.max(...extents.map((extent) => extent.maxY)) -
      Math.min(...extents.map((extent) => extent.minY)),
    height_layers: Math.max(...extents.map((extent) => extent.maxZ)) -
      Math.min(...extents.map((extent) => extent.minZ)),
  };
}

function addLegsAndHooves(bricks, brick) {
  const legs = [
    { id: "rear-left", x: 3, y: 0, hoofY: 0 },
    { id: "rear-right", x: 3, y: 4, hoofY: 5 },
    { id: "front-left", x: 14, y: 0, hoofY: 0 },
    { id: "front-right", x: 14, y: 4, hoofY: 5 },
  ];

  for (const leg of legs) {
    for (const x of [leg.x, leg.x + 1]) {
      bricks.push(
        brick({
          id: `hoof-${leg.id}-${x}`,
          part_id: "3005",
          color_name: "black",
          position: { x, y: leg.hoofY, z: 0 },
          feature: "hoof",
          step: 1,
        }),
      );
    }

    for (const [course, z] of [
      ["lower", 3],
      ["upper", 6],
    ]) {
      bricks.push(
        brick({
          id: `leg-${leg.id}-${course}`,
          part_id: "3003",
          color_name: "red",
          position: { x: leg.x, y: leg.y, z },
          feature: "leg",
          step: course === "lower" ? 2 : 3,
        }),
      );
    }
  }
}

function addBody(bricks, brick) {
  const bodyPlatePositions = [
    { id: "rear-left", x: 2, y: 1 },
    { id: "rear-right", x: 2, y: 3 },
    { id: "front-left", x: 10, y: 1 },
    { id: "front-right", x: 10, y: 3 },
  ];

  for (const placement of bodyPlatePositions) {
    bricks.push(
      brick({
        id: `body-belly-${placement.id}`,
        part_id: "3034",
        color_name: "red",
        position: { x: placement.x, y: placement.y, z: 9 },
        rotation: 90,
        feature: "body",
        step: 4,
      }),
    );
  }

  for (const x of [2, 4, 6, 8, 10, 12, 14, 16]) {
    for (const y of [1, 3]) {
      bricks.push(
        brick({
          id: `body-core-${x}-${y}`,
          part_id: "3003",
          color_name: "red",
          position: { x, y, z: 10 },
          feature: "body",
          step: 5,
        }),
      );
    }
  }

  for (const placement of bodyPlatePositions) {
    bricks.push(
      brick({
        id: `body-back-${placement.id}`,
        part_id: "3034",
        color_name: "red",
        position: { x: placement.x, y: placement.y, z: 13 },
        rotation: 90,
        feature: "body",
        step: 6,
      }),
    );
  }

  const bodyBridges = [
    { id: "left-rear-front", x: 9, y: 1, rotation: 90 },
    { id: "right-rear-front", x: 9, y: 4, rotation: 90 },
    { id: "rear-side-to-side", x: 5, y: 2, rotation: 0 },
    { id: "front-side-to-side", x: 13, y: 2, rotation: 0 },
  ];

  for (const bridge of bodyBridges) {
    bricks.push(
      brick({
        id: `body-bridge-${bridge.id}`,
        part_id: "3023",
        color_name: "red",
        position: { x: bridge.x, y: bridge.y, z: 14 },
        rotation: bridge.rotation,
        feature: "body",
        step: 7,
      }),
    );
  }
}

function addNeckHeadAndMuzzle(bricks, brick) {
  for (const segment of [
    { id: "lower", x: 15, z: 14, step: 8, feature: "neck" },
    { id: "upper", x: 16, z: 17, step: 9, feature: "neck" },
    { id: "head", x: 17, z: 20, step: 10, feature: "head" },
  ]) {
    bricks.push(
      brick({
        id: `horse-${segment.id}`,
        part_id: "3003",
        color_name: "red",
        position: { x: segment.x, y: 2, z: segment.z },
        feature: segment.feature,
        step: segment.step,
      }),
    );
  }

  for (const y of [2, 3]) {
    bricks.push(
      brick({
        id: `muzzle-${y}`,
        part_id: "3023",
        color_name: "red",
        position: { x: 18, y, z: 23 },
        rotation: 90,
        feature: "muzzle",
        step: 11,
      }),
    );
  }

  for (const y of [2, 3]) {
    bricks.push(
      brick({
        id: `ear-${y}`,
        part_id: "3005",
        color_name: "black",
        position: { x: 17, y, z: 23 },
        feature: "ear",
        step: 12,
      }),
    );
  }
}

function addManeAndTail(bricks, brick) {
  const manePlacements = [
    { id: "withers-left", x: 14, y: 2, z: 14 },
    { id: "withers-right", x: 14, y: 3, z: 14 },
    { id: "lower-neck-left", x: 15, y: 2, z: 17 },
    { id: "lower-neck-right", x: 15, y: 3, z: 17 },
    { id: "upper-neck-left", x: 16, y: 2, z: 20 },
    { id: "upper-neck-right", x: 16, y: 3, z: 20 },
  ];

  for (const placement of manePlacements) {
    bricks.push(
      brick({
        id: `mane-${placement.id}`,
        part_id: "3005",
        color_name: "black",
        position: { x: placement.x, y: placement.y, z: placement.z },
        feature: "mane",
        step: 13,
      }),
    );
  }

  bricks.push(
    brick({
      id: "tail-raised",
      part_id: "3020",
      color_name: "black",
      position: { x: -1, y: 2, z: 14 },
      rotation: 90,
      feature: "tail",
      step: 14,
    }),
  );

  for (const [x, y] of [
    [-1, 2],
    [-1, 3],
    [0, 2],
    [0, 3],
  ]) {
    bricks.push(
      brick({
        id: `tail-tuft-${x}-${y}`,
        part_id: "3005",
        color_name: "black",
        position: { x, y, z: 15 },
        feature: "tail",
        step: 15,
      }),
    );
  }
}

/**
 * Deterministic 3D horse using only randomInventoryV2.
 *
 * @param {import("../types.js").Inventory} inventory
 * @returns {import("../types.js").GeneratedModel}
 */
export function buildHorseModel(inventory = randomInventoryV2) {
  const bricks = [];
  const brick = createBrickFactory(inventory);

  addLegsAndHooves(bricks, brick);
  addBody(bricks, brick);
  addNeckHeadAndMuzzle(bricks, brick);
  addManeAndTail(bricks, brick);

  return {
    model_name: "Inventory-Constrained Brown Horse",
    prompt: "Build a brown horse in 3D with a head, body, four legs with hooves, a tail, and a mane. Do not add eyes if space is limited.",
    piece_count: bricks.length,
    dimensions: dimensionsFor(bricks),
    created_from_inventory_id: inventory.inventory_id,
    generator_version: "fixture-horse-random-v2-62",
    bricks,
    notes: [
      "Uses only randomInventoryV2 pieces; that inventory has no brown pieces, so red is used as the closest warm chestnut body color.",
      "The model has four separated legs, eight black hoof blocks, a long body, raised neck, forward head and muzzle, black mane, black tail, and no eyes.",
      "The paired front and rear legs make the horse read from front and back, while the long body, head, neck, mane, and tail preserve the side silhouettes.",
      "Small top body bridges connect the left/right and front/rear body plates so the complete horse validates as one supported component.",
    ],
  };
}
