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
        `Mailbox requires ${color_name} part ${part_id}, which is not in inventory ${inventory.inventory_id}.`,
      );
    }

    const nextUsedCount = (used.get(key) ?? 0) + 1;

    if (nextUsedCount > item.count) {
      throw new Error(
        `Mailbox requires ${nextUsedCount} ${color_name} ${item.label}s, but inventory ${inventory.inventory_id} only has ${item.count}.`,
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

function addBase(bricks, brick) {
  for (const x of [0, 4]) {
    bricks.push(
      brick({
        id: `base-plate-${x}`,
        part_id: "3035",
        color_name: "black",
        position: { x, y: 0, z: 0 },
        feature: "base",
        step: 1,
      }),
    );
  }

  bricks.push(
    brick({
      id: "base-center-pad",
      part_id: "3031",
      color_name: "black",
      position: { x: 2, y: 2, z: 1 },
      feature: "base",
      step: 2,
    }),
  );

  for (const [id, placement] of [
    ["front", { x: 2, y: 0, rotation: 90 }],
    ["back", { x: 2, y: 6, rotation: 90 }],
    ["left", { x: 0, y: 2, rotation: 0 }],
    ["right", { x: 6, y: 2, rotation: 0 }],
  ]) {
    bricks.push(
      brick({
        id: `base-${id}-pad`,
        part_id: "3020",
        color_name: "black",
        position: { x: placement.x, y: placement.y, z: 1 },
        rotation: placement.rotation,
        feature: "base",
        step: 2,
      }),
    );
  }
}

function addPost(bricks, brick) {
  for (let course = 0; course < 3; course += 1) {
    const z = 2 + course * 3;

    for (const x of [3, 4]) {
      for (const y of [3, 4]) {
        bricks.push(
          brick({
            id: `post-${course + 1}-${x}-${y}`,
            part_id: "3005",
            color_name: "black",
            position: { x, y, z },
            feature: "post",
            step: course + 3,
          }),
        );
      }
    }
  }

  bricks.push(
    brick({
      id: "post-mailbox-cap",
      part_id: "3031",
      color_name: "black",
      position: { x: 2, y: 1, z: 11 },
      feature: "post",
      step: 6,
    }),
  );
}

function addMailCompartment(bricks, brick) {
  for (const [id, y] of [["front", 1], ["back", 3]]) {
    bricks.push(
      brick({
        id: `mailbox-floor-${id}`,
        part_id: "3034",
        color_name: "red",
        position: { x: 0, y, z: 12 },
        rotation: 90,
        feature: "mail-compartment",
        step: 7,
      }),
    );
  }

  for (const [course, z] of [[1, 13], [2, 16]]) {
    for (const x of [0, 2, 4, 6]) {
      for (const y of [1, 3]) {
        bricks.push(
          brick({
            id: `mailbox-body-${course}-${x}-${y}`,
            part_id: "3003",
            color_name: "red",
            position: { x, y, z },
            feature: "mail-compartment",
            step: course + 7,
          }),
        );
      }
    }
  }

  for (const [id, y] of [["front", 1], ["back", 3]]) {
    bricks.push(
      brick({
        id: `mailbox-top-${id}`,
        part_id: "3034",
        color_name: "red",
        position: { x: 0, y, z: 19 },
        rotation: 90,
        feature: "mail-compartment",
        step: 10,
      }),
    );
  }
}

function addRaisedLid(bricks, brick) {
  for (const y of [2, 3]) {
    for (const x of [1, 3, 5]) {
      bricks.push(
        brick({
          id: `raised-lid-${x}-${y}`,
          part_id: "3023",
          color_name: "red",
          position: { x, y, z: 20 },
          rotation: 90,
          feature: "raised-lid",
          step: 11,
        }),
      );
    }
  }
}

function addFrontLabel(bricks, brick) {
  for (const x of [2, 4]) {
    bricks.push(
      brick({
        id: `front-label-${x}`,
        part_id: "3023",
        color_name: "white",
        position: { x, y: 1, z: 20 },
        rotation: 90,
        feature: "front-label",
        step: 12,
      }),
    );
  }
}

/**
 * Deterministic compact mailbox using only randomInventoryV2.
 *
 * @param {import("../types.js").Inventory} inventory
 * @returns {import("../types.js").GeneratedModel}
 */
export function buildMailboxModel(inventory = randomInventoryV2) {
  const bricks = [];
  const brick = createBrickFactory(inventory);

  addBase(bricks, brick);
  addPost(bricks, brick);
  addMailCompartment(bricks, brick);
  addRaisedLid(bricks, brick);
  addFrontLabel(bricks, brick);

  return {
    model_name: "Freestanding Mailbox",
    prompt: "Build a compact freestanding mailbox with a red mail box, raised red lid, black post/base, and white front label.",
    piece_count: bricks.length,
    dimensions: dimensionsFor(bricks),
    created_from_inventory_id: inventory.inventory_id,
    generator_version: "fixture-mailbox-random-v2-48",
    bricks,
    notes: [
      "Uses only pieces in randomInventoryV2 while keeping red as the dominant color.",
      "The mailbox has an eight-stud red horizontal compartment, one-plate raised red lid, black two-by-two post, and black eight-by-eight base.",
      "Two white flat plates form a small front label without introducing any white pieces elsewhere.",
      "Every raised piece has direct support below it, and the complete freestanding build is one connected component.",
    ],
  };
}
