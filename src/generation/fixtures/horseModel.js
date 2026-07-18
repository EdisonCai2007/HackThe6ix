import { getPartDimensions } from "../partCatalog.js";
import { horseInventory } from "./horseInventory.js";

const PART_LABELS = {
  3001: "2x4 brick",
  3004: "1x2 brick",
  3005: "1x1 brick",
};

function brick({
  id,
  part_id,
  position,
  rotation = 0,
  feature,
  step,
  color_id = "6",
  color_name = "brown",
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

function brown(options) {
  return brick(options);
}

function black(options) {
  return brick({
    ...options,
    color_id: "0",
    color_name: "black",
  });
}

function dimensionsFor(bricks) {
  const extents = bricks.map((placedBrick) => {
    const dimensions = getPartDimensions(
      placedBrick.part_id,
      placedBrick.rotation,
    );

    return {
      minX: placedBrick.position.x,
      maxX: placedBrick.position.x + dimensions.width,
      minY: placedBrick.position.y,
      maxY: placedBrick.position.y + dimensions.depth,
      minZ: placedBrick.position.z,
      maxZ: placedBrick.position.z + dimensions.height,
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

function buildHorseBricks() {
  return [
    black({
      id: "rear-hoof",
      part_id: "3005",
      position: { x: 1, y: 0, z: 0 },
      feature: "hoof",
      step: 1,
    }),
    black({
      id: "front-hoof",
      part_id: "3005",
      position: { x: 4, y: 0, z: 0 },
      feature: "hoof",
      step: 1,
    }),
    brown({
      id: "rear-leg",
      part_id: "3004",
      position: { x: 1, y: 0, z: 3 },
      feature: "leg",
      step: 2,
    }),
    brown({
      id: "front-leg",
      part_id: "3004",
      position: { x: 4, y: 0, z: 3 },
      feature: "leg",
      step: 2,
    }),
    brown({
      id: "body",
      part_id: "3001",
      position: { x: 1, y: 0, z: 6 },
      rotation: 90,
      feature: "body",
      step: 3,
    }),
    black({
      id: "tail",
      part_id: "3004",
      position: { x: 0, y: 0, z: 9 },
      rotation: 90,
      feature: "tail",
      step: 4,
    }),
    brown({
      id: "neck",
      part_id: "3004",
      position: { x: 4, y: 0, z: 9 },
      feature: "neck",
      step: 5,
    }),
    brown({
      id: "head",
      part_id: "3004",
      position: { x: 4, y: 0, z: 12 },
      rotation: 90,
      feature: "head",
      step: 6,
    }),
    black({
      id: "mane",
      part_id: "3005",
      position: { x: 4, y: 1, z: 12 },
      feature: "mane",
      step: 7,
    }),
    brown({
      id: "ear",
      part_id: "3005",
      position: { x: 5, y: 0, z: 15 },
      feature: "head",
      step: 8,
    }),
  ];
}

/**
 * Deterministic 10-piece brown horse in a 2D side profile.
 *
 * @param {import("../types.js").Inventory} inventory
 * @returns {import("../types.js").GeneratedModel}
 */
export function buildHorseModel(inventory = horseInventory) {
  const bricks = buildHorseBricks();

  return {
    model_name: "10-Piece Brown Horse",
    prompt: "build a 10-piece brown lego horse side profile with head, body, legs, hooves, mane, and tail",
    piece_count: bricks.length,
    dimensions: dimensionsFor(bricks),
    created_from_inventory_id: inventory.inventory_id,
    generator_version: "mvp-horse-10-piece",
    bricks,
    notes: [
      "Uses exactly 10 supported MVP bricks.",
      "Built as a 2D side-profile horse standing on two visible legs.",
      "Brown bricks form the body, legs, neck, head, and ear.",
      "Black pieces mark the hooves, mane, and tail.",
    ],
  };
}
