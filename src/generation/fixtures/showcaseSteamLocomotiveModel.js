import { fixedDemoInventory } from "./fixedDemoInventory.js";
import {
  completeShowcaseModel,
  createShowcaseBrickFactory,
} from "./showcaseModelHelpers.js";

function addChassis(bricks, brick) {
  for (const x of [0, 16]) {
    for (const y of [2, 4]) {
      bricks.push(brick({
        id: `chassis-base-${x}-${y}`,
        part_id: "4282",
        color_name: "black",
        position: { x, y, z: 0 },
        rotation: 90,
        feature: "chassis",
        step: 1,
      }));
    }
  }

  for (const x of [0, 4, 8, 14, 18, 22, 26]) {
    bricks.push(
      brick({
        id: `running-board-${x}`,
        part_id: "3020",
        color_name: "black",
        position: { x, y: 3, z: 1 },
        rotation: 90,
        feature: "running-board",
        step: 2,
      }),
      brick({
        id: `chassis-rail-${x}`,
        part_id: "3001",
        color_name: "black",
        position: { x, y: 3, z: 2 },
        rotation: 90,
        feature: "chassis",
        step: 3,
      }),
    );
  }
}

function addWheel(bricks, brick, centerX, sideY, sideName, index) {
  const supportY = sideY === 1 ? 1 : 5;

  bricks.push(
    brick({
      id: `wheel-support-${sideName}-${index}`,
      part_id: "3022",
      color_name: "red",
      position: { x: centerX, y: supportY, z: 1 },
      feature: "wheel-support",
      step: 2,
    }),
    brick({
      id: `wheel-${sideName}-${index}-bottom`,
      part_id: "3004",
      color_name: "black",
      position: { x: centerX, y: sideY, z: 2 },
      rotation: 90,
      feature: "driving-wheel",
      step: 4,
    }),
    brick({
      id: `wheel-${sideName}-${index}-middle-left`,
      part_id: "3004",
      color_name: "dark gray",
      position: { x: centerX - 1, y: sideY, z: 5 },
      rotation: 90,
      feature: "wheel-rim",
      step: 5,
    }),
    brick({
      id: `wheel-${sideName}-${index}-middle-right`,
      part_id: "3004",
      color_name: "dark gray",
      position: { x: centerX + 1, y: sideY, z: 5 },
      rotation: 90,
      feature: "wheel-rim",
      step: 5,
    }),
    brick({
      id: `wheel-${sideName}-${index}-top`,
      part_id: "3004",
      color_name: "black",
      position: { x: centerX, y: sideY, z: 8 },
      rotation: 90,
      feature: "driving-wheel",
      step: 6,
    }),
    brick({
      id: `coupling-rod-${sideName}-${index}`,
      part_id: "3004",
      color_name: "yellow",
      position: { x: centerX, y: sideY, z: 11 },
      rotation: 90,
      feature: "coupling-rod",
      step: 7,
    }),
  );
}

function addWheelsAndRods(bricks, brick) {
  for (const [index, centerX] of [5, 13, 21].entries()) {
    addWheel(bricks, brick, centerX, 1, "near", index + 1);
    addWheel(bricks, brick, centerX, 6, "far", index + 1);
  }
}

function addLongBoilerCourse(bricks, brick) {
  for (const y of [3, 4]) {
    bricks.push(
      brick({
        id: `boiler-lower-${y}-front`,
        part_id: "3008",
        color_name: "red",
        position: { x: 2, y, z: 5 },
        rotation: 90,
        feature: "boiler",
        step: 8,
      }),
      brick({
        id: `boiler-lower-${y}-middle`,
        part_id: "3009",
        color_name: "red",
        position: { x: 10, y, z: 5 },
        rotation: 90,
        feature: "boiler",
        step: 8,
      }),
      brick({
        id: `boiler-lower-${y}-rear`,
        part_id: "3009",
        color_name: "red",
        position: { x: 16, y, z: 5 },
        rotation: 90,
        feature: "boiler",
        step: 8,
      }),
    );
  }
}

function addBoilerBrickCourses(bricks, brick) {
  for (const y of [3, 4]) {
    for (let x = 2; x < 22; x += 2) {
      bricks.push(brick({
        id: `boiler-middle-${y}-${x}`,
        part_id: "3004",
        color_name: "red",
        position: { x, y, z: 8 },
        rotation: 90,
        feature: "boiler",
        step: 9,
      }));
    }
  }

  const upperCourses = [
    { y: 3, fours: [2, 6, 10, 14], twos: [18, 20] },
    { y: 4, fours: [2, 6, 10], twos: [14, 16, 18, 20] },
  ];

  for (const course of upperCourses) {
    for (const x of course.fours) {
      bricks.push(brick({
        id: `boiler-upper-${course.y}-four-${x}`,
        part_id: "3010",
        color_name: "red",
        position: { x, y: course.y, z: 11 },
        rotation: 90,
        feature: "boiler",
        step: 10,
      }));
    }

    for (const x of course.twos) {
      bricks.push(brick({
        id: `boiler-upper-${course.y}-two-${x}`,
        part_id: "3004",
        color_name: "red",
        position: { x, y: course.y, z: 11 },
        rotation: 90,
        feature: "boiler",
        step: 10,
      }));
    }
  }
}

function addBoilerTop(bricks, brick) {
  for (const x of [2, 4]) {
    bricks.push(brick({
      id: `boiler-top-wide-${x}`,
      part_id: "3020",
      color_name: "red",
      position: { x, y: 2, z: 14 },
      feature: "boiler",
      step: 11,
    }));
  }

  for (const x of [6, 8, 10, 12, 14, 16]) {
    bricks.push(brick({
      id: `boiler-top-center-${x}`,
      part_id: "3021",
      color_name: "red",
      position: { x, y: 2, z: 14 },
      feature: "boiler",
      step: 11,
    }));
  }

}

function addBoilerFront(bricks, brick) {
  bricks.push(brick({
    id: "boiler-front-lower",
    part_id: "3010",
    color_name: "black",
    position: { x: 1, y: 2, z: 5 },
    feature: "boiler-front",
    step: 8,
  }));

  for (const z of [8, 11]) {
    for (const y of [2, 4]) {
      bricks.push(brick({
        id: `boiler-front-${z}-${y}`,
        part_id: "3004",
        color_name: "black",
        position: { x: 1, y, z },
        feature: "boiler-front",
        step: z === 8 ? 9 : 10,
      }));
    }
  }

  bricks.push(
    brick({
      id: "boiler-front-cap",
      part_id: "3020",
      color_name: "black",
      position: { x: 0, y: 2, z: 14 },
      feature: "boiler-front",
      step: 11,
    }),
    brick({
      id: "headlamp",
      part_id: "3004",
      color_name: "yellow",
      position: { x: 0, y: 3, z: 15 },
      rotation: 90,
      feature: "headlamp",
      step: 12,
    }),
  );
}

function addBoiler(bricks, brick) {
  addLongBoilerCourse(bricks, brick);
  addBoilerBrickCourses(bricks, brick);
  addBoilerTop(bricks, brick);
  addBoilerFront(bricks, brick);
}

function addCowcatcher(bricks, brick) {
  for (const y of [2, 3, 4, 5]) {
    bricks.push(brick({
      id: `cowcatcher-ground-${y}`,
      part_id: "3710",
      color_name: "red",
      position: { x: -4, y, z: 0 },
      rotation: 90,
      feature: "cowcatcher",
      step: 1,
    }));
  }

  for (const y of [2, 5]) {
    bricks.push(brick({
      id: `cowcatcher-upper-${y}`,
      part_id: "3710",
      color_name: "black",
      position: { x: -2, y, z: 1 },
      rotation: 90,
      feature: "cowcatcher",
      step: 2,
    }));
  }

  bricks.push(brick({
    id: "cowcatcher-cross-tie",
    part_id: "3666",
    color_name: "black",
    position: { x: -3, y: 1, z: 1 },
    feature: "cowcatcher",
    step: 2,
  }));
}

function addCab(bricks, brick) {
  for (const x of [24, 28]) {
    for (const y of [2, 4]) {
      bricks.push(brick({
        id: `cab-deck-${x}-${y}`,
        part_id: "3001",
        color_name: "red",
        position: { x, y, z: 5 },
        rotation: 90,
        feature: "cab",
        step: 8,
      }));
    }
  }

  for (const x of [24, 26, 28, 30]) {
    for (const y of [2, 4]) {
      bricks.push(brick({
        id: `cab-lower-${x}-${y}`,
        part_id: "3003",
        color_name: "red",
        position: { x, y, z: 8 },
        feature: "cab",
        step: 9,
      }));
    }
  }

  for (const y of [2, 5]) {
    for (const x of [24, 31]) {
      bricks.push(brick({
        id: `cab-post-${x}-${y}`,
        part_id: "3005",
        color_name: "red",
        position: { x, y, z: 11 },
        feature: "cab",
        step: 10,
      }));
    }

    for (const x of [25, 27, 29]) {
      bricks.push(brick({
        id: `cab-window-${x}-${y}`,
        part_id: "3004",
        color_name: "blue",
        position: { x, y, z: 11 },
        rotation: 90,
        feature: "cab-window",
        step: 10,
      }));
    }
  }

  for (const x of [24, 31]) {
    bricks.push(brick({
      id: `cab-end-wall-${x}`,
      part_id: "3004",
      color_name: "red",
      position: { x, y: 3, z: 11 },
      feature: "cab",
      step: 10,
    }));
  }

  for (const y of [2, 5]) {
    for (const x of [24, 27, 30]) {
      bricks.push(brick({
        id: `cab-top-beam-${x}-${y}`,
        part_id: "3622",
        color_name: "red",
        position: { x, y, z: 14 },
        rotation: 90,
        feature: "cab",
        step: 11,
      }));
    }
  }

  for (const x of [24, 31]) {
    bricks.push(brick({
      id: `cab-end-beam-${x}`,
      part_id: "3004",
      color_name: "red",
      position: { x, y: 3, z: 14 },
      feature: "cab",
      step: 11,
    }));
  }

  for (const x of [24, 28]) {
    bricks.push(brick({
      id: `cab-roof-${x}`,
      part_id: "3032",
      color_name: "black",
      position: { x, y: 1, z: 17 },
      feature: "roof",
      step: 12,
    }));
  }
}

function addTopDetails(bricks, brick) {
  bricks.push(
    brick({
      id: "smokestack-lower",
      part_id: "3003",
      color_name: "black",
      position: { x: 5, y: 3, z: 15 },
      feature: "smokestack",
      step: 12,
    }),
    brick({
      id: "smokestack-upper",
      part_id: "3003",
      color_name: "black",
      position: { x: 5, y: 3, z: 18 },
      feature: "smokestack",
      step: 13,
    }),
    brick({
      id: "smokestack-cap",
      part_id: "3020",
      color_name: "black",
      position: { x: 4, y: 2, z: 21 },
      feature: "smokestack",
      step: 14,
    }),
    brick({
      id: "boiler-dome",
      part_id: "3003",
      color_name: "yellow",
      position: { x: 13, y: 3, z: 15 },
      feature: "boiler-dome",
      step: 12,
    }),
    brick({
      id: "boiler-dome-cap",
      part_id: "3022",
      color_name: "red",
      position: { x: 13, y: 3, z: 18 },
      feature: "boiler-dome",
      step: 13,
    }),
  );
}

/**
 * Deterministic inventory-safe display locomotive.
 *
 * @param {import("../types.js").Inventory} inventory
 * @returns {import("../types.js").GeneratedModel}
 */
export function buildShowcaseSteamLocomotiveModel(inventory = fixedDemoInventory) {
  const bricks = [];
  const brick = createShowcaseBrickFactory(inventory, "Scarlet Steam Locomotive");

  addChassis(bricks, brick);
  addWheelsAndRods(bricks, brick);
  addCowcatcher(bricks, brick);
  addBoiler(bricks, brick);
  addCab(bricks, brick);
  addTopDetails(bricks, brick);

  return completeShowcaseModel({
    modelName: "Scarlet Steam Locomotive",
    prompt: "build the scarlet steam locomotive showcase",
    generatorVersion: "showcase-steam-locomotive-v1",
    inventory,
    bricks,
    notes: [
      "Inventory-safe display locomotive with layered mechanical detailing.",
      "Ordered from chassis and wheels through boiler, cab, and roof details.",
    ],
  });
}
