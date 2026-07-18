import { getPartDimensions } from "../partCatalog.js";
import { duckInventory } from "./duckInventory.js";

const PART_LABELS = {
  3001: "2x4 brick",
  3003: "2x2 brick",
  3004: "1x2 brick",
  3005: "1x1 brick",
  3020: "2x4 plate",
};

function brick({
  id,
  part_id,
  position,
  rotation = 0,
  feature,
  step,
  color_id = "14",
  color_name = "yellow",
}) {
  return {
    id,
    part_id,
    ldraw_id: `${part_id}.dat`,
    label: PART_LABELS[part_id],
    color_id,
    color_name,
    position,
    rotation,
    feature,
    step,
  };
}

function yellow(options) {
  return brick(options);
}

function orange(options) {
  return brick({
    ...options,
    color_id: "25",
    color_name: "orange",
  });
}

function black(options) {
  return brick({
    ...options,
    color_id: "0",
    color_name: "black",
  });
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

/**
 * Deterministic MVP builder for a recognizable 15-piece duck.
 *
 * @param {import("../types.js").Inventory} inventory
 * @returns {import("../types.js").GeneratedModel}
 */
export function buildSmallDuckModel(inventory = duckInventory) {
  const bricks = [
    yellow({
      id: "body-plate-1",
      part_id: "3020",
      position: { x: 0, y: 0, z: 0 },
      feature: "body",
      step: 1,
    }),
    yellow({
      id: "body-plate-2",
      part_id: "3020",
      position: { x: 2, y: 0, z: 0 },
      feature: "body",
      step: 1,
    }),
    yellow({
      id: "lower-body-left",
      part_id: "3001",
      position: { x: 0, y: 0, z: 1 },
      feature: "body",
      step: 2,
    }),
    yellow({
      id: "lower-body-right",
      part_id: "3001",
      position: { x: 2, y: 0, z: 1 },
      feature: "body",
      step: 2,
    }),
    yellow({
      id: "upper-body-left",
      part_id: "3003",
      position: { x: 0, y: 1, z: 4 },
      feature: "body",
      step: 3,
    }),
    yellow({
      id: "upper-body-right",
      part_id: "3003",
      position: { x: 2, y: 1, z: 4 },
      feature: "body",
      step: 3,
    }),
    yellow({
      id: "head",
      part_id: "3003",
      position: { x: 1, y: 0, z: 7 },
      feature: "head",
      step: 4,
    }),
    yellow({
      id: "left-wing",
      part_id: "3003",
      position: { x: -1, y: 1, z: 7 },
      feature: "wing",
      step: 4,
    }),
    yellow({
      id: "right-wing",
      part_id: "3003",
      position: { x: 3, y: 1, z: 7 },
      feature: "wing",
      step: 4,
    }),
    yellow({
      id: "tail-block",
      part_id: "3003",
      position: { x: 1, y: 2, z: 7 },
      feature: "tail",
      step: 4,
    }),
    orange({
      id: "beak-left",
      part_id: "3004",
      position: { x: 1, y: -1, z: 10 },
      feature: "beak",
      step: 5,
    }),
    black({
      id: "eye-left",
      part_id: "3005",
      position: { x: 1, y: 1, z: 10 },
      feature: "eye",
      step: 5,
    }),
    black({
      id: "eye-right",
      part_id: "3005",
      position: { x: 2, y: 1, z: 10 },
      feature: "eye",
      step: 5,
    }),
    yellow({
      id: "tail-feather",
      part_id: "3020",
      position: { x: 1, y: 2, z: 10 },
      feature: "tail",
      step: 5,
    }),
    orange({
      id: "beak-right",
      part_id: "3004",
      position: { x: 2, y: -1, z: 10 },
      feature: "beak",
      step: 5,
    }),
  ];

  return {
    model_name: "15 Piece Duck",
    prompt: "build me a duck with 15 lego pieces",
    piece_count: bricks.length,
    dimensions: dimensionsFor(bricks),
    created_from_inventory_id: inventory.inventory_id,
    generator_version: "mvp-duck-15",
    bricks,
    notes: [
      "Uses the full 15-piece duck-demo inventory budget for a more recognizable silhouette.",
      "The duck has a wide yellow body, raised head, a two-piece orange beak, black eyes, side wings, and a rear tail feather.",
      "The layout is deterministic so the validator can check inventory, overlap, support, and one-object connectivity before LDraw export.",
    ],
  };
}
