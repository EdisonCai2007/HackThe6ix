import { fixedDemoInventory } from "./fixedDemoInventory.js";
import {
  completeShowcaseModel,
  createShowcaseBrickFactory,
} from "./showcaseModelHelpers.js";

function addDisplayStand(bricks, brick) {
  for (const [index, [x, y]] of [
    [0, 2], [0, 4], [0, 6], [16, 4],
  ].entries()) {
    bricks.push(brick({
      id: `stand-rail-${index}`,
      part_id: "4282",
      color_name: "black",
      position: { x, y, z: 0 },
      rotation: 90,
      feature: "display-stand",
      step: 1,
    }));
  }

  for (const x of [32, 36]) {
    bricks.push(brick({
      id: `headstock-support-${x}`,
      part_id: "3020",
      color_name: "black",
      position: { x, y: 4, z: 0 },
      rotation: 90,
      feature: "display-stand",
      step: 1,
    }));
  }
}

function addLowerBody(bricks, brick) {
  const splitCells = new Set([
    "0:2", "2:2", "4:2", "6:2", "8:2",
    "0:4", "4:4", "8:4", "2:6", "6:6",
  ]);

  for (const y of [2, 4, 6]) {
    for (const x of [0, 2, 4, 6, 8, 10, 12]) {
      if (splitCells.has(`${x}:${y}`)) {
        for (const offset of [0, 1]) {
          bricks.push(brick({
            id: `body-lower-split-${x}-${y}-${offset}`,
            part_id: "3004",
            color_name: "red",
            position: { x, y: y + offset, z: 1 },
            rotation: 90,
            feature: "guitar-body",
            step: 2,
          }));
        }
      } else {
        bricks.push(brick({
          id: `body-lower-${x}-${y}`,
          part_id: "3003",
          color_name: "red",
          position: { x, y, z: 1 },
          feature: "guitar-body",
          step: 2,
        }));
      }
    }
  }
}

function addContouredBody(bricks, brick) {
  for (const [index, [x, y]] of [
    [0, 0], [2, 0], [0, 4], [2, 4],
  ].entries()) {
    bricks.push(brick({
      id: `lower-bout-${index}`,
      part_id: "3001",
      color_name: "red",
      position: { x, y, z: 4 },
      feature: "guitar-body",
      step: 3,
    }));
  }

  for (const [index, [x, y]] of [
    [4, 2], [6, 2], [4, 5], [6, 5],
  ].entries()) {
    bricks.push(brick({
      id: `body-waist-${index}`,
      part_id: "3002",
      color_name: "red",
      position: { x, y, z: 4 },
      feature: "guitar-body",
      step: 3,
    }));
  }

  for (const [index, [x, y]] of [
    [8, 1], [8, 5], [12, 2], [12, 4],
  ].entries()) {
    bricks.push(brick({
      id: `cutaway-${index}`,
      part_id: "3003",
      color_name: "red",
      position: { x, y, z: 4 },
      feature: "guitar-body",
      step: 3,
    }));
  }

  for (const [index, [x, y]] of [
    [10, 1], [11, 1], [10, 5], [11, 5],
  ].entries()) {
    bricks.push(brick({
      id: `upper-bout-${index}`,
      part_id: "3010",
      color_name: "red",
      position: { x, y, z: 4 },
      feature: "guitar-body",
      step: 3,
    }));
  }
}

function addBodyHardware(bricks, brick) {
  for (const x of [4, 6]) {
    bricks.push(brick({
      id: `pickguard-${x}`,
      part_id: "3020",
      color_name: "white",
      position: { x, y: 2, z: 7 },
      feature: "pickguard",
      step: 4,
    }));
  }

  for (const x of [10, 11]) {
    bricks.push(brick({
      id: `pickup-${x}`,
      part_id: "3023",
      color_name: "black",
      position: { x, y: 2, z: 7 },
      feature: "pickup",
      step: 4,
    }));
  }

  bricks.push(brick({
    id: "bridge",
    part_id: "3710",
    color_name: "dark gray",
    position: { x: 9, y: 4, z: 7 },
    rotation: 90,
    feature: "bridge",
    step: 4,
  }));

  for (const [index, [x, y]] of [[8, 5], [8, 1]].entries()) {
    bricks.push(brick({
      id: `control-knob-${index}`,
      part_id: "3022",
      color_name: "yellow",
      position: { x, y, z: 7 },
      feature: "control-knob",
      step: 4,
    }));
  }
}

function addNeck(bricks, brick) {
  const markerPositions = new Set([18, 24, 30]);

  for (let x = 14; x <= 30; x += 2) {
    bricks.push(brick({
      id: `neck-${x}`,
      part_id: x === 30 ? "3010" : "3004",
      color_name: "brown",
      position: { x, y: 4, z: 1 },
      rotation: 90,
      feature: "neck",
      step: 2,
    }));

    const isMarker = markerPositions.has(x);
    bricks.push(brick({
      id: `fretboard-${x}`,
      part_id: "3004",
      color_name: isMarker ? "white" : "black",
      position: { x, y: 4, z: 4 },
      rotation: 90,
      feature: isMarker ? "fret-marker" : "fretboard",
      step: 3,
    }));
  }

  for (const x of [14, 18, 22, 26, 30]) {
    bricks.push(brick({
      id: `string-detail-${x}`,
      part_id: "3020",
      color_name: "black",
      position: { x, y: 4, z: 7 },
      rotation: 90,
      feature: "string-detail",
      step: 4,
    }));
  }

  for (const x of [18, 26]) {
    bricks.push(brick({
      id: `fret-wire-${x}`,
      part_id: "3023",
      color_name: "dark gray",
      position: { x, y: 4, z: 8 },
      rotation: 90,
      feature: "string-detail",
      step: 5,
    }));
  }
}

function addHeadstock(bricks, brick) {
  for (const x of [34]) {
    bricks.push(brick({
      id: `headstock-front-${x}`,
      part_id: "3003",
      color_name: "brown",
      position: { x, y: 3, z: 1 },
      feature: "headstock",
      step: 2,
    }));
  }

  for (const x of [32, 35]) {
    bricks.push(brick({
      id: `headstock-back-${x}`,
      part_id: "3622",
      color_name: "brown",
      position: { x, y: 5, z: 1 },
      rotation: 90,
      feature: "headstock",
      step: 2,
    }));
  }

  bricks.push(brick({
    id: "headstock-tip",
    part_id: "3004",
    color_name: "brown",
    position: { x: 36, y: 3, z: 1 },
    feature: "headstock",
    step: 2,
  }));

  bricks.push(brick({
    id: "tuning-peg-spine",
    part_id: "3004",
    color_name: "dark gray",
    position: { x: 34, y: 3, z: 4 },
    feature: "tuning-peg",
    step: 3,
  }));

  for (const [index, [x, y]] of [
    [35, 3], [32, 5], [33, 5], [36, 5], [37, 5],
  ].entries()) {
    bricks.push(brick({
      id: `tuning-peg-${index + 1}`,
      part_id: "3005",
      color_name: "dark gray",
      position: { x, y, z: 4 },
      feature: "tuning-peg",
      step: 3,
    }));
  }
}

export function buildShowcaseElectricGuitarModel(inventory = fixedDemoInventory) {
  const bricks = [];
  const brick = createShowcaseBrickFactory(inventory, "Crimson Strat Electric Guitar");

  addDisplayStand(bricks, brick);
  addLowerBody(bricks, brick);
  addContouredBody(bricks, brick);
  addBodyHardware(bricks, brick);
  addNeck(bricks, brick);
  addHeadstock(bricks, brick);
  bricks.sort((first, second) => first.step - second.step);

  return completeShowcaseModel({
    modelName: "Crimson Strat Electric Guitar",
    prompt: "Build a detailed red Strat-style electric guitar with a sculpted double-cutaway body, white pickguard, black pickups, bridge, controls, fretted brown neck, six tuners, and black display support.",
    generatorVersion: "showcase-electric-guitar-v2",
    inventory,
    bricks,
    notes: [
      "Inventory-locked horizontal display guitar with a stepped double-cutaway silhouette and exposed top hardware.",
      "Ordered from the black support and lower body through contour, neck, fretboard, headstock, and six tuning pegs.",
    ],
  });
}
