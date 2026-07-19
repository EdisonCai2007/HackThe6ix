import { getPartDimensions } from "../partCatalog.js";
import { carInventory } from "./carInventory.js";

const PART_LABELS = {
  3003: "2x2 brick",
  3001: "2x4 brick",
  3004: "1x2 brick",
  3005: "1x1 brick",
  3010: "1x4 brick",
  3666: "1x6 plate",
  3020: "2x4 plate",
  3031: "4x4 plate",
  3032: "4x6 plate",
  3035: "4x8 plate",
};

function brick({
  id,
  part_id,
  position,
  rotation = 0,
  feature,
  step,
  color_id = "4",
  color_name = "red",
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

function red(options) {
  return brick(options);
}

function black(options) {
  return brick({
    ...options,
    color_id: "0",
    color_name: "black",
  });
}

function glass(options) {
  return brick({
    ...options,
    color_id: "43",
    color_name: "translucent light blue",
  });
}

function yellow(options) {
  return brick({
    ...options,
    color_id: "14",
    color_name: "yellow",
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

function addUnderbodyAndWheels(bricks) {
  for (const x of [0, 4, 8, 12]) {
    for (const y of [1, 3]) {
      bricks.push(
        red({
          id: `underbody-${x}-${y}`,
          part_id: "3001",
          position: { x, y, z: 0 },
          rotation: 90,
          feature: "underbody",
          step: 1,
        }),
      );
    }
  }

  const wheelPositions = [
    ["front-left", 12, -1],
    ["front-right", 12, 5],
    ["rear-left", 2, -1],
    ["rear-right", 2, 5],
  ];

  for (const [name, x, y] of wheelPositions) {
    bricks.push(
      black({
        id: `wheel-${name}`,
        part_id: "3003",
        position: { x, y, z: 0 },
        feature: "wheel",
        step: 1,
      }),
    );
  }
}

function addLowerBody(bricks) {
  for (const x of [0, 4, 8, 12]) {
    for (const y of [0, 2, 4]) {
      bricks.push(
        red({
          id: `lower-body-${x}-${y}`,
          part_id: "3001",
          position: { x, y, z: 3 },
          rotation: 90,
          feature: "body",
          step: 2,
        }),
      );
    }
  }
}

function addMidBody(bricks) {
  for (const x of [0, 3, 6, 9, 12, 14]) {
    for (const y of [0, 5]) {
      bricks.push(
        red({
          id: `mid-side-${x}-${y}`,
          part_id: "3004",
          position: { x, y, z: 6 },
          rotation: 90,
          feature: "body-side",
          step: 3,
        }),
      );
    }
  }

  for (const x of [0, 4, 8, 12]) {
    bricks.push(
      red({
        id: `mid-center-${x}`,
        part_id: "3001",
        position: { x, y: 2, z: 6 },
        rotation: 90,
        feature: "body",
        step: 3,
      }),
    );
  }
}

function addUpperDecks(bricks) {
  const deckPieces = [
    ["rear-left", 0, 1],
    ["rear-right", 0, 3],
    ["front-left", 12, 1],
    ["front-right", 12, 3],
  ];

  for (const [name, x, y] of deckPieces) {
    bricks.push(
      red({
        id: `deck-${name}`,
        part_id: "3001",
        position: { x, y, z: 9 },
        rotation: 90,
        feature: "deck",
        step: 4,
      }),
    );
  }

  for (const x of [4, 9]) {
    for (const y of [0, 5]) {
      bricks.push(
        red({
          id: `door-top-${x}-${y}`,
          part_id: "3004",
          position: { x, y, z: 9 },
          rotation: 90,
          feature: "door",
          step: 4,
        }),
      );
    }
  }

  bricks.push(
    red({
      id: "cabin-floor-bridge",
      part_id: "3001",
      position: { x: 6, y: 2, z: 9 },
      rotation: 90,
      feature: "cabin",
      step: 4,
    }),
  );

  for (const y of [2, 3]) {
    bricks.push(
      yellow({
        id: `headlight-${y}`,
        part_id: "3005",
        position: { x: 15, y, z: 12 },
        feature: "headlight",
        step: 4,
      }),
    );
  }
}

function addCabinAndGlass(bricks) {
  for (const x of [5, 8]) {
    for (const y of [0, 5]) {
      bricks.push(
        glass({
          id: `side-window-${x}-${y}`,
          part_id: "3004",
          position: { x, y, z: 12 },
          rotation: 90,
          feature: "window",
          step: 5,
        }),
      );
    }
  }

  bricks.push(
    glass({
      id: "windshield",
      part_id: "3004",
      position: { x: 8, y: 2, z: 12 },
      feature: "windshield",
      step: 5,
    }),
    red({
      id: "front-cabin-bridge",
      part_id: "3001",
      position: { x: 9, y: 2, z: 12 },
      rotation: 90,
      feature: "cabin",
      step: 5,
    }),
  );

  for (const x of [4, 10]) {
    for (const y of [0, 5]) {
      bricks.push(
        red({
          id: `cabin-pillar-${x}-${y}`,
          part_id: "3005",
          position: { x, y, z: 12 },
          feature: "cabin-pillar",
          step: 5,
        }),
      );
    }
  }

  for (const y of [2, 3]) {
    bricks.push(
      black({
        id: `side-mirror-${y}`,
        part_id: "3005",
        position: { x: 15, y, z: 15 },
        feature: "grille",
        step: 6,
      }),
    );
  }
}

function addRoofAndSpoiler(bricks) {
  for (const x of [4, 8]) {
    for (const y of [0, 4]) {
      bricks.push(
        red({
          id: `roof-${x}-${y}`,
          part_id: "3001",
          position: { x, y, z: 15 },
          rotation: 90,
          feature: "roof",
          step: 6,
        }),
      );
    }
  }

  for (const y of [1, 4]) {
    bricks.push(
      red({
        id: `spoiler-support-${y}`,
        part_id: "3005",
        position: { x: 0, y, z: 12 },
        feature: "spoiler",
        step: 6,
      }),
    );
  }

  bricks.push(
    red({
      id: "spoiler-wing",
      part_id: "3010",
      position: { x: 0, y: 1, z: 15 },
      feature: "spoiler",
      step: 7,
    }),
  );
}

function addRoofPlates(bricks) {
  bricks.push(
    red({
      id: "roof-plate-main",
      part_id: "3032",
      position: { x: 5, y: 0, z: 18 },
      rotation: 90,
      feature: "roof-plate",
      step: 7,
    }),
    red({
      id: "hood-plate",
      part_id: "3031",
      position: { x: 9, y: 1, z: 19 },
      feature: "roof-accent-plate",
      step: 7,
    }),
  );
}

/**
 * Deterministic 72-piece hot red car with glass, stacked roof plates, four black wheels,
 * and a rear spoiler.
 *
 * @param {import("../types.js").Inventory} inventory
 * @returns {import("../types.js").GeneratedModel}
 */
export function buildCarModel(inventory = carInventory) {
  const bricks = [];

  addUnderbodyAndWheels(bricks);
  addLowerBody(bricks);
  addMidBody(bricks);
  addUpperDecks(bricks);
  addCabinAndGlass(bricks);
  addRoofAndSpoiler(bricks);
  addRoofPlates(bricks);

  return {
    model_name: "Hot Red Spoiler Car",
    prompt: "build a hot red lego car with a windshield, four windows, four black wheels, and a rear spoiler",
    piece_count: bricks.length,
    dimensions: dimensionsFor(bricks),
    created_from_inventory_id: inventory.inventory_id,
    generator_version: "mvp-car",
    bricks,
    notes: [
      "Uses 72 supported MVP pieces after raising the model cap to 100 pieces.",
      "The body is a layered red 3D chassis, not a flat side profile.",
      "Four black 2x2 bricks create visible block wheels at the corners.",
      "Translucent light blue bricks represent one windshield and four side windows.",
      "A raised red rear spoiler is supported by two red posts.",
      "A 4x6 roof plate and stacked 4x4 plate make larger plates visible in the default demo.",
    ],
  };
}

function addSportsCarV2BaseAndWheels(bricks) {
  for (const x of [0, 4, 8, 12, 16]) {
    bricks.push(
      red({
        id: `v2-base-plate-${x}`,
        part_id: "3035",
        position: { x, y: 0, z: 0 },
        feature: "flat-base",
        step: 1,
      }),
    );
  }

  for (const x of [0, 4, 8, 12, 16]) {
    for (const y of [1, 3, 5]) {
      bricks.push(
        red({
          id: `v2-lower-body-${x}-${y}`,
          part_id: "3001",
          position: { x, y, z: 1 },
          rotation: 90,
          feature: "red-body",
          step: 2,
        }),
      );
    }
  }

  const wheelPositions = [
    ["rear-left", 2, -1],
    ["rear-right", 2, 7],
    ["front-left", 16, -1],
    ["front-right", 16, 7],
  ];

  for (const [name, x, y] of wheelPositions) {
    bricks.push(
      black({
        id: `v2-wheel-${name}`,
        part_id: "3003",
        position: { x, y, z: 1 },
        feature: "wheel",
        step: 2,
      }),
    );
  }
}

function addSportsCarV2RedBody(bricks) {
  for (const x of [2, 6, 10, 14]) {
    for (const y of [1, 6]) {
      bricks.push(
        red({
          id: `v2-side-rail-${x}-${y}`,
          part_id: "3010",
          position: { x, y, z: 4 },
          rotation: 90,
          feature: "red-body-side",
          step: 3,
        }),
      );
    }
  }

  for (const x of [2, 6, 10, 14]) {
    for (const y of [2, 4]) {
      bricks.push(
        red({
          id: `v2-center-deck-${x}-${y}`,
          part_id: "3001",
          position: { x, y, z: 4 },
          rotation: 90,
          feature: "red-body-deck",
          step: 3,
        }),
      );
    }
  }

  for (const [name, x] of [["trunk", 0], ["hood", 16]]) {
    bricks.push(
      red({
        id: `v2-${name}-flat-plate`,
        part_id: "3031",
        position: { x, y: 2, z: 7 },
        feature: `flat-${name}`,
        step: 4,
      }),
    );
  }

  for (const y of [1, 6]) {
    bricks.push(
      yellow({
        id: `v2-headlight-${y}`,
        part_id: "3005",
        position: { x: 17, y, z: 7 },
        feature: "headlight",
        step: 4,
      }),
    );
  }

  for (const x of [2, 16]) {
    for (const y of [1, 6]) {
      bricks.push(
        red({
          id: `v2-fender-accent-${x}-${y}`,
          part_id: "3005",
          position: { x, y, z: 7 },
          feature: "red-fender-accent",
          step: 4,
        }),
      );
    }
  }
}

function addSportsCarV2CabinAndWindows(bricks) {
  for (const x of [6, 10]) {
    for (const y of [1, 6]) {
      bricks.push(
        glass({
          id: `v2-side-window-${x}-${y}`,
          part_id: "3004",
          position: { x, y, z: 7 },
          rotation: 90,
          feature: "window",
          step: 5,
        }),
      );
    }
  }

  bricks.push(
    glass({
      id: "v2-windshield",
      part_id: "3004",
      position: { x: 14, y: 3, z: 7 },
      feature: "windshield",
      step: 5,
    }),
  );

  for (const x of [5, 8, 9, 12]) {
    for (const y of [1, 6]) {
      bricks.push(
        red({
          id: `v2-cabin-pillar-${x}-${y}`,
          part_id: "3005",
          position: { x, y, z: 7 },
          feature: "cabin-pillar",
          step: 5,
        }),
      );
    }
  }

  for (const y of [2, 5]) {
    bricks.push(
      red({
        id: `v2-windshield-pillar-${y}`,
        part_id: "3005",
        position: { x: 14, y, z: 7 },
        feature: "windshield-pillar",
        step: 5,
      }),
    );
  }

  for (const x of [8, 12]) {
    bricks.push(
      red({
        id: `v2-roof-center-support-${x}`,
        part_id: "3004",
        position: { x, y: 3, z: 7 },
        rotation: 90,
        feature: "roof-support",
        step: 5,
      }),
    );
  }
}

function addSportsCarV2RoofAndSpoiler(bricks) {
  bricks.push(
    red({
      id: "v2-flat-roof-rear",
      part_id: "3035",
      position: { x: 6, y: 1, z: 10 },
      feature: "flat-roof",
      step: 6,
    }),
    red({
      id: "v2-flat-roof-front",
      part_id: "3032",
      position: { x: 10, y: 1, z: 10 },
      feature: "flat-roof",
      step: 6,
    }),
  );

  for (const y of [2, 5]) {
    bricks.push(
      red({
        id: `v2-spoiler-support-${y}`,
        part_id: "3005",
        position: { x: 0, y, z: 8 },
        feature: "spoiler-support",
        step: 7,
      }),
    );
  }

  bricks.push(
    red({
      id: "v2-thin-long-spoiler",
      part_id: "3666",
      position: { x: 0, y: 1, z: 11 },
      feature: "thin-long-spoiler",
      step: 7,
    }),
  );
}

/**
 * Deterministic 70-piece red sports car v2 with a flat plate base, flat roof,
 * four black wheels, four side windows, a windshield, and a thin long spoiler.
 *
 * @param {import("../types.js").Inventory} inventory
 * @returns {import("../types.js").GeneratedModel}
 */
export function buildSportsCarV2Model(inventory = carInventory) {
  const bricks = [];

  addSportsCarV2BaseAndWheels(bricks);
  addSportsCarV2RedBody(bricks);
  addSportsCarV2CabinAndWindows(bricks);
  addSportsCarV2RoofAndSpoiler(bricks);

  return {
    model_name: "Red Sports Car V2",
    prompt: "build a red sports car v2 with a flat base, flat roof, four windows, a windshield, four black wheels, and a thin long spoiler",
    piece_count: bricks.length,
    dimensions: dimensionsFor(bricks),
    created_from_inventory_id: inventory.inventory_id,
    generator_version: "sports-car-v2",
    bricks,
    notes: [
      "Uses exactly 70 supported pieces.",
      "Five red 4x8 plates form a flat base across the full chassis.",
      "The red body is layered above the base with four black wheels attached at the sides.",
      "Four translucent light blue side windows and one windshield define the cabin.",
      "A 4x8 plate and 4x6 plate form the flat roof.",
      "A red 1x6 plate creates the thin long rear spoiler.",
    ],
  };
}
