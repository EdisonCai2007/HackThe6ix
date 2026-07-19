import { getPartDimensions } from "../partCatalog.js";
import { sandcastleInventory } from "./sandcastleInventory.js";

function brick({
  id,
  part_id,
  label,
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
    color_id: "19",
    color_name: "tan",
    position,
    rotation,
    feature,
    step,
  };
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

function addPerimeterLayer(bricks, z, step) {
  const towerPositions = [
    [0, 0],
    [10, 0],
    [0, 10],
    [10, 10],
  ];
  const horizontalWallPositions = [
    [2, 0],
    [6, 0],
    [2, 10],
    [6, 10],
  ];
  const verticalWallPositions = [
    [0, 2],
    [0, 6],
    [10, 2],
    [10, 6],
  ];

  for (const [index, [x, y]] of towerPositions.entries()) {
    bricks.push(
      brick({
        id: `tower-${z}-${index}`,
        part_id: "3003",
        label: "2x2 brick",
        position: { x, y, z },
        feature: "tower",
        step,
      }),
    );
  }

  for (const [index, [x, y]] of horizontalWallPositions.entries()) {
    bricks.push(
      brick({
        id: `wall-horizontal-${z}-${index}`,
        part_id: "3001",
        label: "2x4 brick",
        position: { x, y, z },
        rotation: 90,
        feature: "wall",
        step,
      }),
    );
  }

  for (const [index, [x, y]] of verticalWallPositions.entries()) {
    bricks.push(
      brick({
        id: `wall-vertical-${z}-${index}`,
        part_id: "3001",
        label: "2x4 brick",
        position: { x, y, z },
        feature: "wall",
        step,
      }),
    );
  }
}

function addUpperTowers(bricks) {
  const towerPositions = [
    [0, 0],
    [10, 0],
    [0, 10],
    [10, 10],
  ];

  for (const z of [6, 9]) {
    for (const [index, [x, y]] of towerPositions.entries()) {
      bricks.push(
        brick({
          id: `tower-${z}-${index}`,
          part_id: "3003",
          label: "2x2 brick",
          position: { x, y, z },
          feature: "tower",
          step: z / 3 + 1,
        }),
      );
    }
  }
}

function addWallCrenellations(bricks) {
  const crenellations = [
    { x: 2, y: 0, rotation: 90 },
    { x: 5, y: 0, rotation: 90 },
    { x: 8, y: 0, rotation: 90 },
    { x: 2, y: 11, rotation: 90 },
    { x: 5, y: 11, rotation: 90 },
    { x: 8, y: 11, rotation: 90 },
    { x: 0, y: 3, rotation: 0 },
    { x: 0, y: 7, rotation: 0 },
    { x: 11, y: 3, rotation: 0 },
    { x: 11, y: 7, rotation: 0 },
  ];

  for (const [index, crenellation] of crenellations.entries()) {
    bricks.push(
      brick({
        id: `wall-crenellation-${index}`,
        part_id: "3004",
        label: "1x2 brick",
        position: {
          x: crenellation.x,
          y: crenellation.y,
          z: 6,
        },
        rotation: crenellation.rotation,
        feature: "wall-crenellation",
        step: 5,
      }),
    );
  }
}

function addTowerBattlements(bricks) {
  const battlements = [
    [0, 0],
    [1, 1],
    [10, 0],
    [11, 1],
    [0, 10],
    [1, 11],
    [10, 10],
    [11, 11],
  ];

  for (const [index, [x, y]] of battlements.entries()) {
    bricks.push(
      brick({
        id: `tower-battlement-${index}`,
        part_id: "3005",
        label: "1x1 brick",
        position: { x, y, z: 12 },
        feature: "tower-battlement",
        step: 6,
      }),
    );
  }
}

/**
 * Deterministic 50-piece large-scale sandcastle with four corner towers.
 *
 * @param {import("../types.js").Inventory} inventory
 * @returns {import("../types.js").GeneratedModel}
 */
export function buildSandcastleModel(inventory = sandcastleInventory) {
  const bricks = [];

  addPerimeterLayer(bricks, 0, 1);
  addPerimeterLayer(bricks, 3, 2);
  addUpperTowers(bricks);
  addWallCrenellations(bricks);
  addTowerBattlements(bricks);

  return {
    model_name: "Sandcastle Keep",
    prompt: "build me a lego sandcastle with a wall and 4 towers at each corner",
    piece_count: bricks.length,
    dimensions: dimensionsFor(bricks),
    created_from_inventory_id: inventory.inventory_id,
    generator_version: "mvp-sandcastle",
    bricks,
    notes: [
      "Built as a square keep with a connected perimeter wall.",
      "Four taller corner towers anchor the castle footprint.",
      "Crenellations use small rectangular bricks to keep the MVP part set simple.",
    ],
  };
}
