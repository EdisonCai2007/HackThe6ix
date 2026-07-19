import { fixedDemoInventory } from "./fixedDemoInventory.js";
import {
  completeShowcaseModel,
  createShowcaseBrickFactory,
} from "./showcaseModelHelpers.js";

function addDisplayStand(bricks, brick) {
  for (const y of [0, 2]) {
    bricks.push(brick({
      id: `stand-base-${y}`,
      part_id: "4282",
      color_name: "black",
      position: { x: 0, y, z: 0 },
      rotation: 90,
      feature: "display-stand",
      step: 1,
    }));
  }

  for (const z of [1, 4, 7]) {
    for (const [x, y] of [[0, 0], [0, 2], [15, 0], [15, 2]]) {
      bricks.push(brick({
        id: `stand-cradle-${x}-${y}-${z}`,
        part_id: "3004",
        color_name: "black",
        position: { x, y, z },
        feature: "display-stand",
        step: 2 + (z - 1) / 3,
      }));
    }
  }
}

function addGuitarBody(bricks, brick) {
  for (const [index, [x, y]] of [
    [4, 0], [8, 0], [4, 2], [8, 2],
  ].entries()) {
    bricks.push(brick({
      id: `body-lower-${index}`,
      part_id: "3001",
      color_name: "red",
      position: { x, y, z: 1 },
      rotation: 90,
      feature: "guitar-body",
      step: 2,
    }));
  }

  for (const [index, [x, y]] of [
    [2, 0], [12, 0], [2, 2], [12, 2],
  ].entries()) {
    bricks.push(brick({
      id: `body-lower-edge-${index}`,
      part_id: "3004",
      color_name: "red",
      position: { x, y, z: 1 },
      rotation: 90,
      feature: "guitar-body",
      step: 2,
    }));
  }

  for (const y of [0, 2]) {
    for (const x of [2, 4, 6, 8, 10, 12]) {
      bricks.push(brick({
        id: `body-wide-${x}-${y}`,
        part_id: "3003",
        color_name: "red",
        position: { x, y, z: 4 },
        feature: "guitar-body",
        step: 3,
      }));
    }
  }

  const faceFeatures = new Map([
    ["4:0", ["white", "pickguard"]],
    ["6:0", ["white", "pickguard"]],
    ["8:0", ["white", "pickguard"]],
    ["10:0", ["white", "pickguard"]],
    ["6:1", ["black", "pickup"]],
    ["8:1", ["black", "pickup"]],
    ["4:2", ["dark gray", "bridge"]],
    ["10:2", ["yellow", "control-knob"]],
    ["12:2", ["yellow", "control-knob"]],
  ]);

  for (const y of [0, 1, 2, 3]) {
    for (const x of [2, 4, 6, 8, 10, 12]) {
      const [colorName, feature] = faceFeatures.get(`${x}:${y}`) ?? ["red", "guitar-body"];

      bricks.push(brick({
        id: `body-face-${x}-${y}`,
        part_id: "3004",
        color_name: colorName,
        position: { x, y, z: 7 },
        rotation: 90,
        feature,
        step: 4,
      }));
    }
  }

  const waistFeatures = new Map([
    ["6:0", ["white", "pickguard"]],
    ["8:0", ["black", "pickup"]],
    ["10:0", ["dark gray", "bridge"]],
    ["10:2", ["yellow", "control-knob"]],
  ]);

  for (const y of [0, 2]) {
    for (const x of [4, 6, 8, 10]) {
      const [colorName, feature] = waistFeatures.get(`${x}:${y}`) ?? ["red", "guitar-body"];

      bricks.push(brick({
        id: `body-waist-${x}-${y}`,
        part_id: "3003",
        color_name: colorName,
        position: { x, y, z: 10 },
        feature,
        step: 5,
      }));
    }
  }

  for (const [side, startX] of [["left", 3], ["right", 9]]) {
    for (const y of [0, 2]) {
      for (const x of [startX, startX + 2]) {
        bricks.push(brick({
          id: `body-${side}-horn-${x}-${y}`,
          part_id: "3003",
          color_name: "red",
          position: { x, y, z: 13 },
          feature: "guitar-body",
          step: 6,
        }));
      }
    }
  }
}

function addNeckAndHeadstock(bricks, brick) {
  const markerCourses = new Set([19, 25, 31]);

  for (const z of [13, 16, 19, 22, 25, 28, 31, 34]) {
    const isMarker = markerCourses.has(z);

    bricks.push(
      brick({
        id: `fretboard-${z}`,
        part_id: "3004",
        color_name: isMarker ? "white" : "black",
        position: { x: 7, y: 1, z },
        rotation: 90,
        feature: isMarker ? "fret-marker" : "fretboard",
        step: 6 + (z - 13) / 3,
      }),
      brick({
        id: `neck-${z}`,
        part_id: "3004",
        color_name: "brown",
        position: { x: 7, y: 2, z },
        rotation: 90,
        feature: "neck",
        step: 6 + (z - 13) / 3,
      }),
    );
  }

  for (const y of [1, 2]) {
    bricks.push(brick({
      id: `headstock-lower-${y}`,
      part_id: "3010",
      color_name: "brown",
      position: { x: 6, y, z: 37 },
      rotation: 90,
      feature: "headstock",
      step: 14,
    }));
  }

  for (const x of [6, 8]) {
    bricks.push(brick({
      id: `headstock-upper-${x}`,
      part_id: "3003",
      color_name: "brown",
      position: { x, y: 1, z: 40 },
      feature: "headstock",
      step: 15,
    }));
  }

  bricks.push(brick({
    id: "tuning-peg-spine",
    part_id: "3004",
    color_name: "dark gray",
    position: { x: 6, y: 1, z: 43 },
    feature: "tuning-peg",
    step: 16,
  }));

  for (const [index, [x, y]] of [
    [7, 1], [8, 1], [9, 1], [7, 2], [9, 2],
  ].entries()) {
    bricks.push(brick({
      id: `tuning-peg-${index + 1}`,
      part_id: "3005",
      color_name: "dark gray",
      position: { x, y, z: 43 },
      feature: "tuning-peg",
      step: 16,
    }));
  }
}

export function buildShowcaseElectricGuitarModel(inventory = fixedDemoInventory) {
  const bricks = [];
  const brick = createShowcaseBrickFactory(inventory, "Crimson Strat Electric Guitar");

  addDisplayStand(bricks, brick);
  addGuitarBody(bricks, brick);
  addNeckAndHeadstock(bricks, brick);
  bricks.sort((first, second) => first.step - second.step);

  return completeShowcaseModel({
    modelName: "Crimson Strat Electric Guitar",
    prompt: "Build a detailed red Strat-style electric guitar with a white pickguard, black pickups and fretboard, brown neck, six tuners, and black display stand.",
    generatorVersion: "showcase-electric-guitar-v1",
    inventory,
    bricks,
    notes: [
      "Inventory-locked upright electric guitar with a stepped double-cutaway silhouette.",
      "Ordered from the connected stand and body through the neck, headstock, and six tuning pegs.",
    ],
  });
}
