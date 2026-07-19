import { getPartDimensions } from "../partCatalog.js";
import { fixedDemoInventory } from "./fixedDemoInventory.js";
import {
  completeShowcaseModel,
  createShowcaseBrickFactory,
} from "./showcaseModelHelpers.js";

const BODY_PROFILE = [
  [0, 1, 7], [1, 0, 9], [2, 0, 12], [3, 0, 16],
  [4, 0, 20], [5, 0, 19], [6, 0, 15], [7, 1, 14],
  [8, 2, 16], [9, 2, 17], [10, 1, 16], [11, 1, 14],
  [12, 0, 15], [13, 0, 18], [14, 0, 22], [15, 0, 20],
  [16, 0, 13], [17, 2, 9],
];

const TOP_PROFILE = [
  [0, 2, 5], [1, 0, 7], [2, 0, 9], [3, 0, 13],
  [4, 0, 13], [5, 0, 17], [6, 0, 13], [7, 2, 13],
  [8, 2, 15], [9, 2, 15], [10, 2, 15], [11, 2, 13],
  [12, 0, 13], [13, 0, 17], [14, 0, 12], [15, 0, 19],
  [16, 4, 11], [17, 2, 7],
];

const RED_BRICKS = [
  "3007", "2456", "3001", "3002", "3003", "3008",
  "3009", "3010", "3622", "3004", "3005",
];
const RED_PLATES = [
  "3795", "3020", "3021", "3022", "4477", "3460",
  "3710", "3623", "3023", "3004", "3005",
];
const BROWN_PLATES = [
  "3030", "3031", "3832", "3034", "3795",
  "3020", "3021", "3022", "3710", "3623", "3023",
];
const BROWN_BRICKS = [
  "3001", "3002", "3003", "3010", "3622", "3004", "3005",
];
const BLACK_PLATES = [
  "3036", "3029", "3032", "3031", "4282", "3795",
  "3020", "3021", "3022", "3710", "3623", "3023",
];

function inventoryKey(partId, colorName) {
  return `${partId}:${colorName}`;
}

function createPlacementFactory(inventory, brick) {
  const remaining = new Map(
    inventory.items
      .filter(({ supported }) => supported)
      .map((item) => [inventoryKey(item.part_id, item.color_name), item.count]),
  );

  return {
    count(partId, colorName) {
      return remaining.get(inventoryKey(partId, colorName)) ?? 0;
    },
    place(spec) {
      const key = inventoryKey(spec.part_id, spec.color_name);
      const nextCount = (remaining.get(key) ?? 0) - 1;
      if (nextCount < 0) {
        throw new Error(`No ${spec.color_name} ${spec.part_id} remains for ${spec.id}.`);
      }
      remaining.set(key, nextCount);
      return brick(spec);
    },
  };
}

function cellKey(x, y) {
  return `${x}:${y}`;
}

function cellsForProfile(profile) {
  const cells = new Set();
  for (const [y, minX, maxX] of profile) {
    for (let x = minX; x <= maxX; x += 1) cells.add(cellKey(x, y));
  }
  return cells;
}

function cellsForRectangle(minX, maxX, minY, maxY) {
  const cells = new Set();
  for (let y = minY; y < maxY; y += 1) {
    for (let x = minX; x < maxX; x += 1) cells.add(cellKey(x, y));
  }
  return cells;
}

function bodyRegion(y) {
  if (y <= 3 || y >= 16) return "lower-bout";
  if (y <= 5) return "short-horn";
  if (y <= 7) return "lower-cutaway";
  if (y <= 10) return "waist";
  if (y <= 12) return "upper-cutaway";
  return "long-horn";
}

function packCells({
  bricks,
  placement,
  cells,
  partIds,
  colorName,
  z,
  feature,
  step,
  idFor,
}) {
  const occupied = new Set();
  const orderedCells = [...cells]
    .map((key) => key.split(":").map(Number))
    .sort((first, second) => first[1] - second[1] || first[0] - second[0]);
  let index = 0;

  for (const [x, y] of orderedCells) {
    if (occupied.has(cellKey(x, y))) continue;

    let chosen = null;
    for (const partId of partIds) {
      if (placement.count(partId, colorName) < 1) continue;
      for (const rotation of [90, 0]) {
        const dimensions = getPartDimensions(partId, rotation);
        const footprint = [];
        let fits = true;
        for (let dx = 0; dx < dimensions.width && fits; dx += 1) {
          for (let dy = 0; dy < dimensions.depth; dy += 1) {
            const key = cellKey(x + dx, y + dy);
            if (!cells.has(key) || occupied.has(key)) {
              fits = false;
              break;
            }
            footprint.push(key);
          }
        }
        if (fits) {
          chosen = { partId, rotation, footprint };
          break;
        }
      }
      if (chosen) break;
    }

    if (!chosen) {
      throw new Error(`Unable to tile ${feature} at ${x},${y},${z}.`);
    }

    for (const key of chosen.footprint) occupied.add(key);
    bricks.push(placement.place({
      id: idFor(index, x, y),
      part_id: chosen.partId,
      color_name: colorName,
      position: { x, y, z },
      rotation: chosen.rotation,
      feature,
      step,
    }));
    index += 1;
  }
}

function addBody(bricks, placement) {
  packCells({
    bricks,
    placement,
    cells: cellsForProfile(BODY_PROFILE),
    partIds: RED_BRICKS,
    colorName: "red",
    z: 0,
    feature: "guitar-body",
    step: 2,
    idFor: (index, _x, y) => `${bodyRegion(y)}-foundation-${index}`,
  });
  for (const [id, partId, x, y, z] of [
    ["short-horn", "3460", 14, 4, 3],
    ["long-horn", "4477", 13, 14, 3],
    ["waist", "3010", 0, 10, 4],
    ["upper-cutaway", "3010", 0, 12, 4],
    ["lower-bout-a", "3004", 0, 16, 3],
    ["lower-bout-b", "3004", 2, 16, 3],
    ["lower-bout-top", "3622", 0, 16, 6],
  ]) {
    bricks.push(placement.place({
      id: `${id}-stitch`,
      part_id: partId,
      color_name: "red",
      position: { x, y, z },
      rotation: 90,
      feature: "guitar-body",
      step: 4,
    }));
  }
  packCells({
    bricks,
    placement,
    cells: cellsForProfile(TOP_PROFILE),
    partIds: RED_PLATES,
    colorName: "red",
    z: 3,
    feature: "guitar-body",
    step: 3,
    idFor: (index, _x, y) => `${bodyRegion(y)}-contour-${index}`,
  });
}

function addStandAndNeck(bricks, placement) {
  for (const y of [6, 10]) {
    for (const x of [19, 35]) {
      bricks.push(placement.place({
        id: `stand-long-${x}-${y}`,
        part_id: "4282",
        color_name: "black",
        position: { x, y, z: 0 },
        rotation: 90,
        feature: "display-stand",
        step: 1,
      }));
    }
  }
  for (const x of [32, 42]) {
    bricks.push(placement.place({
      id: `stand-center-support-${x}`,
      part_id: "3020",
      color_name: "black",
      position: { x, y: 8, z: 0 },
      rotation: 90,
      feature: "display-stand",
      step: 1,
    }));
  }
  packCells({
    bricks,
    placement,
    cells: cellsForRectangle(18, 50, 6, 12),
    partIds: BROWN_PLATES,
    colorName: "brown",
    z: 1,
    feature: "neck",
    step: 2,
    idFor: (index) => `neck-${index}`,
  });
  packCells({
    bricks,
    placement,
    cells: cellsForRectangle(18, 50, 6, 12),
    partIds: BLACK_PLATES,
    colorName: "black",
    z: 2,
    feature: "fretboard",
    step: 3,
    idFor: (index) => `fretboard-${index}`,
  });
  bricks.push(placement.place({
    id: "fretboard-body-joint",
    part_id: "3020",
    color_name: "black",
    position: { x: 16, y: 8, z: 3 },
    rotation: 90,
    feature: "fretboard",
    step: 4,
  }));
}

function addHeadstock(bricks, placement) {
  const headstockProfile = [
    [5, 53, 56], [6, 52, 57], [7, 51, 58], [8, 51, 58],
    [9, 51, 58], [10, 51, 58], [11, 52, 57],
  ];
  packCells({
    bricks,
    placement,
    cells: cellsForProfile(headstockProfile),
    partIds: BROWN_BRICKS,
    colorName: "brown",
    z: 0,
    feature: "headstock",
    step: 2,
    idFor: (index) => `headstock-${index}`,
  });

  bricks.push(
    placement.place({
      id: "fretboard-headstock-joint",
      part_id: "3710",
      color_name: "black",
      position: { x: 47, y: 8, z: 3 },
      rotation: 90,
      feature: "fretboard",
      step: 4,
    }),
    placement.place({
      id: "headstock-face",
      part_id: "3032",
      color_name: "black",
      position: { x: 51, y: 6, z: 3 },
      feature: "fretboard",
      step: 4,
    }),
  );
  for (const y of [6, 8, 10]) {
    bricks.push(placement.place({
      id: `headstock-edge-face-${y}`,
      part_id: "3020",
      color_name: "black",
      position: { x: 55, y, z: 3 },
      rotation: 90,
      feature: "fretboard",
      step: 4,
    }));
  }
  for (const [index, x] of [49, 53].entries()) {
    bricks.push(placement.place({
      id: `headstock-face-bridge-${index + 1}`,
      part_id: "3710",
      color_name: "black",
      position: { x, y: 8, z: 4 },
      rotation: 90,
      feature: "fretboard",
      step: 5,
    }));
  }

  for (const [index, [x, y, z, partId]] of [
    [52, 6, 4, "3005"], [55, 6, 4, "3005"], [52, 8, 5, "3005"],
    [55, 8, 5, "3005"], [52, 10, 4, "3005"], [55, 10, 4, "3004"],
  ].entries()) {
    bricks.push(placement.place({
      id: `tuning-peg-${index + 1}`,
      part_id: partId,
      color_name: "dark gray",
      position: { x, y, z },
      rotation: 0,
      feature: "tuning-peg",
      step: 7,
    }));
  }
}

function addPickguardAndHardware(bricks, placement) {
  const pickguardPieces = [
    ["3032", 4, 4, 0], ["3020", 8, 4, 0], ["3020", 10, 4, 0],
    ["3020", 12, 6, 0], ["3020", 12, 10, 0],
    ["3021", 6, 10, 0], ["3021", 8, 10, 0],
    ["3022", 10, 10, 0], ["3022", 8, 8, 0],
    ["3023", 14, 7, 0],
  ];
  for (const [index, [partId, x, y, rotation]] of pickguardPieces.entries()) {
    bricks.push(placement.place({
      id: `pickguard-${index}`,
      part_id: partId,
      color_name: "white",
      position: { x, y, z: 4 },
      rotation,
      feature: "pickguard",
      step: 4,
    }));
  }

  for (const [id, x] of [["bridge", 5], ["middle", 10], ["neck", 13]]) {
    bricks.push(placement.place({
      id: `pickup-${id}`,
      part_id: "3710",
      color_name: "black",
      position: { x, y: 6, z: 5 },
      feature: "pickup",
      step: 5,
    }));
  }

  bricks.push(placement.place({
    id: "bridge",
    part_id: "3710",
    color_name: "dark gray",
    position: { x: 2, y: 6, z: 4 },
    feature: "bridge",
    step: 5,
  }));

  for (const [index, [partId, x, y]] of [
    ["3023", 6, 11], ["3023", 9, 12], ["3623", 13, 12],
  ].entries()) {
    bricks.push(placement.place({
      id: `control-knob-${index + 1}`,
      part_id: partId,
      color_name: "white",
      position: { x, y, z: 5 },
      rotation: 90,
      feature: "control-knob",
      step: 6,
    }));
  }
  bricks.push(placement.place({
    id: "selector-switch",
    part_id: "3022",
    color_name: "dark gray",
    position: { x: 12, y: 10, z: 5 },
    feature: "selector-switch",
    step: 6,
  }));
}

function addStringsAndMarkers(bricks, placement) {
  for (const [index, x] of [24, 32, 38, 46].entries()) {
    bricks.push(placement.place({
      id: `fret-marker-${index + 1}`,
      part_id: "3666",
      color_name: "white",
      position: { x, y: 6, z: 3 },
      feature: "fret-marker",
      step: 5,
    }));
  }

  const bodyParts = ["3023", "3023", "3023", "3023", "3023", "3710"];
  for (let lane = 1; lane <= 6; lane += 1) {
    const y = 5 + lane;
    bricks.push(placement.place({
      id: `string-${lane}-neck-joint`,
      part_id: bodyParts[lane - 1],
      color_name: "dark gray",
      position: { x: 20, y, z: 3 },
      rotation: 90,
      feature: "string-detail",
      step: 6,
    }));
  }
}

export function buildShowcaseElectricGuitarModel(inventory = fixedDemoInventory) {
  const bricks = [];
  const brick = createShowcaseBrickFactory(inventory, "Crimson Strat Electric Guitar");
  const placement = createPlacementFactory(inventory, brick);

  addBody(bricks, placement);
  addStandAndNeck(bricks, placement);
  addHeadstock(bricks, placement);
  addPickguardAndHardware(bricks, placement);
  addStringsAndMarkers(bricks, placement);
  bricks.sort((first, second) => first.step - second.step);

  return completeShowcaseModel({
    modelName: "Crimson Strat Electric Guitar",
    prompt: "Build a large detailed red Strat-style electric guitar with a stepped double-cutaway body, shaped white pickguard, three black pickups, bridge, three controls, selector, six strings, long fretted neck, and six tuners.",
    generatorVersion: "showcase-electric-guitar-v3",
    inventory,
    bricks,
    notes: [
      "Full-inventory hero model with a larger stepped Strat contour, pinched waist, and asymmetric horns.",
      "Top hardware includes a shaped white pickguard, SSS pickup layout, bridge, three controls, selector, six string lanes, fret markers, and six tuners.",
    ],
  });
}
