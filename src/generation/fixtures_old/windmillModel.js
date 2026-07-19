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
        `Windmill requires ${color_name} part ${part_id}, which is not in inventory ${inventory.inventory_id}.`,
      );
    }

    const nextUsedCount = (used.get(key) ?? 0) + 1;

    if (nextUsedCount > item.count) {
      throw new Error(
        `Windmill requires ${nextUsedCount} ${color_name} ${item.label}s, but inventory ${inventory.inventory_id} only has ${item.count}.`,
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

function addGrassBase(bricks, brick) {
  for (const y of [0, 8]) {
    for (const x of [0, 4, 8, 12]) {
      bricks.push(
        brick({
          id: `ground-plate-${x}-${y}`,
          part_id: "3035",
          color_name: "green",
          position: { x, y, z: 0 },
          feature: "green-base",
          step: 1,
        }),
      );
    }
  }

  // These three ties bridge every seam in the eight-plate ground rectangle.
  for (const x of [2, 6, 10]) {
    bricks.push(
      brick({
        id: `ground-cross-tie-${x}`,
        part_id: "3001",
        color_name: "green",
        position: { x, y: 7, z: 1 },
        rotation: 90,
        feature: "green-base",
        step: 2,
      }),
    );
  }

  // A low brick border gives the square base a grassy, finished edge.
  for (const y of [0, 13]) {
    for (const x of [0, 2, 4, 6, 8, 10, 12, 14]) {
      bricks.push(
        brick({
          id: `grass-border-${x}-${y}`,
          part_id: "3002",
          color_name: "green",
          position: { x, y, z: 1 },
          feature: "green-base",
          step: 2,
        }),
      );
    }
  }

  for (const x of [0, 14]) {
    for (const y of [4, 7, 10]) {
      bricks.push(
        brick({
          id: `grass-border-${x}-${y}`,
          part_id: "3002",
          color_name: "green",
          position: { x, y, z: 1 },
          feature: "green-base",
          step: 2,
        }),
      );
    }
  }

  for (const [side, y] of [["front", 5], ["back", 9]]) {
    bricks.push(
      brick({
        id: `tower-plinth-${side}`,
        part_id: "3001",
        color_name: "green",
        position: { x: 6, y, z: 1 },
        rotation: 90,
        feature: "green-base",
        step: 3,
      }),
    );
  }
}

function addTower(bricks, brick) {
  // Eight courses make a 4x4-stud, eight-brick-tall tower. The front and back
  // walls stay solid so the silhouette reads clearly from the model's front.
  for (let course = 0; course < 8; course += 1) {
    const z = 4 + course * 3;

    for (const [side, y] of [["front", 6], ["back", 9]]) {
      for (const x of [6, 8]) {
        bricks.push(
          brick({
            id: `tower-${side}-${course + 1}-${x}`,
            part_id: "3004",
            color_name: "white",
            position: { x, y, z },
            rotation: 90,
            feature: "white-tower",
            step: course + 4,
          }),
        );
      }
    }
  }

  // A solid plate course locks the two walls together below the roof.
  for (const x of [6, 7, 8, 9]) {
    bricks.push(
      brick({
        id: `tower-cap-${x}`,
        part_id: "3710",
        color_name: "white",
        position: { x, y: 6, z: 28 },
        feature: "white-tower",
        step: 12,
      }),
    );
  }
}

function addDoorAndWindow(bricks, brick) {
  for (const z of [4, 7]) {
    for (const x of [7, 8]) {
      bricks.push(
        brick({
          id: `door-${x}-${z}`,
          part_id: "3005",
          color_name: "black",
          position: { x, y: 5, z },
          feature: "black-doorway",
          step: 5 + Math.floor((z - 4) / 3),
        }),
      );
    }
  }

  // The long dimension points into the facade, leaving a one-stud-wide yellow
  // rectangle visible from the front like a small window.
  bricks.push(
    brick({
      id: "tower-window",
      part_id: "3009",
      color_name: "yellow",
      position: { x: 9, y: 0, z: 4 },
      feature: "yellow-window",
      step: 5,
    }),
  );
}

function addRoof(bricks, brick) {
  bricks.push(
    brick({
      id: "roof-eave",
      part_id: "3032",
      color_name: "brown",
      position: { x: 5, y: 6, z: 29 },
      rotation: 90,
      feature: "brown-roof",
      step: 13,
    }),
  );

  for (const x of [6, 8]) {
    bricks.push(
      brick({
        id: `roof-cap-${x}`,
        part_id: "3003",
        color_name: "brown",
        position: { x, y: 7, z: 30 },
        feature: "brown-roof",
        step: 14,
      }),
    );
  }
}

function addVerticalBlades(bricks, brick) {
  bricks.push(
    brick({
      id: "blade-south-tip",
      part_id: "3031",
      color_name: "yellow",
      position: { x: 6, y: 2, z: 10 },
      feature: "blade-south",
      step: 7,
    }),
  );

  for (const z of [11, 14, 17, 20]) {
    bricks.push(
      brick({
        id: `blade-south-arm-${z}`,
        part_id: "3003",
        color_name: "brown",
        position: { x: 7, y: 4, z },
        feature: "blade-south",
        step: 8 + Math.floor((z - 11) / 3),
      }),
    );
  }

  for (const z of [27, 30, 33, 36]) {
    bricks.push(
      brick({
        id: `blade-north-arm-${z}`,
        part_id: "3003",
        color_name: "brown",
        position: { x: 7, y: 4, z },
        feature: "blade-north",
        step: 16 + Math.floor((z - 27) / 3),
      }),
    );
  }

  bricks.push(
    brick({
      id: "blade-north-tip",
      part_id: "3031",
      color_name: "yellow",
      position: { x: 6, y: 3, z: 39 },
      feature: "blade-north",
      step: 20,
    }),
  );
}

function addHubAndHorizontalBlades(bricks, brick) {
  for (const x of [7, 8]) {
    bricks.push(
      brick({
        id: `hub-mount-${x}`,
        part_id: "3623",
        color_name: "black",
        position: { x, y: 3, z: 23 },
        feature: "black-hub",
        step: 12,
      }),
      brick({
        id: `hub-face-${x}`,
        part_id: "3005",
        color_name: "black",
        position: { x, y: 3, z: 24 },
        feature: "black-hub",
        step: 13,
      }),
    );
  }

  for (const [feature, x] of [["blade-west", 0], ["blade-east", 8]]) {
    for (const y of [4, 5]) {
      bricks.push(
        brick({
          id: `${feature}-arm-${y}`,
          part_id: "3008",
          color_name: "brown",
          position: { x, y, z: 24 },
          rotation: 90,
          feature,
          step: 13,
        }),
      );
    }

    bricks.push(
      brick({
        id: `${feature}-tip`,
        part_id: "3031",
        color_name: "yellow",
        position: { x: feature === "blade-west" ? 0 : 12, y: 3, z: 27 },
        feature,
        step: 14,
      }),
    );
  }
}

/**
 * Deterministic 99-piece windmill on a grassy rectangular base.
 *
 * @param {import("../types.js").Inventory} inventory
 * @returns {import("../types.js").GeneratedModel}
 */
export function buildWindmillModel(inventory = randomBuildInventory) {
  const bricks = [];
  const brick = createBrickFactory(inventory);

  addGrassBase(bricks, brick);
  addTower(bricks, brick);
  addDoorAndWindow(bricks, brick);
  addRoof(bricks, brick);
  addVerticalBlades(bricks, brick);
  addHubAndHorizontalBlades(bricks, brick);

  return {
    model_name: "Grassy Base Windmill",
    prompt: "build a simple white windmill with four straight brown blades on a green base",
    piece_count: bricks.length,
    dimensions: dimensionsFor(bricks),
    created_from_inventory_id: inventory.inventory_id,
    generator_version: "fixture-windmill-99",
    bricks,
    notes: [
      "Uses 99 basic rectangular bricks and plates from the random build inventory.",
      "A tied 16x16 green ground supports an eight-course, 4x4 white tower.",
      "Four brown blade arms form a vertical and horizontal plus sign around a black hub.",
      "Yellow is reserved for the four blade tips and a small front window.",
    ],
  };
}
