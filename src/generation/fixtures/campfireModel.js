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
        `Campfire scene requires ${color_name} part ${part_id}, which is not in inventory ${inventory.inventory_id}.`,
      );
    }

    const nextUsedCount = (used.get(key) ?? 0) + 1;

    if (nextUsedCount > item.count) {
      throw new Error(
        `Campfire scene requires ${nextUsedCount} ${color_name} ${item.label}s, but inventory ${inventory.inventory_id} only has ${item.count}.`,
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

function addGroundBase(bricks, brick) {
  for (const y of [0, 8]) {
    for (const x of [0, 4, 8, 12]) {
      bricks.push(
        brick({
          id: `grass-base-${x}-${y}`,
          part_id: "3035",
          color_name: "green",
          position: { x, y, z: 0 },
          feature: "grass-base",
          step: 1,
        }),
      );
    }
  }
}

function addGroundShadows(bricks, brick) {
  for (const [id, x, y] of [
    ["west-front", 3, 1],
    ["east-front", 11, 1],
    ["west-back", 3, 15],
    ["east-back", 11, 15],
  ]) {
    bricks.push(
      brick({
        id: `base-seam-shadow-${id}`,
        part_id: "3023",
        color_name: "black",
        position: { x, y, z: 1 },
        rotation: 90,
        feature: "ground-shadow",
        step: 2,
      }),
    );
  }

  bricks.push(
    brick({
      id: "front-dirt-shadow",
      part_id: "3020",
      color_name: "black",
      position: { x: 6, y: 1, z: 1 },
      rotation: 90,
      feature: "ground-shadow",
      step: 2,
    }),
  );

  for (const [id, x, y] of [
    ["west-front", 2, 6],
    ["east-front", 13, 6],
    ["west-back", 2, 10],
    ["east-back", 13, 10],
  ]) {
    bricks.push(
      brick({
        id: `side-dirt-shadow-${id}`,
        part_id: "3623",
        color_name: "black",
        position: { x, y, z: 1 },
        feature: "ground-shadow",
        step: 2,
      }),
    );
  }
}

function addLogBed(bricks, brick) {
  for (const [id, x, y] of [
    ["west-front", 4, 3],
    ["east-front", 8, 3],
    ["west-back", 4, 9],
    ["east-back", 8, 9],
  ]) {
    bricks.push(
      brick({
        id: `brown-log-bed-${id}`,
        part_id: "3032",
        color_name: "brown",
        position: { x, y, z: 1 },
        feature: "log-bed",
        step: 3,
      }),
    );
  }
}

function addLooseGroundLogs(bricks, brick) {
  bricks.push(
    brick({
      id: "loose-front-log",
      part_id: "3008",
      color_name: "brown",
      position: { x: 4, y: 0, z: 1 },
      rotation: 90,
      feature: "loose-log",
      step: 4,
    }),
    brick({
      id: "loose-west-log",
      part_id: "3008",
      color_name: "brown",
      position: { x: 1, y: 4, z: 1 },
      feature: "loose-log",
      step: 4,
    }),
    brick({
      id: "loose-east-log",
      part_id: "3008",
      color_name: "brown",
      position: { x: 14, y: 4, z: 1 },
      feature: "loose-log",
      step: 4,
    }),
  );
}

function addAshAndEmbers(bricks, brick) {
  for (const [id, x, y] of [
    ["front-west", 5, 6],
    ["front-east", 8, 6],
    ["back-west", 5, 9],
    ["back-east", 8, 9],
  ]) {
    bricks.push(
      brick({
        id: `charred-ash-${id}`,
        part_id: "3023",
        color_name: "black",
        position: { x, y, z: 2 },
        feature: "charred-ash",
        step: 5,
      }),
    );
  }

  for (const [id, y] of [["front", 4], ["back", 12]]) {
    bricks.push(
      brick({
        id: `charred-ash-line-${id}`,
        part_id: "3623",
        color_name: "black",
        position: { x: 6, y, z: 2 },
        rotation: 90,
        feature: "charred-ash",
        step: 5,
      }),
    );
  }

  bricks.push(
    brick({
      id: "ember-red-front",
      part_id: "3022",
      color_name: "red",
      position: { x: 6, y: 6, z: 2 },
      feature: "ember",
      step: 5,
    }),
    brick({
      id: "ember-red-back",
      part_id: "3022",
      color_name: "red",
      position: { x: 9, y: 9, z: 2 },
      feature: "ember",
      step: 5,
    }),
    brick({
      id: "ember-yellow-west",
      part_id: "3023",
      color_name: "yellow",
      position: { x: 6, y: 9, z: 2 },
      feature: "ember",
      step: 5,
    }),
    brick({
      id: "ember-yellow-east",
      part_id: "3623",
      color_name: "yellow",
      position: { x: 9, y: 6, z: 2 },
      rotation: 90,
      feature: "ember",
      step: 5,
    }),
  );
}

function addLogLayer(bricks, brick, placements, step) {
  for (const [id, part_id, x, y, z, rotation = 0] of placements) {
    bricks.push(
      brick({
        id,
        part_id,
        color_name: "brown",
        position: { x, y, z },
        rotation,
        feature: "stacked-log",
        step,
      }),
    );
  }
}

function addCrisscrossLogs(bricks, brick) {
  addLogLayer(
    bricks,
    brick,
    [
      ["lower-log-front", "3008", 4, 5, 2, 90],
      ["lower-log-center", "3008", 4, 8, 2, 90],
      ["lower-log-back", "3008", 4, 11, 2, 90],
    ],
    6,
  );

  addLogLayer(
    bricks,
    brick,
    [
      ["cross-log-west", "3008", 5, 4, 5],
      ["cross-log-center", "3008", 8, 4, 5],
      ["cross-log-east", "3008", 11, 4, 5],
      ["kindling-block-front-west", "3003", 6, 5, 5],
      ["kindling-block-front-east", "3003", 9, 5, 5],
      ["kindling-block-middle-west", "3003", 6, 8, 5],
      ["kindling-block-middle-east", "3003", 9, 8, 5],
      ["kindling-block-back-west", "3003", 6, 10, 5],
      ["kindling-block-back-east", "3003", 9, 10, 5],
    ],
    7,
  );

  addLogLayer(
    bricks,
    brick,
    [
      ["upper-log-front", "3008", 4, 6, 8, 90],
      ["upper-log-back", "3008", 4, 10, 8, 90],
      ["upper-kindling-west", "3003", 5, 7, 8],
      ["upper-kindling-center", "3003", 8, 7, 8],
      ["upper-kindling-east", "3003", 10, 7, 8],
    ],
    8,
  );

  addLogLayer(
    bricks,
    brick,
    [
      ["top-log-west", "3008", 6, 5, 11],
      ["top-log-center", "3008", 8, 5, 11],
      ["top-log-east", "3008", 10, 5, 11],
      ["top-kindling-west", "3003", 4, 6, 11],
      ["top-kindling-east", "3003", 11, 10, 11],
      ["top-short-split-log", "3004", 7, 10, 11],
    ],
    9,
  );
}

function addFlame(bricks, brick) {
  const placements = [
    ["flame-red-base-west", "3622", "red", 6, 6, 14, 0],
    ["flame-red-base-east", "3622", "red", 10, 7, 14, 0],
    ["flame-red-base-front", "3004", "red", 7, 6, 14, 90],
    ["flame-red-base-back", "3004", "red", 8, 10, 14, 90],
    ["flame-yellow-core-base", "3002", "yellow", 8, 7, 14, 0],

    ["flame-red-mid-west", "3004", "red", 6, 7, 17, 0],
    ["flame-red-mid-east", "3004", "red", 10, 8, 17, 0],
    ["flame-red-front-spike", "3005", "red", 8, 6, 17, 0],
    ["flame-red-back-spike", "3005", "red", 8, 10, 17, 0],
    ["flame-yellow-core-west", "3622", "yellow", 8, 7, 17, 0],
    ["flame-yellow-core-east", "3622", "yellow", 9, 7, 17, 0],

    ["flame-red-upper-west", "3004", "red", 6, 8, 20, 0],
    ["flame-red-upper-east", "3004", "red", 10, 8, 20, 0],
    ["flame-red-upper-front", "3005", "red", 8, 7, 20, 0],
    ["flame-yellow-upper-core", "3003", "yellow", 8, 8, 20, 0],

    ["flame-red-tip-west", "3005", "red", 6, 8, 23, 0],
    ["flame-red-tip-east", "3005", "red", 10, 8, 23, 0],
    ["flame-red-tip-front", "3004", "red", 8, 7, 23, 90],
    ["flame-yellow-tip-west", "3005", "yellow", 8, 8, 23, 0],
    ["flame-yellow-tip-east", "3005", "yellow", 9, 8, 23, 0],

    ["flame-yellow-crown", "3005", "yellow", 8, 8, 26, 0],
    ["flame-red-crown-side", "3004", "red", 9, 8, 26, 0],
    ["flame-red-final-spark", "3005", "red", 8, 8, 29, 0],
  ];

  for (const [
    id,
    part_id,
    color_name,
    x,
    y,
    z,
    rotation,
  ] of placements) {
    bricks.push(
      brick({
        id,
        part_id,
        color_name,
        position: { x, y, z },
        rotation,
        feature: color_name === "yellow" ? "flame-core" : "flame-shell",
        step: Math.floor((z - 14) / 3) + 10,
      }),
    );
  }
}

/**
 * Deterministic rectangular campfire scene using the random build inventory.
 *
 * @param {import("../types.js").Inventory} inventory
 * @returns {import("../types.js").GeneratedModel}
 */
export function buildCampfireModel(inventory = randomBuildInventory) {
  const bricks = [];
  const brick = createBrickFactory(inventory);

  addGroundBase(bricks, brick);
  addGroundShadows(bricks, brick);
  addLogBed(bricks, brick);
  addLooseGroundLogs(bricks, brick);
  addAshAndEmbers(bricks, brick);
  addCrisscrossLogs(bricks, brick);
  addFlame(bricks, brick);

  return {
    model_name: "Campfire Scene",
    prompt: "Build a small LEGO-style campfire scene with a green plate base, black dirt and ash, a crisscrossed brown log stack, and a compact red and yellow flame.",
    piece_count: bricks.length,
    dimensions: dimensionsFor(bricks),
    created_from_inventory_id: inventory.inventory_id,
    generator_version: "fixture-campfire-random-build",
    bricks,
    notes: [
      "Uses only rectangular bricks and plates from the random build inventory.",
      "The 16 by 16 green plate base is tied together with low black dirt-shadow plates.",
      "Brown 1x8 logs alternate directions across a low stack, with 2x2 and 1x2 brown kindling blocks breaking up the silhouette.",
      "Black plates sit sparingly around the log bed as charred ash, with small red and yellow ember plates in the gaps.",
      "The flame column keeps red on the outside and yellow in the center while tapering upward through smaller pieces.",
    ],
  };
}
