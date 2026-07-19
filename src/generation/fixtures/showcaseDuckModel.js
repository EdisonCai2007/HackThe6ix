import { fixedDemoInventory } from "./fixedDemoInventory.js";
import {
  completeShowcaseModel,
  createShowcaseBrickFactory,
} from "./showcaseModelHelpers.js";

function addWaterAndRipples(bricks, brick) {
  for (const x of [0, 6]) {
    bricks.push(brick({
      id: `water-base-${x}`,
      part_id: "3033",
      color_name: "blue",
      position: { x, y: 0, z: 0 },
      feature: "water",
      step: 1,
    }));
  }

  for (const [index, [x, y, rotation]] of [
    [0, 0, 0], [11, 0, 0], [0, 9, 90], [6, 9, 90],
  ].entries()) {
    bricks.push(brick({
      id: `ripple-long-${index}`,
      part_id: "3666",
      color_name: "white",
      position: { x, y, z: 1 },
      rotation,
      feature: "ripple",
      step: 2,
    }));
  }

  for (const [index, [x, y]] of [
    [1, 0], [1, 6], [10, 6],
  ].entries()) {
    bricks.push(brick({
      id: `ripple-short-${index}`,
      part_id: "3023",
      color_name: "white",
      position: { x, y, z: 1 },
      feature: "ripple",
      step: 2,
    }));
  }

  for (const [index, [x, y]] of [[0, 6], [11, 6]].entries()) {
    bricks.push(brick({
      id: `ripple-edge-${index}`,
      part_id: "3623",
      color_name: "white",
      position: { x, y, z: 1 },
      feature: "ripple",
      step: 2,
    }));
  }

  for (const x of [2, 5, 8]) {
    bricks.push(brick({
      id: `ripple-front-${x}`,
      part_id: "3021",
      color_name: "white",
      position: { x, y: 0, z: 1 },
      rotation: 90,
      feature: "ripple",
      step: 2,
    }));
  }
}

function addBody(bricks, brick) {
  for (const y of [2, 4, 6]) {
    for (const x of [2, 4, 6, 8]) {
      bricks.push(brick({
        id: `body-lower-${x}-${y}`,
        part_id: "3003",
        color_name: "yellow",
        position: { x, y, z: 1 },
        feature: "duck-body",
        step: 2,
      }));
    }
  }

  for (const y of [3, 4, 5, 6]) {
    for (const x of [2, 4, 6, 8]) {
      bricks.push(brick({
        id: `body-upper-${x}-${y}`,
        part_id: "3004",
        color_name: "yellow",
        position: { x, y, z: 4 },
        rotation: 90,
        feature: "duck-body",
        step: 3,
      }));
    }
  }

  for (const y of [3, 4, 5, 6]) {
    bricks.push(brick({
      id: `body-back-${y}`,
      part_id: "3009",
      color_name: "yellow",
      position: { x: 3, y, z: 7 },
      rotation: 90,
      feature: y === 3 || y === 6 ? "wing" : "duck-body",
      step: 4,
    }));
  }

  bricks.push(
    brick({
      id: "tail-base",
      part_id: "3003",
      color_name: "yellow",
      position: { x: 9, y: 4, z: 7 },
      feature: "tail",
      step: 4,
    }),
    brick({
      id: "tail-tip",
      part_id: "3010",
      color_name: "yellow",
      position: { x: 9, y: 2, z: 10 },
      feature: "tail",
      step: 5,
    }),
  );
}

function addNeckAndWing(bricks, brick) {
  for (const y of [3, 4, 5, 6]) {
    bricks.push(
      brick({
        id: `neck-wide-${y}`,
        part_id: "3010",
        color_name: "yellow",
        position: { x: 1, y, z: 10 },
        rotation: 90,
        feature: "neck",
        step: 5,
      }),
      brick({
        id: `neck-narrow-${y}`,
        part_id: "3004",
        color_name: "yellow",
        position: { x: 5, y, z: 10 },
        rotation: 90,
        feature: "neck",
        step: 5,
      }),
    );
  }

  bricks.push(
    brick({
      id: "wing-deck",
      part_id: "3020",
      color_name: "yellow",
      position: { x: 7, y: 3, z: 10 },
      feature: "wing",
      step: 5,
    }),
    brick({
      id: "wing-middle",
      part_id: "3021",
      color_name: "yellow",
      position: { x: 7, y: 3, z: 11 },
      feature: "wing",
      step: 6,
    }),
    brick({
      id: "wing-tip",
      part_id: "3022",
      color_name: "yellow",
      position: { x: 7, y: 3, z: 12 },
      feature: "wing",
      step: 7,
    }),
  );
}

function addHead(bricks, brick) {
  for (const x of [2, 4, 6]) {
    bricks.push(brick({
      id: `head-middle-${x}`,
      part_id: "3001",
      color_name: "yellow",
      position: { x, y: 2, z: 13 },
      feature: "head",
      step: 8,
    }));
  }

  for (const y of [3, 5]) {
    bricks.push(brick({
      id: `beak-${y}`,
      part_id: "3004",
      color_name: "orange",
      position: { x: 0, y, z: 13 },
      rotation: 90,
      feature: "beak",
      step: 8,
    }));
  }

  for (const x of [2, 4]) {
    bricks.push(brick({
      id: `head-upper-${x}`,
      part_id: "3002",
      color_name: "yellow",
      position: { x, y: 3, z: 16 },
      feature: "head",
      step: 9,
    }));
  }

  for (const x of [2, 4]) {
    bricks.push(brick({
      id: `head-cap-${x}`,
      part_id: "3003",
      color_name: "yellow",
      position: { x, y: 3, z: 19 },
      feature: "head",
      step: 10,
    }));
  }

  for (const [index, x] of [2, 5].entries()) {
    bricks.push(brick({
      id: `eye-${index + 1}`,
      part_id: "3005",
      color_name: "black",
      position: { x, y: 3, z: 22 },
      feature: "eye",
      step: 11,
    }));
  }
}

export function buildShowcaseDuckModel(inventory = fixedDemoInventory) {
  const bricks = [];
  const brick = createShowcaseBrickFactory(inventory, "Golden Rubber Duck");

  addWaterAndRipples(bricks, brick);
  addBody(bricks, brick);
  addNeckAndWing(bricks, brick);
  addHead(bricks, brick);
  bricks.sort((first, second) => first.step - second.step);

  return completeShowcaseModel({
    modelName: "Golden Rubber Duck",
    prompt: "Build a bright yellow rubber duck with a rounded stepped body, raised head, wings, tail, two black eyes, orange beak, and blue water with white ripples.",
    generatorVersion: "showcase-rubber-duck-v1",
    inventory,
    bricks,
    notes: [
      "Locked yellow, orange, black, blue, and white palette with no fallback colors.",
      "Ordered from the water base through the rounded body, neck, wing, head, beak, and eyes.",
    ],
  });
}
