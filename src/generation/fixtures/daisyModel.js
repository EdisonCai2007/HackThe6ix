import { getPartDimensions } from "../partCatalog.js";
import { daisyInventory } from "./daisyInventory.js";

function piece({
  id,
  part_id,
  label,
  color_id,
  color_name,
  position,
  rotation = 0,
  feature,
  step,
}) {
  return {
    id,
    part_id,
    ldraw_id: `${part_id}.dat`,
    label,
    color_id,
    color_name,
    position,
    rotation,
    feature,
    step,
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

function green(item) {
  return piece({ color_id: "2", color_name: "green", ...item });
}

function white(item) {
  return piece({
    color_id: "15",
    color_name: "white",
    feature: "petal",
    ...item,
  });
}

function yellow(item) {
  return piece({
    color_id: "14",
    color_name: "yellow",
    feature: "flower-center",
    ...item,
  });
}

const greenLayer = [
  ["support-north-left", "3001", "2x4 brick", 6, 0, 90, "flower-support"],
  ["support-north-right", "3001", "2x4 brick", 10, 0, 90, "flower-support"],
  ["support-north-center", "3001", "2x4 brick", 8, 2, 90, "flower-support"],
  ["support-west-outer", "3001", "2x4 brick", 4, 4, 0, "flower-support"],
  ["support-west-upper", "3003", "2x2 brick", 6, 4, 0, "flower-support"],
  ["support-west-lower", "3003", "2x2 brick", 6, 6, 0, "flower-support"],
  ["support-center-upper", "3001", "2x4 brick", 8, 4, 90, "flower-support"],
  ["support-center-lower", "3001", "2x4 brick", 8, 6, 90, "flower-support"],
  ["support-east-upper", "3003", "2x2 brick", 12, 4, 0, "flower-support"],
  ["support-east-lower", "3003", "2x2 brick", 12, 6, 0, "flower-support"],
  ["support-east-outer", "3001", "2x4 brick", 14, 4, 0, "flower-support"],
  ["support-south-center", "3001", "2x4 brick", 8, 8, 90, "flower-support"],
  ["support-south-left", "3001", "2x4 brick", 6, 10, 90, "flower-support"],
  ["support-south-right", "3001", "2x4 brick", 10, 10, 90, "flower-support"],
  ["support-diagonal-nw", "3004", "1x2 brick", 6, 2, 90, "flower-support"],
  ["support-diagonal-ne", "3004", "1x2 brick", 12, 2, 90, "flower-support"],
  ["support-diagonal-sw", "3004", "1x2 brick", 6, 9, 90, "flower-support"],
  ["support-diagonal-se", "3004", "1x2 brick", 12, 9, 90, "flower-support"],
  ["support-west-tip", "3004", "1x2 brick", 5, 2, 0, "flower-support"],
  ["support-east-tip", "3004", "1x2 brick", 14, 2, 0, "flower-support"],
  ["stem-upper-left", "3001", "2x4 brick", 8, 12, 0, "stem"],
  ["stem-upper-right", "3001", "2x4 brick", 10, 12, 0, "stem"],
  ["stem-lower-left", "3001", "2x4 brick", 8, 16, 0, "stem"],
  ["stem-lower-right", "3001", "2x4 brick", 10, 16, 0, "stem"],
  ["leaf-left", "3001", "2x4 brick", 4, 14, 90, "leaf-left"],
  ["leaf-right", "3001", "2x4 brick", 12, 14, 90, "leaf-right"],
];

const petals = [
  ["petal-north-left", "3001", "2x4 brick", 6, 0, 90],
  ["petal-north-right", "3001", "2x4 brick", 10, 0, 90],
  ["petal-north-inner-left", "3003", "2x2 brick", 8, 2, 0],
  ["petal-north-inner-right", "3003", "2x2 brick", 10, 2, 0],
  ["petal-west-outer", "3001", "2x4 brick", 4, 4, 0],
  ["petal-west-upper", "3003", "2x2 brick", 6, 4, 0],
  ["petal-west-lower", "3003", "2x2 brick", 6, 6, 0],
  ["petal-east-upper", "3003", "2x2 brick", 12, 4, 0],
  ["petal-east-lower", "3003", "2x2 brick", 12, 6, 0],
  ["petal-east-outer", "3001", "2x4 brick", 14, 4, 0],
  ["petal-south-inner-left", "3003", "2x2 brick", 8, 8, 0],
  ["petal-south-inner-right", "3003", "2x2 brick", 10, 8, 0],
  ["petal-south-left", "3001", "2x4 brick", 6, 10, 90],
  ["petal-south-right", "3001", "2x4 brick", 10, 10, 90],
  ["petal-diagonal-nw", "3004", "1x2 brick", 6, 2, 90],
  ["petal-diagonal-ne", "3004", "1x2 brick", 12, 2, 90],
  ["petal-diagonal-sw", "3004", "1x2 brick", 6, 9, 90],
  ["petal-diagonal-se", "3004", "1x2 brick", 12, 9, 90],
  ["petal-west-tip", "3004", "1x2 brick", 5, 2, 0],
  ["petal-east-tip", "3004", "1x2 brick", 14, 2, 0],
];

/**
 * Deterministic 50-piece daisy with green stem, two leaves, white petals, and yellow center.
 *
 * @param {import("../types.js").Inventory} inventory
 * @returns {import("../types.js").GeneratedModel}
 */
export function buildDaisyModel(inventory = daisyInventory) {
  const bricks = [];

  for (const [id, part_id, label, x, y, rotation, feature] of greenLayer) {
    bricks.push(
      green({
        id,
        part_id,
        label,
        position: { x, y, z: 0 },
        rotation,
        feature,
        step: 1,
      }),
    );
  }

  for (const [id, part_id, label, x, y, rotation] of petals) {
    bricks.push(
      white({
        id,
        part_id,
        label,
        position: { x, y, z: 3 },
        rotation,
        step: 2,
      }),
    );
  }

  for (const [id, x, y] of [
    ["center-nw", 8, 4],
    ["center-ne", 10, 4],
    ["center-sw", 8, 6],
    ["center-se", 10, 6],
  ]) {
    bricks.push(
      yellow({
        id,
        part_id: "3003",
        label: "2x2 brick",
        position: { x, y, z: 3 },
        step: 3,
      }),
    );
  }

  return {
    model_name: "Daisy",
    prompt: "build me a daisy with a green stem, two leaves, and the flower",
    piece_count: bricks.length,
    dimensions: dimensionsFor(bricks),
    created_from_inventory_id: inventory.inventory_id,
    generator_version: "mvp-daisy",
    bricks,
    notes: [
      "Low relief daisy built from rectangular MVP parts.",
      "Green ground layer acts as stem, leaves, and support for the raised flower head.",
      "Raised top layer uses white petals around a yellow center.",
    ],
  };
}
