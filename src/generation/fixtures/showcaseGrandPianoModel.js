import { fixedDemoInventory } from "./fixedDemoInventory.js";
import {
  completeShowcaseModel,
  createShowcaseBrickFactory,
} from "./showcaseModelHelpers.js";

function addDisplayBase(bricks, brick) {
  for (const x of [2, 4, 6, 8]) {
    bricks.push(brick({
      id: `display-base-rail-${x}`,
      part_id: "4282",
      color_name: "black",
      position: { x, y: 0, z: 0 },
      feature: "display-base",
      step: 1,
    }));
  }

  for (const [index, [x, y]] of [[2, 0], [6, 0], [4, 8]].entries()) {
    bricks.push(brick({
      id: `display-base-deck-${index + 1}`,
      part_id: "3032",
      color_name: "black",
      position: { x, y, z: 1 },
      feature: "display-base",
      step: 2,
    }));
  }

  for (const x of [2, 6]) {
    bricks.push(brick({
      id: `display-base-center-${x}`,
      part_id: "3020",
      color_name: "black",
      position: { x, y: 6, z: 1 },
      rotation: 90,
      feature: "display-base",
      step: 2,
    }));
  }

  for (const [index, [x, y]] of [[2, 8], [8, 8], [2, 12], [8, 12]].entries()) {
    bricks.push(brick({
      id: `display-base-edge-${index + 1}`,
      part_id: "3020",
      color_name: "black",
      position: { x, y, z: 1 },
      feature: "display-base",
      step: 2,
    }));
  }

  bricks.push(
    brick({
      id: "bench-base-bridge",
      part_id: "3832",
      color_name: "brown",
      position: { x: 10, y: -6, z: 0 },
      feature: "display-base",
      step: 1,
    }),
    brick({
      id: "bench-base-riser",
      part_id: "3020",
      color_name: "brown",
      position: { x: 10, y: 0, z: 1 },
      feature: "display-base",
      step: 2,
    }),
    brick({
      id: "bench-base-connector",
      part_id: "3623",
      color_name: "black",
      position: { x: 9, y: 0, z: 2 },
      rotation: 90,
      feature: "display-base",
      step: 3,
    }),
  );
}

function addLegsAndCase(bricks, brick) {
  for (const [index, [x, y]] of [[2, 1], [8, 1], [4, 11]].entries()) {
    bricks.push(brick({
      id: `piano-leg-${index + 1}`,
      part_id: "3001",
      color_name: "black",
      position: { x, y, z: 2 },
      feature: "leg",
      step: 3,
    }));
  }

  bricks.push(
    brick({
      id: "tail-leg-cap",
      part_id: "3020",
      color_name: "black",
      position: { x: 4, y: 11, z: 5 },
      feature: "leg",
      step: 4,
    }),
    brick({
      id: "case-main-deck",
      part_id: "3036",
      color_name: "black",
      position: { x: 2, y: 1, z: 5 },
      feature: "case-base",
      step: 4,
    }),
    brick({
      id: "case-keyboard-wing",
      part_id: "3020",
      color_name: "black",
      position: { x: 8, y: 1, z: 5 },
      feature: "case-base",
      step: 4,
    }),
    brick({
      id: "case-tail-deck",
      part_id: "3029",
      color_name: "black",
      position: { x: 3, y: 5, z: 6 },
      feature: "case-base",
      step: 5,
    }),
  );

  for (let x = 2; x < 10; x += 1) {
    bricks.push(brick({
      id: `case-apron-${x}`,
      part_id: "3004",
      color_name: "black",
      position: { x, y: 3, z: 6 },
      feature: "case-base",
      step: 5,
    }));
  }

  for (const x of [5, 7]) {
    bricks.push(brick({
      id: `pedal-${x}`,
      part_id: "3004",
      color_name: "yellow",
      position: { x, y: 0, z: 2 },
      feature: "pedal",
      step: 3,
    }));
  }
}

function addSoundboard(bricks, brick) {
  bricks.push(brick({
    id: "soundboard-deck",
    part_id: "3832",
    color_name: "brown",
    position: { x: 4, y: 6, z: 7 },
    feature: "soundboard",
    step: 6,
  }));

  for (const x of [4, 5]) {
    for (const y of [6, 8, 10, 12, 14]) {
      bricks.push(brick({
        id: `soundboard-block-${x}-${y}`,
        part_id: "3004",
        color_name: "brown",
        position: { x, y, z: 8 },
        feature: "soundboard",
        step: 7,
      }));
    }
  }

  for (const y of [6, 10, 14]) {
    bricks.push(brick({
      id: `gold-string-bank-${y}`,
      part_id: "3020",
      color_name: "yellow",
      position: { x: 4, y, z: 11 },
      feature: "strings",
      step: 8,
    }));
  }
}

function addRimCourse(bricks, brick, {
  idPrefix,
  partId,
  colorName,
  z,
  feature,
  step,
}) {
  for (const x of [3, 6]) {
    for (const y of [5, 7, 9, 11, 13, 15]) {
      bricks.push(brick({
        id: `${idPrefix}-${x}-${y}`,
        part_id: partId,
        color_name: colorName,
        position: { x, y, z },
        feature,
        step,
      }));
    }
  }
}

function addCurvedRimAndLid(bricks, brick) {
  addRimCourse(bricks, brick, {
    idPrefix: "rim-lower",
    partId: "3004",
    colorName: "black",
    z: 7,
    feature: "curved-rim",
    step: 6,
  });
  addRimCourse(bricks, brick, {
    idPrefix: "rim-upper",
    partId: "3005",
    colorName: "black",
    z: 10,
    feature: "curved-rim",
    step: 8,
  });
  addRimCourse(bricks, brick, {
    idPrefix: "lid-hinge",
    partId: "3004",
    colorName: "dark gray",
    z: 13,
    feature: "lid-support",
    step: 9,
  });

  for (const x of [3, 5]) {
    bricks.push(
      brick({
        id: `raised-lid-lower-${x}`,
        part_id: "3795",
        color_name: "black",
        position: { x, y: 5, z: 16 },
        feature: "raised-lid",
        step: 10,
      }),
      brick({
        id: `raised-lid-middle-${x}`,
        part_id: "3020",
        color_name: "black",
        position: { x, y: 9, z: 17 },
        feature: "raised-lid",
        step: 11,
      }),
      brick({
        id: `raised-lid-upper-${x}`,
        part_id: "3021",
        color_name: "black",
        position: { x, y: 11, z: 18 },
        feature: "raised-lid",
        step: 12,
      }),
    );
  }

  bricks.push(brick({
    id: "raised-lid-tip",
    part_id: "3623",
    color_name: "black",
    position: { x: 4, y: 13, z: 19 },
    rotation: 90,
    feature: "raised-lid",
    step: 13,
  }));
}

function addKeyboard(bricks, brick) {
  for (const x of [2, 6]) {
    bricks.push(brick({
      id: `keyboard-bed-${x}`,
      part_id: "3710",
      color_name: "black",
      position: { x, y: 1, z: 6 },
      rotation: 90,
      feature: "keyboard-bed",
      step: 6,
    }));
  }

  for (let x = 2; x < 10; x += 1) {
    bricks.push(brick({
      id: `white-key-${x}`,
      part_id: "3005",
      color_name: "white",
      position: { x, y: 1, z: 7 },
      feature: "white-key",
      step: 7,
    }));
  }

  for (const x of [3, 5, 7]) {
    bricks.push(brick({
      id: `black-key-${x}`,
      part_id: "3023",
      color_name: "black",
      position: { x, y: 1, z: 10 },
      feature: "black-key",
      step: 8,
    }));
  }
}

function addMusicDesk(bricks, brick) {
  bricks.push(
    brick({
      id: "music-desk-post",
      part_id: "3010",
      color_name: "black",
      position: { x: 4, y: 3, z: 9 },
      rotation: 90,
      feature: "music-desk",
      step: 8,
    }),
    brick({
      id: "music-desk-rest",
      part_id: "3710",
      color_name: "black",
      position: { x: 4, y: 3, z: 12 },
      rotation: 90,
      feature: "music-desk",
      step: 9,
    }),
    brick({
      id: "sheet-music-left",
      part_id: "3004",
      color_name: "white",
      position: { x: 5, y: 3, z: 13 },
      feature: "sheet-music",
      step: 10,
    }),
    brick({
      id: "sheet-music-right",
      part_id: "3004",
      color_name: "white",
      position: { x: 6, y: 3, z: 13 },
      feature: "sheet-music",
      step: 10,
    }),
  );
}

function addBench(bricks, brick) {
  for (const [index, y] of [-5, -2].entries()) {
    bricks.push(brick({
      id: `bench-leg-${index + 1}`,
      part_id: "3003",
      color_name: "brown",
      position: { x: 10, y, z: 1 },
      feature: "bench",
      step: 3,
    }));
  }

  for (const [index, y] of [-5, -3].entries()) {
    bricks.push(brick({
      id: `bench-seat-${index + 1}`,
      part_id: "3020",
      color_name: "brown",
      position: { x: 9, y, z: 4 },
      rotation: 90,
      feature: "bench",
      step: 4,
    }));
  }
}

/**
 * Deterministic inventory-safe concert grand piano with bench.
 *
 * @param {import("../types.js").Inventory} inventory
 * @returns {import("../types.js").GeneratedModel}
 */
export function buildShowcaseGrandPianoModel(inventory = fixedDemoInventory) {
  const bricks = [];
  const brick = createShowcaseBrickFactory(inventory, "Midnight Grand Piano");

  addDisplayBase(bricks, brick);
  addLegsAndCase(bricks, brick);
  addBench(bricks, brick);
  addSoundboard(bricks, brick);
  addCurvedRimAndLid(bricks, brick);
  addKeyboard(bricks, brick);
  addMusicDesk(bricks, brick);

  return completeShowcaseModel({
    modelName: "Midnight Grand Piano",
    prompt: "build the midnight grand piano showcase",
    generatorVersion: "showcase-grand-piano-v1",
    inventory,
    bricks,
    notes: [
      "Layered concert grand with keyboard, soundboard, rising lid, pedals, and bench.",
      "Ordered from the connected display base through casework, keys, and lid details.",
    ],
  });
}
