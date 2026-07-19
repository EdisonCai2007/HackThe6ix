import { getPartDimensions } from "../partCatalog.js";
import { randomBuildInventory } from "./randomBuildInventory.js";

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
        `Lighthouse requires ${color_name} part ${part_id}, which is not in inventory ${inventory.inventory_id}.`,
      );
    }

    const nextUsedCount = (used.get(key) ?? 0) + 1;

    if (nextUsedCount > item.count) {
      throw new Error(
        `Lighthouse requires ${nextUsedCount} ${color_name} ${item.label}s, but inventory ${inventory.inventory_id} only has ${item.count}.`,
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

function addWater(bricks, brick) {
  for (let row = 0; row < 2; row += 1) {
    for (let column = 0; column < 5; column += 1) {
      bricks.push(
        brick({
          id: `water-base-${row}-${column}`,
          part_id: "3795",
          color_name: "blue",
          position: { x: column * 2, y: row * 6, z: 0 },
          feature: "water",
          step: 1,
        }),
      );
    }
  }

  const waterTies = [
    { id: "south-west", x: 1, y: 2, rotation: 90 },
    { id: "south-east", x: 5, y: 2, rotation: 90 },
    { id: "north-west", x: 1, y: 8, rotation: 90 },
    { id: "north-east", x: 5, y: 8, rotation: 90 },
    { id: "center", x: 4, y: 4, rotation: 0 },
  ];

  for (const tie of waterTies) {
    bricks.push(
      brick({
        id: `water-tie-${tie.id}`,
        part_id: "3020",
        color_name: "blue",
        position: { x: tie.x, y: tie.y, z: 1 },
        rotation: tie.rotation,
        feature: "water",
        step: 2,
      }),
    );
  }
}

function addIsland(bricks, brick) {
  for (const [index, [x, y]] of [
    [1, 0],
    [5, 0],
    [1, 6],
    [5, 6],
  ].entries()) {
    bricks.push(
      brick({
        id: `island-rock-plate-${index}`,
        part_id: "3032",
        color_name: "brown",
        position: { x, y, z: 2 },
        feature: "island-rock",
        step: 3,
      }),
    );
  }

  for (const z of [3, 4]) {
    for (const [index, x] of [1, 5].entries()) {
      bricks.push(
        brick({
          id: `island-grass-plate-${z}-${index}`,
          part_id: "3035",
          color_name: "green",
          position: { x, y: 2, z },
          feature: "island-grass",
          step: z + 1,
        }),
      );
    }
  }

  for (const y of [2, 6]) {
    for (const x of [1, 3, 5, 7]) {
      bricks.push(
        brick({
          id: `island-grass-brick-${x}-${y}`,
          part_id: "3001",
          color_name: "green",
          position: { x, y, z: 5 },
          feature: "island-grass",
          step: 6,
        }),
      );
    }
  }

  for (const y of [4, 6]) {
    for (const x of [3, 5]) {
      bricks.push(
        brick({
          id: `tower-foundation-${x}-${y}`,
          part_id: "3003",
          color_name: "brown",
          position: { x, y, z: 8 },
          feature: "tower-foundation",
          step: 7,
        }),
      );
    }
  }
}

function addWhiteTowerCourse(bricks, brick, z, course) {
  const placements = [
    { id: "south-west", x: 3, y: 4, rotation: 90 },
    { id: "south-east", x: 5, y: 4, rotation: 90 },
    { id: "north-west", x: 3, y: 7, rotation: 90 },
    { id: "north-east", x: 5, y: 7, rotation: 90 },
    { id: "west", x: 3, y: 5, rotation: 0 },
    { id: "east", x: 6, y: 5, rotation: 0 },
  ];

  for (const placement of placements) {
    bricks.push(
      brick({
        id: `tower-white-${course}-${placement.id}`,
        part_id: "3004",
        color_name: "white",
        position: { x: placement.x, y: placement.y, z },
        rotation: placement.rotation,
        feature: "tower-white",
        step: course + 7,
      }),
    );
  }
}

function addRedTowerCourse(bricks, brick, z, course) {
  const placements = [
    { id: "south", x: 3, y: 4, rotation: 90 },
    { id: "east", x: 6, y: 4, rotation: 0 },
    { id: "north", x: 4, y: 7, rotation: 90 },
    { id: "west", x: 3, y: 5, rotation: 0 },
  ];

  for (const placement of placements) {
    bricks.push(
      brick({
        id: `tower-red-${course}-${placement.id}`,
        part_id: "3622",
        color_name: "red",
        position: { x: placement.x, y: placement.y, z },
        rotation: placement.rotation,
        feature: "tower-red",
        step: course + 7,
      }),
    );
  }
}

function addTower(bricks, brick) {
  for (let course = 0; course < 8; course += 1) {
    const z = 11 + course * 3;

    if (course % 2 === 0) {
      addWhiteTowerCourse(bricks, brick, z, course + 1);
    } else {
      addRedTowerCourse(bricks, brick, z, course + 1);
    }
  }
}

function addBeaconAndCap(bricks, brick) {
  for (const y of [4, 5, 6, 7]) {
    bricks.push(
      brick({
        id: `observation-deck-${y}`,
        part_id: "3666",
        color_name: "white",
        position: { x: 2, y, z: 35 },
        rotation: 90,
        feature: "observation-deck",
        step: 16,
      }),
      brick({
        id: `beacon-${y}`,
        part_id: "3009",
        color_name: "yellow",
        position: { x: 2, y, z: 36 },
        rotation: 90,
        feature: "beacon",
        step: 17,
      }),
    );
  }

  for (const y of [4, 5, 6, 7]) {
    for (const x of [2, 5]) {
      bricks.push(
        brick({
          id: `cap-roof-${x}-${y}`,
          part_id: "3623",
          color_name: "black",
          position: { x, y, z: 39 },
          rotation: 90,
          feature: "cap",
          step: 18,
        }),
      );
    }
  }

  for (const y of [5, 6]) {
    for (const x of [3, 4, 5, 6]) {
      bricks.push(
        brick({
          id: `cap-crown-${x}-${y}`,
          part_id: "3005",
          color_name: "black",
          position: { x, y, z: 40 },
          feature: "cap",
          step: 19,
        }),
      );
    }
  }

  bricks.push(
    brick({
      id: "cap-finial",
      part_id: "3005",
      color_name: "black",
      position: { x: 4, y: 5, z: 43 },
      feature: "cap",
      step: 20,
    }),
  );
}

/**
 * Deterministic 100-piece lighthouse on a layered island and water base.
 *
 * @param {import("../types.js").Inventory} inventory
 * @returns {import("../types.js").GeneratedModel}
 */
export function buildLighthouseModel(inventory = randomBuildInventory) {
  const bricks = [];
  const brick = createBrickFactory(inventory);

  addWater(bricks, brick);
  addIsland(bricks, brick);
  addTower(bricks, brick);
  addBeaconAndCap(bricks, brick);

  return {
    model_name: "Lighthouse Island",
    prompt: "build a lighthouse on an island with a white and red stacked tower, yellow beacon, black cap, blue water, and green and brown terrain",
    piece_count: bricks.length,
    dimensions: dimensionsFor(bricks),
    created_from_inventory_id: inventory.inventory_id,
    generator_version: "fixture-lighthouse-100",
    bricks,
    notes: [
      "Uses exactly 100 pieces from the random build assortment.",
      "A tied two-layer water base supports a brown rock shelf and raised green island.",
      "Eight alternating white and red masonry courses form a tall hollow lighthouse tower.",
      "A yellow beacon chamber and stepped black cap complete the silhouette.",
    ],
  };
}
