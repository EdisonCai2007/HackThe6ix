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
        `Blocky globe requires ${color_name} part ${part_id}, which is not in inventory ${inventory.inventory_id}.`,
      );
    }

    const nextUsedCount = (used.get(key) ?? 0) + 1;

    if (nextUsedCount > item.count) {
      throw new Error(
        `Blocky globe requires ${nextUsedCount} ${color_name} ${item.label}s, but inventory ${inventory.inventory_id} only has ${item.count}.`,
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

function addPedestal(bricks, brick) {
  for (const x of [0, 4]) {
    bricks.push(
      brick({
        id: `pedestal-foundation-${x}`,
        part_id: "3032",
        color_name: "brown",
        position: { x, y: 0, z: 0 },
        feature: "pedestal-base-trim",
        step: 1,
      }),
    );
  }

  for (let x = 0; x < 5; x += 1) {
    for (const y of [0, 3]) {
      bricks.push(
        brick({
          id: `pedestal-black-1x3-${x}-${y}`,
          part_id: "3623",
          color_name: "black",
          position: { x, y, z: 1 },
          feature: "pedestal-base",
          step: 2,
        }),
      );
    }
  }

  for (const x of [5, 6, 7]) {
    for (const y of [0, 2, 4]) {
      bricks.push(
        brick({
          id: `pedestal-black-1x2-${x}-${y}`,
          part_id: "3023",
          color_name: "black",
          position: { x, y, z: 1 },
          feature: "pedestal-base",
          step: 2,
        }),
      );
    }
  }

  for (const y of [0, 5]) {
    bricks.push(
      brick({
        id: `pedestal-brown-trim-${y}`,
        part_id: "3008",
        color_name: "brown",
        position: { x: 0, y, z: 2 },
        rotation: 90,
        feature: "pedestal-base-trim",
        step: 3,
      }),
    );
  }

  for (const x of [3, 4]) {
    for (const y of [2, 3]) {
      bricks.push(
        brick({
          id: `pedestal-support-${x}-${y}`,
          part_id: "3005",
          color_name: "black",
          position: { x, y, z: 2 },
          feature: "pedestal-support",
          step: 3,
        }),
      );
    }
  }

  for (const [course, z] of [5, 8, 11, 14].entries()) {
    bricks.push(
      brick({
        id: `pedestal-column-${course + 1}`,
        part_id: "3003",
        color_name: "brown",
        position: { x: 3, y: 2, z },
        feature: "pedestal-column",
        step: course + 4,
      }),
    );
  }

  for (const x of [3, 4]) {
    for (const y of [2, 3]) {
      bricks.push(
        brick({
          id: `globe-cradle-${x}-${y}`,
          part_id: "3005",
          color_name: "black",
          position: { x, y, z: 17 },
          feature: "globe-cradle",
          step: 8,
        }),
      );
    }
  }
}

function addBluePlate(bricks, brick, {
  id,
  part_id,
  x,
  y,
  z,
  rotation = 0,
  step,
}) {
  bricks.push(
    brick({
      id,
      part_id,
      color_name: "blue",
      position: { x, y, z },
      rotation,
      feature: "globe-ocean-support",
      step,
    }),
  );
}

function addBlueStrip(bricks, brick, {
  id,
  x,
  y,
  z,
  rotation = 0,
  step,
}) {
  bricks.push(
    brick({
      id,
      part_id: "3010",
      color_name: "blue",
      position: { x, y, z },
      rotation,
      feature: "globe-ocean",
      step,
    }),
  );
}

function addLandPatch(bricks, brick, {
  id,
  part_id = "3002",
  x,
  y,
  z,
  rotation = 0,
  step,
}) {
  bricks.push(
    brick({
      id,
      part_id,
      color_name: "green",
      position: { x, y, z },
      rotation,
      feature: "globe-continent",
      step,
    }),
  );
}

function addFourByFourCourse(bricks, brick, {
  idPrefix,
  z,
  step,
  withLand = false,
}) {
  if (withLand) {
    bricks.push(
      brick({
        id: `${idPrefix}-land-west`,
        part_id: "3001",
        color_name: "green",
        position: { x: 2, y: 1, z },
        feature: "globe-continent",
        step,
      }),
    );

    for (const x of [4, 5]) {
      addBlueStrip(bricks, brick, {
        id: `${idPrefix}-ocean-${x}`,
        x,
        y: 1,
        z,
        step,
      });
    }
    return;
  }

  for (const x of [2, 3, 4, 5]) {
    addBlueStrip(bricks, brick, {
      id: `${idPrefix}-ocean-${x}`,
      x,
      y: 1,
      z,
      step,
    });
  }
}

function addSixWideCourse(bricks, brick, {
  idPrefix,
  z,
  step,
  reverseLand = false,
}) {
  for (let x = 1; x < 7; x += 1) {
    addBlueStrip(bricks, brick, {
      id: `${idPrefix}-ocean-${x}`,
      x,
      y: 1,
      z,
      step,
    });
  }

  const landPlacements = reverseLand
    ? [["front-east", 4, -1], ["back-west", 1, 5]]
    : [["front-west", 1, -1], ["back-east", 4, 5]];

  for (const [id, x, y] of landPlacements) {
    addLandPatch(bricks, brick, {
      id: `${idPrefix}-land-${id}`,
      x,
      y,
      z,
      rotation: 90,
      step,
    });
  }
}

function addEquatorCourse(bricks, brick, {
  idPrefix,
  z,
  step,
  reverseLand = false,
  extendedContinent = false,
}) {
  const skippedOceanXs = extendedContinent ? new Set([1, 2]) : new Set();

  for (let x = 1; x < 7; x += 1) {
    if (skippedOceanXs.has(x)) {
      continue;
    }

    addBlueStrip(bricks, brick, {
      id: `${idPrefix}-ocean-center-${x}`,
      x,
      y: 1,
      z,
      step,
    });
  }

  if (extendedContinent) {
    addLandPatch(bricks, brick, {
      id: `${idPrefix}-land-center-west`,
      part_id: "3001",
      x: 1,
      y: 1,
      z,
      step,
    });
  }

  const rim = reverseLand
    ? {
      land: [["front-east", 4, -1], ["back-west", 1, 5]],
      ocean: [["front-west", 0, -1, 90], ["back-east", 4, 6, 90]],
    }
    : {
      land: [["front-west", 1, -1], ["back-east", 4, 5]],
      ocean: [["front-east", 4, -1, 90], ["back-west", 0, 6, 90]],
    };

  for (const [id, x, y] of rim.land) {
    addLandPatch(bricks, brick, {
      id: `${idPrefix}-land-${id}`,
      x,
      y,
      z,
      rotation: 90,
      step,
    });
  }

  for (const [id, x, y, rotation] of rim.ocean) {
    addBlueStrip(bricks, brick, {
      id: `${idPrefix}-ocean-${id}`,
      x,
      y,
      z,
      rotation,
      step,
    });
  }

  for (const [id, x] of [["west", 0], ["east", 7]]) {
    addBlueStrip(bricks, brick, {
      id: `${idPrefix}-ocean-${id}`,
      x,
      y: 1,
      z,
      step,
    });
  }
}

function addGlobe(bricks, brick) {
  for (const x of [2, 4]) {
    addBluePlate(bricks, brick, {
      id: `globe-south-pole-support-${x}`,
      part_id: "3020",
      x,
      y: 1,
      z: 20,
      step: 9,
    });
  }
  addFourByFourCourse(bricks, brick, {
    idPrefix: "globe-south-course",
    z: 21,
    step: 10,
  });

  for (const x of [1, 3, 5]) {
    addBluePlate(bricks, brick, {
      id: `globe-lower-support-${x}`,
      part_id: "3795",
      x,
      y: 0,
      z: 24,
      step: 11,
    });
  }
  addSixWideCourse(bricks, brick, {
    idPrefix: "globe-lower-course",
    z: 25,
    step: 12,
  });

  for (const x of [0, 2, 4, 6]) {
    addBluePlate(bricks, brick, {
      id: `globe-equator-support-center-${x}`,
      part_id: "3020",
      x,
      y: 1,
      z: 28,
      step: 13,
    });
  }
  for (const y of [-1, 5]) {
    addBluePlate(bricks, brick, {
      id: `globe-equator-support-rim-${y}`,
      part_id: "3020",
      x: 2,
      y,
      z: 28,
      rotation: 90,
      step: 13,
    });
  }
  addEquatorCourse(bricks, brick, {
    idPrefix: "globe-equator-lower",
    z: 29,
    step: 14,
    extendedContinent: true,
  });
  addEquatorCourse(bricks, brick, {
    idPrefix: "globe-equator-upper",
    z: 32,
    step: 15,
    reverseLand: true,
  });

  for (const x of [1, 3, 5]) {
    addBluePlate(bricks, brick, {
      id: `globe-upper-support-${x}`,
      part_id: "3795",
      x,
      y: 0,
      z: 35,
      step: 16,
    });
  }
  addSixWideCourse(bricks, brick, {
    idPrefix: "globe-upper-course",
    z: 36,
    step: 17,
    reverseLand: true,
  });

  for (const x of [2, 4]) {
    addBluePlate(bricks, brick, {
      id: `globe-north-pole-support-${x}`,
      part_id: "3020",
      x,
      y: 1,
      z: 39,
      step: 18,
    });
  }
  addFourByFourCourse(bricks, brick, {
    idPrefix: "globe-north-course",
    z: 40,
    step: 19,
    withLand: true,
  });

  bricks.push(
    brick({
      id: "globe-axis-north",
      part_id: "3005",
      color_name: "black",
      position: { x: 3, y: 3, z: 43 },
      feature: "globe-axis",
      step: 20,
    }),
    brick({
      id: "globe-axis-cap",
      part_id: "3023",
      color_name: "black",
      position: { x: 3, y: 3, z: 46 },
      feature: "globe-axis",
      step: 20,
    }),
  );
}

/**
 * Deterministic 99-piece blocky globe on a brown and black pedestal.
 *
 * @param {import("../types.js").Inventory} inventory
 * @returns {import("../types.js").GeneratedModel}
 */
export function buildBlockyGlobeModel(inventory = randomBuildInventory) {
  const bricks = [];
  const brick = createBrickFactory(inventory);

  addPedestal(bricks, brick);
  addGlobe(bricks, brick);

  return {
    model_name: "Blocky Globe on a Stand",
    prompt: "build a blocky blue and green globe on a brown and black pedestal",
    piece_count: bricks.length,
    dimensions: dimensionsFor(bricks),
    created_from_inventory_id: inventory.inventory_id,
    generator_version: "fixture-blocky-globe-stand-99",
    bricks,
    notes: [
      "Uses 99 pieces from the random build assortment, staying below the 100-piece limit.",
      "Blue 4x4, 6-wide, 8-wide, 6-wide, and 4x4 courses create a stepped spherical globe.",
      "Ten asymmetrically staggered green bricks form land patches across the front, back, sides, and north cap.",
      "A black tiled base, brown trim and post, black cradle, and small black north-axis cap form the centered display stand.",
    ],
  };
}
