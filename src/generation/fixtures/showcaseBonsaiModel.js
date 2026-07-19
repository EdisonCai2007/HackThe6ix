import { fixedDemoInventory } from "./fixedDemoInventory.js";
import {
  completeShowcaseModel,
  createShowcaseBrickFactory,
} from "./showcaseModelHelpers.js";

function addPlinthAndPot(bricks, brick) {
  for (const x of [0, 4, 8]) {
    bricks.push(brick({
      id: `plinth-${x}`,
      part_id: "3032",
      color_name: "black",
      position: { x, y: 0, z: 0 },
      feature: "display-base",
      step: 1,
    }));
  }

  for (const y of [1, 3]) {
    for (let x = 3; x <= 8; x += 1) {
      bricks.push(brick({
        id: `pot-lower-${x}-${y}`,
        part_id: "3004",
        color_name: "red",
        position: { x, y, z: 1 },
        feature: "pot",
        step: 2,
      }));
    }
  }

  for (const y of [1, 2, 3, 4]) {
    bricks.push(brick({
      id: `pot-wall-${y}`,
      part_id: "3009",
      color_name: "red",
      position: { x: 3, y, z: 4 },
      rotation: 90,
      feature: "pot",
      step: 3,
    }));
  }

  for (const y of [0, 2]) {
    bricks.push(brick({
      id: `pot-rim-${y}`,
      part_id: "3795",
      color_name: "red",
      position: { x: 3, y, z: 7 },
      rotation: 90,
      feature: "pot",
      step: 4,
    }));
  }

  for (const x of [3, 5, 7]) {
    bricks.push(brick({
      id: `soil-${x}`,
      part_id: "3022",
      color_name: "dark gray",
      position: { x, y: 1, z: 8 },
      feature: "soil",
      step: 5,
    }));
  }

  for (const x of [3, 5, 7]) {
    bricks.push(brick({
      id: `root-${x}`,
      part_id: "3021",
      color_name: "brown",
      position: { x, y: 1, z: 9 },
      feature: "root",
      step: 6,
    }));
  }
}

function addTrunkAndBranches(bricks, brick) {
  for (const [index, [x, z]] of [
    [5, 10], [5, 13], [5, 16], [6, 19],
  ].entries()) {
    bricks.push(brick({
      id: `trunk-lower-${index}`,
      part_id: "3003",
      color_name: "brown",
      position: { x, y: 1, z },
      feature: "trunk",
      step: 7 + index,
    }));
  }

  for (const y of [0, 2]) {
    bricks.push(brick({
      id: `branch-lower-${y}`,
      part_id: "3034",
      color_name: "brown",
      position: { x: 1, y, z: 22 },
      rotation: 90,
      feature: "branch",
      step: 11,
    }));
  }

  bricks.push(brick({
    id: "trunk-upper",
    part_id: "3003",
    color_name: "brown",
    position: { x: 6, y: 1, z: 23 },
    feature: "trunk",
    step: 12,
  }));

  for (const x of [1, 3, 8]) {
    for (const y of [0, 2]) {
      bricks.push(brick({
        id: `foliage-lower-${x}-${y}`,
        part_id: "3003",
        color_name: "green",
        position: { x, y, z: 23 },
        feature: "foliage",
        step: 12,
      }));
    }
  }

  bricks.push(brick({
    id: "branch-middle",
    part_id: "3795",
    color_name: "brown",
    position: { x: 4, y: 1, z: 26 },
    rotation: 90,
    feature: "branch",
    step: 13,
  }));

  for (const x of [4, 6, 8]) {
    bricks.push(brick({
      id: `foliage-middle-${x}`,
      part_id: "3003",
      color_name: "green",
      position: { x, y: 1, z: 27 },
      feature: "foliage",
      step: 14,
    }));
  }

  for (const y of [0, 2]) {
    bricks.push(brick({
      id: `branch-crown-${y}`,
      part_id: "3832",
      color_name: "brown",
      position: { x: 2, y, z: 30 },
      rotation: 90,
      feature: "branch",
      step: 15,
    }));
  }
}

function addCrown(bricks, brick) {
  for (const x of [2, 5, 8]) {
    bricks.push(brick({
      id: `crown-block-${x}`,
      part_id: "3003",
      color_name: "green",
      position: { x, y: 0, z: 31 },
      feature: "foliage",
      step: 16,
    }));
  }

  for (const y of [2, 3]) {
    for (const x of [2, 4, 6, 8, 10]) {
      bricks.push(brick({
        id: `crown-spread-${x}-${y}`,
        part_id: "3004",
        color_name: "green",
        position: { x, y, z: 31 },
        rotation: 90,
        feature: "foliage",
        step: 16,
      }));
    }
  }

  for (const [index, [x, y]] of [
    [2, 0], [5, 0], [8, 0], [4, 2], [8, 2],
  ].entries()) {
    bricks.push(brick({
      id: `crown-upper-bar-${index}`,
      part_id: "3004",
      color_name: "green",
      position: { x, y, z: 34 },
      rotation: 90,
      feature: "foliage",
      step: 17,
    }));
  }

  for (const [index, [x, y]] of [
    [2, 1], [3, 1], [5, 1], [6, 1], [8, 1], [9, 1],
    [2, 3], [3, 3], [4, 3], [6, 3], [8, 3], [10, 3],
  ].entries()) {
    bricks.push(brick({
      id: `crown-leaf-${index}`,
      part_id: "3005",
      color_name: "green",
      position: { x, y, z: 34 },
      feature: "foliage",
      step: 17,
    }));
  }

  for (const [index, [x, y]] of [
    [2, 0], [5, 0], [8, 0], [3, 1], [6, 1], [9, 1],
  ].entries()) {
    bricks.push(brick({
      id: `crown-tip-${index}`,
      part_id: "3005",
      color_name: "green",
      position: { x, y, z: 37 },
      feature: "foliage",
      step: 18,
    }));
  }
}

export function buildShowcaseBonsaiModel(inventory = fixedDemoInventory) {
  const bricks = [];
  const brick = createShowcaseBrickFactory(inventory, "Japanese Bonsai Display");

  addPlinthAndPot(bricks, brick);
  addTrunkAndBranches(bricks, brick);
  addCrown(bricks, brick);
  bricks.sort((first, second) => first.step - second.step);

  return completeShowcaseModel({
    modelName: "Japanese Bonsai Display",
    prompt: "Build a detailed Japanese bonsai with a red pot, dark soil, exposed brown roots, an asymmetrical trunk, layered green foliage, and a black display plinth.",
    generatorVersion: "showcase-bonsai-v1",
    inventory,
    bricks,
    notes: [
      "Locked natural palette with separated foliage pads and an asymmetric supported trunk.",
      "Ordered from the display plinth and pot through roots, branches, and layered crown.",
    ],
  });
}
