import { getPartDimensions } from "../partCatalog.js";
import { randomBuildInventory } from "../fixtures/randomBuildInventory.js";

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
        `Mini factory requires ${color_name} part ${part_id}, which is not in inventory ${inventory.inventory_id}.`,
      );
    }

    const nextUsedCount = (used.get(key) ?? 0) + 1;

    if (nextUsedCount > item.count) {
      throw new Error(
        `Mini factory requires ${nextUsedCount} ${color_name} ${item.label}s, but inventory ${inventory.inventory_id} only has ${item.count}.`,
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
  for (const x of [0, 4, 8]) {
    bricks.push(
      brick({
        id: `ground-base-${x}`,
        part_id: "3035",
        color_name: "green",
        position: { x, y: 0, z: 0 },
        feature: "green-ground",
        step: 1,
      }),
    );
  }
}

function addFoundation(bricks, brick) {
  const placements = [
    ["west", "3008", 0, 0, 0],
    ["east", "3008", 11, 0, 0],
    ["front-center", "3008", 1, 7, 90],
    ["front-east", "3003", 9, 6, 0],
    ["back-center", "3008", 1, 0, 90],
    ["back-east", "3003", 9, 0, 0],
  ];

  for (const [id, part_id, x, y, rotation] of placements) {
    bricks.push(
      brick({
        id: `foundation-${id}`,
        part_id,
        color_name: "brown",
        position: { x, y, z: 1 },
        rotation,
        feature: "brown-foundation",
        step: 2,
      }),
    );
  }
}

function addWindowAndDoorCourse(bricks, brick, z, course) {
  const placements = [
    ["west-outer-wall", "3004", "white", 0, "white-walls"],
    ["west-window-left", "3009", "yellow", 1, "yellow-windows"],
    ["west-window-right", "3009", "yellow", 2, "yellow-windows"],
    ["west-inner-wall", "3004", "white", 3, "white-walls"],
    ["door-west-left", "3622", "red", 4, "red-doors"],
    ["door-west-right", "3622", "red", 5, "red-doors"],
    ["door-east-left", "3622", "red", 6, "red-doors"],
    ["door-east-right", "3622", "red", 7, "red-doors"],
    ["east-inner-wall", "3004", "white", 8, "white-walls"],
    ["east-window-left", "3009", "yellow", 9, "yellow-windows"],
    ["east-window-right", "3009", "yellow", 10, "yellow-windows"],
    ["east-outer-wall", "3004", "white", 11, "white-walls"],
  ];

  for (const [id, part_id, color_name, x, feature] of placements) {
    const depth = getPartDimensions(part_id).depth;

    bricks.push(
      brick({
        id: `front-${id}-course-${course}`,
        part_id,
        color_name,
        position: { x, y: 8 - depth, z },
        feature,
        step: course + 2,
      }),
    );
  }
}

function addUpperDoorCourse(bricks, brick) {
  for (const x of [0, 2, 8, 10]) {
    bricks.push(
      brick({
        id: `front-upper-wall-${x}`,
        part_id: "3004",
        color_name: "white",
        position: { x, y: 7, z: 10 },
        rotation: 90,
        feature: "white-walls",
        step: 5,
      }),
    );
  }

  for (const x of [4, 5, 6, 7]) {
    bricks.push(
      brick({
        id: `front-upper-door-${x}`,
        part_id: "3622",
        color_name: "red",
        position: { x, y: 5, z: 10 },
        feature: "red-doors",
        step: 5,
      }),
    );
  }
}

function addFrontLintel(bricks, brick) {
  for (const x of [0, 2, 8, 10]) {
    bricks.push(
      brick({
        id: `front-lintel-${x}`,
        part_id: "3004",
        color_name: "white",
        position: { x, y: 7, z: 13 },
        rotation: 90,
        feature: "white-walls",
        step: 6,
      }),
    );
  }

  bricks.push(
    brick({
      id: "front-blue-roof-fascia",
      part_id: "3010",
      color_name: "blue",
      position: { x: 4, y: 7, z: 13 },
      rotation: 90,
      feature: "blue-roof",
      step: 6,
    }),
  );
}

function addSideAndBackWalls(bricks, brick) {
  for (const [course, z] of [[1, 4], [2, 7], [3, 10], [4, 13]]) {
    for (const [side, x] of [["west", 0], ["east", 11]]) {
      for (const y of [0, 4]) {
        bricks.push(
          brick({
            id: `${side}-wall-${y}-course-${course}`,
            part_id: "3004",
            color_name: "white",
            position: { x, y, z },
            feature: "white-walls",
            step: course + 2,
          }),
        );
      }
    }

    if (course < 4) {
      bricks.push(
        brick({
          id: `back-center-wall-course-${course}`,
          part_id: "3004",
          color_name: "white",
          position: { x: 5, y: 0, z },
          rotation: 90,
          feature: "white-walls",
          step: course + 2,
        }),
      );
    }
  }
}

function addWalls(bricks, brick) {
  addWindowAndDoorCourse(bricks, brick, 4, 1);
  addWindowAndDoorCourse(bricks, brick, 7, 2);
  addUpperDoorCourse(bricks, brick);
  addFrontLintel(bricks, brick);
  addSideAndBackWalls(bricks, brick);
}

function addRoof(bricks, brick) {
  for (const x of [0, 2, 4, 6, 8, 10]) {
    bricks.push(
      brick({
        id: `roof-front-${x}`,
        part_id: "3795",
        color_name: "blue",
        position: { x, y: 2, z: 16 },
        feature: "blue-roof",
        step: 7,
      }),
    );
  }

  for (const x of [0, 6]) {
    bricks.push(
      brick({
        id: `roof-back-${x}`,
        part_id: "3795",
        color_name: "blue",
        position: { x, y: 0, z: 16 },
        rotation: 90,
        feature: "blue-roof",
        step: 7,
      }),
    );
  }

  for (const x of [0, 2, 4, 6, 8, 10]) {
    bricks.push(
      brick({
        id: `roof-raised-center-${x}`,
        part_id: "3020",
        color_name: "blue",
        position: { x, y: 2, z: 17 },
        feature: "blue-roof",
        step: 8,
      }),
    );
  }
}

function addRoofMachinery(bricks, brick) {
  for (const [name, x] of [["west", 0], ["east", 11]]) {
    bricks.push(
      brick({
        id: `${name}-roof-machine-base`,
        part_id: "3623",
        color_name: "black",
        position: { x, y: 3, z: 18 },
        feature: "black-roof-machinery",
        step: 9,
      }),
      brick({
        id: `${name}-roof-machine-top`,
        part_id: "3023",
        color_name: "black",
        position: { x, y: 3, z: 19 },
        feature: "black-roof-machinery",
        step: 9,
      }),
    );
  }
}

function addSmokestack(bricks, brick, name, x) {
  bricks.push(
    brick({
      id: `${name}-smokestack-base`,
      part_id: "3623",
      color_name: "black",
      position: { x, y: 3, z: 18 },
      feature: "black-smokestacks",
      step: 9,
    }),
  );

  for (const [course, z] of [[1, 19], [2, 22], [3, 25], [4, 28]]) {
    bricks.push(
      brick({
        id: `${name}-smokestack-shaft-${course}`,
        part_id: "3005",
        color_name: "black",
        position: { x, y: 4, z },
        feature: "black-smokestacks",
        step: course + 9,
      }),
    );
  }

  bricks.push(
    brick({
      id: `${name}-smokestack-cap`,
      part_id: "3023",
      color_name: "black",
      position: { x, y: 3, z: 31 },
      feature: "black-smokestacks",
      step: 14,
    }),
  );
}

function addSmoke(bricks, brick, name, stackX) {
  bricks.push(
    brick({
      id: `${name}-smoke-lower`,
      part_id: "3004",
      color_name: "white",
      position: { x: stackX, y: 3, z: 32 },
      feature: "white-smoke",
      step: 15,
    }),
    brick({
      id: `${name}-smoke-upper-drift`,
      part_id: "3710",
      color_name: "white",
      position: { x: stackX - 1, y: 3, z: 35 },
      rotation: 90,
      feature: "white-smoke",
      step: 16,
    }),
  );
}

function addSmokestacksAndSmoke(bricks, brick) {
  for (const [name, x] of [["west", 3], ["east", 8]]) {
    addSmokestack(bricks, brick, name, x);
    addSmoke(bricks, brick, name, x);
  }
}

/**
 * Deterministic 99-piece rectangular mini factory with two smokestacks.
 *
 * @param {import("../types.js").Inventory} inventory
 * @returns {import("../types.js").GeneratedModel}
 */
export function buildMiniFactoryModel(inventory = randomBuildInventory) {
  const bricks = [];
  const brick = createBrickFactory(inventory);

  addGroundBase(bricks, brick);
  addFoundation(bricks, brick);
  addWalls(bricks, brick);
  addRoof(bricks, brick);
  addRoofMachinery(bricks, brick);
  addSmokestacksAndSmoke(bricks, brick);

  return {
    model_name: "Mini Factory",
    prompt: "Build a small rectangular factory with brown foundation trim, white walls, centered red double doors, yellow side windows, a blue roof, and two black smokestacks with white smoke.",
    piece_count: bricks.length,
    dimensions: dimensionsFor(bricks),
    created_from_inventory_id: inventory.inventory_id,
    generator_version: "fixture-mini-factory-99-v3",
    bricks,
    notes: [
      "Uses 99 basic rectangular bricks and plates from the random build assortment.",
      "A flat green ground plate supports a brown perimeter foundation and a wide white warehouse facade.",
      "The centered red double door is three bricks tall, with smaller yellow windows on both sides.",
      "A continuous blue plate roof has a shallow raised center section and no red or yellow roof pieces.",
      "Exactly two four-brick black smokestacks carry separate stepped white smoke puffs.",
    ],
  };
}
