import { fixedDemoInventory } from "./fixedDemoInventory.js";
import {
  completeShowcaseModel,
  createShowcaseBrickFactory,
} from "./showcaseModelHelpers.js";

function addOceanAndIsland(bricks, brick) {
  for (const x of [0, 6]) {
    bricks.push(brick({
      id: `ocean-base-${x}`,
      part_id: "3033",
      color_name: "blue",
      position: { x, y: 0, z: 0 },
      feature: "water",
      step: 1,
    }));
  }

  bricks.push(brick({
    id: "island-spine",
    part_id: "3029",
    color_name: "black",
    position: { x: 0, y: 3, z: 1 },
    rotation: 90,
    feature: "island-rock",
    step: 2,
  }));

  const waves = [
    ["north-1", "3710", 1, 1, 90],
    ["north-2", "3710", 6, 1, 90],
    ["south-1", "3710", 1, 8, 90],
    ["south-2", "3710", 6, 8, 90],
    ["north-cap-1", "3023", 0, 0, 0],
    ["north-cap-2", "3023", 11, 0, 0],
    ["south-cap-1", "3023", 0, 8, 0],
    ["south-cap-2", "3023", 10, 8, 0],
    ["foam-1", "3022", 2, 1, 0],
    ["foam-2", "3022", 6, 1, 0],
  ];

  for (const [id, partId, x, y, rotation] of waves) {
    bricks.push(brick({
      id: `water-${id}`,
      part_id: partId,
      color_name: "blue",
      position: { x, y, z: id.startsWith("foam") ? 2 : 1 },
      rotation,
      feature: "water",
      step: 2,
    }));
  }

  for (const y of [3, 5]) {
    for (const x of [0, 2, 4]) {
      bricks.push(brick({
        id: `tower-rock-${x}-${y}`,
        part_id: "3003",
        color_name: "dark gray",
        position: { x, y, z: 2 },
        feature: "island-rock",
        step: 3,
      }));
    }
  }

  for (const x of [6, 8]) {
    bricks.push(brick({
      id: `cottage-rock-${x}`,
      part_id: "3001",
      color_name: "dark gray",
      position: { x, y: 3, z: 2 },
      feature: "island-rock",
      step: 3,
    }));
  }

  for (const [index, [x, y, rotation]] of [
    [0, 1, 90],
    [4, 1, 90],
    [8, 1, 90],
    [0, 8, 90],
    [4, 8, 90],
    [8, 8, 90],
  ].entries()) {
    bricks.push(brick({
      id: `shore-rock-${index}`,
      part_id: "3004",
      color_name: "dark gray",
      position: { x, y, z: 2 },
      rotation,
      feature: "island-rock",
      step: 3,
    }));
  }
}

const TOWER_RING = Object.freeze([
  { id: "front-left", x: 1, y: 3, rotation: 90 },
  { id: "front-right", x: 3, y: 3, rotation: 90 },
  { id: "back-left", x: 1, y: 6, rotation: 90 },
  { id: "back-right", x: 3, y: 6, rotation: 90 },
  { id: "west", x: 1, y: 4, rotation: 0 },
  { id: "east", x: 4, y: 4, rotation: 0 },
]);

function addTower(bricks, brick) {
  for (let course = 0; course < 7; course += 1) {
    const colorName = course % 2 === 0 ? "white" : "red";

    for (const placement of TOWER_RING) {
      const isDoor = course === 0 && placement.id === "front-left";
      const isWindow = course === 2 && placement.id === "front-right";

      bricks.push(brick({
        id: `tower-${course}-${placement.id}`,
        part_id: "3004",
        color_name: isDoor ? "black" : isWindow ? "blue" : colorName,
        position: { x: placement.x, y: placement.y, z: 5 + course * 3 },
        rotation: placement.rotation,
        feature: isDoor
          ? "tower-door"
          : isWindow
            ? "tower-window"
            : colorName === "white"
              ? "tower-white"
              : "tower-red",
        step: 4 + course,
      }));
    }
  }
}

function addKeeperCottage(bricks, brick) {
  bricks.push(brick({
    id: "cottage-floor",
    part_id: "3032",
    color_name: "black",
    position: { x: 6, y: 3, z: 5 },
    feature: "keeper-cottage",
    step: 4,
  }));

  for (const [id, x, y, rotation] of [
    ["front", 6, 3, 90],
    ["back", 6, 8, 90],
    ["west", 6, 4, 0],
    ["east", 9, 4, 0],
  ]) {
    bricks.push(brick({
      id: `cottage-white-${id}`,
      part_id: "3010",
      color_name: "white",
      position: { x, y, z: 6 },
      rotation,
      feature: "keeper-cottage",
      step: 5,
    }));
  }

  const upperWalls = [
    ["door", "3004", "brown", 6, 3, 90],
    ["window", "3004", "blue", 8, 3, 90],
    ["back-left", "3004", "red", 6, 8, 90],
    ["back-right", "3004", "red", 8, 8, 90],
    ["west", "3010", "red", 6, 4, 0],
    ["east", "3010", "red", 9, 4, 0],
  ];

  for (const [id, partId, colorName, x, y, rotation] of upperWalls) {
    bricks.push(brick({
      id: `cottage-upper-${id}`,
      part_id: partId,
      color_name: colorName,
      position: { x, y, z: 9 },
      rotation,
      feature: "keeper-cottage",
      step: 6,
    }));
  }

  bricks.push(
    brick({
      id: "cottage-roof",
      part_id: "3032",
      color_name: "black",
      position: { x: 6, y: 3, z: 12 },
      feature: "cottage-roof",
      step: 7,
    }),
    brick({
      id: "cottage-chimney",
      part_id: "3004",
      color_name: "black",
      position: { x: 8, y: 6, z: 13 },
      feature: "cottage-roof",
      step: 8,
    }),
  );
}

function addLantern(bricks, brick) {
  bricks.push(brick({
    id: "balcony-deck",
    part_id: "3032",
    color_name: "white",
    position: { x: 1, y: 2, z: 26 },
    feature: "balcony",
    step: 11,
  }));

  for (const [index, [x, y]] of [
    [1, 2], [2, 2], [3, 2], [4, 2],
    [1, 7], [2, 7], [3, 7], [4, 7],
    [1, 2], [2, 2], [3, 2], [4, 2],
    [1, 7], [2, 7], [3, 7], [4, 7],
  ].entries()) {
    bricks.push(brick({
      id: `balcony-rail-${index}`,
      part_id: "3005",
      color_name: "red",
      position: { x, y, z: index < 8 ? 27 : 30 },
      feature: "balcony",
      step: 12,
    }));
  }

  bricks.push(brick({
    id: "beacon-core",
    part_id: "3022",
    color_name: "yellow",
    position: { x: 2, y: 4, z: 27 },
    feature: "beacon",
    step: 12,
  }));

  for (const placement of TOWER_RING) {
    bricks.push(brick({
      id: `lantern-window-${placement.id}`,
      part_id: "3004",
      color_name: placement.id === "west" || placement.id === "east" ? "yellow" : "blue",
      position: { x: placement.x, y: placement.y, z: 27 },
      rotation: placement.rotation,
      feature: "lantern-room",
      step: 12,
    }));
  }

  bricks.push(
    brick({
      id: "lantern-roof-deck",
      part_id: "3032",
      color_name: "black",
      position: { x: 1, y: 2, z: 33 },
      feature: "lantern-roof",
      step: 13,
    }),
    brick({
      id: "lantern-roof-left",
      part_id: "3020",
      color_name: "black",
      position: { x: 1, y: 3, z: 34 },
      feature: "lantern-roof",
      step: 14,
    }),
    brick({
      id: "lantern-roof-right",
      part_id: "3020",
      color_name: "black",
      position: { x: 3, y: 3, z: 34 },
      feature: "lantern-roof",
      step: 14,
    }),
    brick({
      id: "lantern-finial",
      part_id: "3005",
      color_name: "black",
      position: { x: 2, y: 4, z: 35 },
      feature: "lantern-roof",
      step: 15,
    }),
  );
}

export function buildShowcaseCoastalLighthouseModel(inventory = fixedDemoInventory) {
  const bricks = [];
  const brick = createShowcaseBrickFactory(inventory, "Coastal Beacon Lighthouse");

  addOceanAndIsland(bricks, brick);
  addTower(bricks, brick);
  addKeeperCottage(bricks, brick);
  addLantern(bricks, brick);

  return completeShowcaseModel({
    modelName: "Coastal Beacon Lighthouse",
    prompt: "Build a detailed red-and-white lighthouse on a rocky blue-water base with a keeper cottage, balcony, glowing beacon, and black lantern roof.",
    generatorVersion: "showcase-coastal-lighthouse-v1",
    inventory,
    bricks,
    notes: [
      "Inventory-safe coastal display scene with a connected water and rock base.",
      "Ordered from ocean and island through cottage, striped tower, balcony, and beacon.",
    ],
  });
}
