import { fixedDemoInventory } from "./fixedDemoInventory.js";
import {
  completeShowcaseModel,
  createShowcaseBrickFactory,
} from "./showcaseModelHelpers.js";

function addChassisAndWheels(bricks, brick) {
  for (const y of [0, 4]) {
    for (const x of [0, 16]) {
      bricks.push(brick({
        id: `chassis-rail-${x}-${y}`,
        part_id: "4282",
        color_name: "black",
        position: { x, y, z: 0 },
        rotation: 90,
        feature: "chassis",
        step: 1,
      }));
    }
  }

  bricks.push(brick({
    id: "chassis-center-tie",
    part_id: "3036",
    color_name: "black",
    position: { x: 12, y: 0, z: 1 },
    rotation: 90,
    feature: "chassis",
    step: 2,
  }));

  bricks.push(
    brick({
      id: "body-floor-cab",
      part_id: "3029",
      color_name: "black",
      position: { x: 0, y: 1, z: 1 },
      rotation: 90,
      feature: "chassis",
      step: 2,
    }),
    brick({
      id: "body-floor-mid",
      part_id: "3032",
      color_name: "black",
      position: { x: 20, y: 1, z: 1 },
      rotation: 90,
      feature: "chassis",
      step: 2,
    }),
    brick({
      id: "body-floor-rear",
      part_id: "3032",
      color_name: "black",
      position: { x: 26, y: 1, z: 1 },
      rotation: 90,
      feature: "chassis",
      step: 2,
    }),
  );

  for (const x of [3, 23]) {
    for (const y of [0, 5]) {
      bricks.push(brick({
        id: `wheel-support-${x}-${y}`,
        part_id: "3710",
        color_name: "black",
        position: { x, y, z: 1 },
        rotation: 90,
        feature: "chassis",
        step: 2,
      }));

      for (const z of [2, 5]) {
        bricks.push(brick({
          id: `wheel-${x}-${y}-${z}`,
          part_id: "3004",
          color_name: "black",
          position: { x: x + 1, y, z },
          rotation: 90,
          feature: "wheel",
          step: z === 2 ? 3 : 4,
        }));
      }

      bricks.push(brick({
        id: `wheel-rim-${x}-${y}`,
        part_id: "3023",
        color_name: "dark gray",
        position: { x: x + 1, y, z: 8 },
        rotation: 90,
        feature: "wheel-rim",
        step: 5,
      }));
    }
  }
}

function addLowerBody(bricks, brick) {
  bricks.push(
    brick({
      id: "front-grille",
      part_id: "3010",
      color_name: "dark gray",
      position: { x: 0, y: 1, z: 2 },
      feature: "grille",
      step: 3,
    }),
    brick({
      id: "front-cab-support",
      part_id: "3010",
      color_name: "red",
      position: { x: 1, y: 1, z: 2 },
      feature: "cab",
      step: 3,
    }),
  );

  for (const x of [2, 4, 6]) {
    for (const y of [1, 3]) {
      bricks.push(brick({
        id: `cab-lower-${x}-${y}`,
        part_id: "3003",
        color_name: "red",
        position: { x, y, z: 2 },
        feature: "cab",
        step: 3,
      }));
    }
  }

  for (const x of [8, 10, 12, 14]) {
    bricks.push(brick({
      id: `equipment-lower-${x}`,
      part_id: "3001",
      color_name: "red",
      position: { x, y: 1, z: 2 },
      feature: "equipment-body",
      step: 3,
    }));
  }

  for (const x of [16, 18, 20, 22, 24, 26]) {
    for (const y of [1, 3]) {
      bricks.push(brick({
        id: `equipment-rear-lower-${x}-${y}`,
        part_id: "3003",
        color_name: "red",
        position: { x, y, z: 2 },
        feature: "equipment-body",
        step: 3,
      }));
    }
  }

  for (const y of [1, 3]) {
    bricks.push(brick({
      id: `rear-platform-${y}`,
      part_id: "3004",
      color_name: "dark gray",
      position: { x: 28, y, z: 2 },
      rotation: 90,
      feature: "rear-platform",
      step: 3,
    }));
  }
}

function addCab(bricks, brick) {
  for (const y of [1, 3]) {
    bricks.push(brick({
      id: `headlight-${y}`,
      part_id: "3004",
      color_name: "yellow",
      position: { x: 0, y, z: 5 },
      feature: "headlight",
      step: 5,
    }));
  }

  for (const y of [1, 4]) {
    bricks.push(
      brick({
        id: `cab-window-front-${y}`,
        part_id: "3622",
        color_name: "blue",
        position: { x: 1, y, z: 5 },
        rotation: 90,
        feature: "windshield",
        step: 5,
      }),
      brick({
        id: `cab-window-rear-${y}`,
        part_id: "3010",
        color_name: "blue",
        position: { x: 4, y, z: 5 },
        rotation: 90,
        feature: "windshield",
        step: 5,
      }),
    );
  }

  bricks.push(brick({
    id: "cab-main-windshield",
    part_id: "3010",
    color_name: "blue",
    position: { x: 0, y: 1, z: 8 },
    feature: "windshield",
    step: 6,
  }));

  for (const y of [1, 4]) {
    for (const x of [1, 3, 5]) {
      bricks.push(brick({
        id: `cab-roof-support-${x}-${y}`,
        part_id: "3004",
        color_name: "red",
        position: { x, y, z: 8 },
        rotation: 90,
        feature: "cab",
        step: 6,
      }));
    }
  }

  for (const x of [0, 2, 4, 6]) {
    bricks.push(brick({
      id: `cab-roof-${x}`,
      part_id: "3020",
      color_name: "black",
      position: { x, y: 1, z: 11 },
      feature: "cab-roof",
      step: 7,
    }));
  }

  for (const [index, [x, y, colorName]] of [
    [1, 1, "blue"],
    [1, 4, "blue"],
    [6, 1, "red"],
    [6, 4, "red"],
  ].entries()) {
    bricks.push(brick({
      id: `emergency-light-${index}`,
      part_id: "3005",
      color_name: colorName,
      position: { x, y, z: 12 },
      feature: "emergency-light",
      step: 8,
    }));
  }
}

function addEquipmentBody(bricks, brick) {
  for (const y of [1, 4]) {
    bricks.push(
      brick({
        id: `equipment-front-${y}`,
        part_id: "3010",
        color_name: "red",
        position: { x: 8, y, z: 5 },
        rotation: 90,
        feature: "equipment-body",
        step: 5,
      }),
      brick({
        id: `compartment-large-${y}`,
        part_id: "3010",
        color_name: "dark gray",
        position: { x: 12, y, z: 5 },
        rotation: 90,
        feature: "equipment-compartment",
        step: 5,
      }),
    );

    for (const x of [18, 20, 22, 24, 26]) {
      const isCompartment = x === 22;
      bricks.push(brick({
        id: `equipment-side-${x}-${y}`,
        part_id: "3004",
        color_name: isCompartment ? "dark gray" : "red",
        position: { x, y, z: 5 },
        rotation: 90,
        feature: isCompartment ? "equipment-compartment" : "equipment-body",
        step: 5,
      }));
    }
  }

  for (const y of [1, 3]) {
    bricks.push(brick({
      id: `hose-reel-${y}`,
      part_id: "3003",
      color_name: "yellow",
      position: { x: 16, y, z: 5 },
      feature: "hose-reel",
      step: 5,
    }));
  }

  for (const y of [1, 3]) {
    bricks.push(brick({
      id: `equipment-roof-front-${y}`,
      part_id: "3795",
      color_name: "red",
      position: { x: 8, y, z: 8 },
      rotation: 90,
      feature: "equipment-body",
      step: 6,
    }));
  }

  for (const x of [14, 16, 18, 20, 22, 24, 26]) {
    bricks.push(brick({
      id: `equipment-roof-center-black-${x}`,
      part_id: "3020",
      color_name: "black",
      position: { x, y: 1, z: 8 },
      feature: "equipment-roof",
      step: 6,
    }));
  }
}

function addRoofLadderAndRearDetails(bricks, brick) {
  for (const y of [1, 4]) {
    bricks.push(brick({
      id: `ladder-rail-${y}`,
      part_id: "6112",
      color_name: "white",
      position: { x: 10, y, z: 9 },
      rotation: 90,
      feature: "roof-ladder",
      step: 7,
    }));
  }

  for (const x of [11, 15, 19]) {
    bricks.push(brick({
      id: `ladder-rung-${x}`,
      part_id: "3710",
      color_name: "white",
      position: { x, y: 1, z: 12 },
      feature: "roof-ladder",
      step: 8,
    }));
  }

  for (const [index, [x, y, colorName]] of [
    [28, 1, "yellow"],
    [28, 3, "yellow"],
    [29, 1, "red"],
    [29, 3, "red"],
  ].entries()) {
    bricks.push(brick({
      id: `rear-marker-${index}`,
      part_id: colorName === "yellow" ? "3004" : "3005",
      color_name: colorName,
      position: { x, y, z: 5 },
      feature: "rear-platform",
      step: 5,
    }));
  }

  for (let x = 14; x < 22; x += 1) {
    bricks.push(brick({
      id: `roof-walkway-${x}`,
      part_id: "3023",
      color_name: "red",
      position: { x, y: 2, z: 9 },
      feature: "equipment-roof",
      step: 7,
    }));
  }

  for (const [index, [x, y]] of [
    [4, 0],
    [4, 5],
    [24, 0],
    [24, 5],
  ].entries()) {
    bricks.push(brick({
      id: `wheel-hub-${index}`,
      part_id: "3005",
      color_name: "dark gray",
      position: { x, y, z: 9 },
      feature: "wheel-rim",
      step: 6,
    }));
  }

  for (const y of [1, 4]) {
    bricks.push(brick({
      id: `cab-roof-detail-${y}`,
      part_id: "3005",
      color_name: "black",
      position: { x: 0, y, z: 12 },
      feature: "cab-roof",
      step: 8,
    }));
  }

  bricks.push(brick({
    id: "roof-hose-nozzle",
    part_id: "3004",
    color_name: "yellow",
    position: { x: 22, y: 2, z: 9 },
    feature: "hose-reel",
    step: 7,
  }));

}

export function buildShowcaseFireEngineModel(inventory = fixedDemoInventory) {
  const bricks = [];
  const brick = createShowcaseBrickFactory(inventory, "Red Rescue Fire Engine");

  addChassisAndWheels(bricks, brick);
  addLowerBody(bricks, brick);
  addCab(bricks, brick);
  addEquipmentBody(bricks, brick);
  addRoofLadderAndRearDetails(bricks, brick);

  return completeShowcaseModel({
    modelName: "Red Rescue Fire Engine",
    prompt: "Build a detailed red fire engine with a glazed cab, grille, headlights, block wheels, equipment compartments, hose reels, emergency lights, and a white roof ladder.",
    generatorVersion: "showcase-fire-engine-v1",
    inventory,
    bricks,
    notes: [
      "Inventory-safe rescue vehicle with a long connected chassis and layered equipment body.",
      "Ordered from chassis and wheels through cab, compartments, lights, hose reels, and ladder.",
    ],
  });
}
