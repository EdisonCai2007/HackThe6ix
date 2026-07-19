import { getPartDimensions } from "../partCatalog.js";
import { randomBuildInventory } from "../fixtures/randomBuildInventory.js";

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
        `Traffic light requires ${color_name} part ${part_id}, which is not in inventory ${inventory.inventory_id}.`,
      );
    }

    const nextUsedCount = (used.get(key) ?? 0) + 1;

    if (nextUsedCount > item.count) {
      throw new Error(
        `Traffic light requires ${nextUsedCount} ${color_name} ${item.label}s, but inventory ${inventory.inventory_id} only has ${item.count}.`,
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

function addBaseAndPole(bricks, brick) {
  bricks.push(
    brick({
      id: "ground-base",
      part_id: "3035",
      color_name: "green",
      position: { x: 0, y: 0, z: 0 },
      feature: "base",
      step: 1,
    }),
  );

  for (let course = 0; course < 8; course += 1) {
    const z = 1 + course * 3;

    for (const x of [1, 2]) {
      for (const y of [3, 4]) {
        bricks.push(
          brick({
            id: `pole-${course + 1}-${x}-${y}`,
            part_id: "3005",
            color_name: "black",
            position: { x, y, z },
            feature: "pole",
            step: course + 2,
          }),
        );
      }
    }
  }
}

function addHousingShelf(bricks, brick) {
  for (const x of [1, 2]) {
    for (const [side, y] of [["south", 1], ["north", 4]]) {
      bricks.push(
        brick({
          id: `housing-flare-${side}-${x}`,
          part_id: "3623",
          color_name: "black",
          position: { x, y, z: 25 },
          feature: "signal-housing",
          step: 10,
        }),
      );
    }
  }

  for (const y of [1, 2, 4]) {
    for (const x of [0, 2]) {
      bricks.push(
        brick({
          id: `housing-shelf-${x}-${y}`,
          part_id: "3023",
          color_name: "black",
          position: { x, y, z: 26 },
          rotation: 90,
          feature: "signal-housing",
          step: 11,
        }),
      );
    }
  }
}

function addGreenSignal(bricks, brick) {
  for (let course = 0; course < 3; course += 1) {
    const z = 27 + course * 3;

    for (const x of [0, 2]) {
      for (const y of [0, 3]) {
        bricks.push(
          brick({
            id: `green-signal-${course + 1}-${x}-${y}`,
            part_id: "3002",
            color_name: "green",
            position: { x, y, z },
            feature: "green-signal",
            step: course + 12,
          }),
        );
      }
    }
  }
}

function addGreenYellowDivider(bricks, brick) {
  for (const [index, placement] of [
    { x: 0, y: 2 },
    { x: 1, y: 3 },
  ].entries()) {
    bricks.push(
      brick({
        id: `housing-divider-green-yellow-${index + 1}`,
        part_id: "3623",
        color_name: "black",
        position: { ...placement, z: 36 },
        rotation: 90,
        feature: "signal-housing",
        step: 15,
      }),
    );
  }
}

function addYellowSignal(bricks, brick) {
  for (let course = 0; course < 3; course += 1) {
    const z = 37 + course * 3;

    for (let x = 0; x < 4; x += 1) {
      bricks.push(
        brick({
          id: `yellow-signal-${course + 1}-${x}`,
          part_id: "3009",
          color_name: "yellow",
          position: { x, y: 0, z },
          feature: "yellow-signal",
          step: course + 16,
        }),
      );
    }
  }
}

function addYellowRedDivider(bricks, brick) {
  for (let x = 0; x < 4; x += 1) {
    bricks.push(
      brick({
        id: `housing-divider-red-lower-${x}`,
        part_id: "3623",
        color_name: "black",
        position: { x, y: 0, z: 46 },
        feature: "signal-housing",
        step: 19,
      }),
      brick({
        id: `housing-divider-red-upper-${x}`,
        part_id: "3023",
        color_name: "black",
        position: { x, y: 3, z: 46 },
        feature: "signal-housing",
        step: 19,
      }),
    );
  }
}

function addRedSignalAndCap(bricks, brick) {
  for (let course = 0; course < 2; course += 1) {
    const z = 47 + course * 3;

    for (let x = 0; x < 4; x += 1) {
      for (const y of [0, 3]) {
        bricks.push(
          brick({
            id: `red-signal-${course + 1}-${x}-${y}`,
            part_id: "3622",
            color_name: "red",
            position: { x, y, z },
            feature: "red-signal",
            step: course + 20,
          }),
        );
      }
    }
  }

  bricks.push(
    brick({
      id: "red-signal-crown",
      part_id: "3622",
      color_name: "red",
      position: { x: 0, y: 2, z: 53 },
      rotation: 90,
      feature: "red-signal",
      step: 22,
    }),
  );

  for (const [index, position] of [
    { x: 3, y: 1 },
    { x: 3, y: 4 },
    { x: 0, y: 5 },
  ].entries()) {
    bricks.push(
      brick({
        id: `housing-top-trim-${index + 1}`,
        part_id: "3005",
        color_name: "black",
        position: { ...position, z: 53 },
        feature: "signal-housing",
        step: 22,
      }),
    );
  }

  for (const x of [0, 1, 2]) {
    bricks.push(
      brick({
        id: `housing-cap-${x}`,
        part_id: "3005",
        color_name: "black",
        position: { x, y: 2, z: 56 },
        feature: "signal-housing",
        step: 23,
      }),
    );
  }
}

/**
 * Deterministic 100-piece traffic light with a black pole and signal housing.
 *
 * @param {import("../types.js").Inventory} inventory
 * @returns {import("../types.js").GeneratedModel}
 */
export function buildTrafficLightModel(inventory = randomBuildInventory) {
  const bricks = [];
  const brick = createBrickFactory(inventory);

  addBaseAndPole(bricks, brick);
  addHousingShelf(bricks, brick);
  addGreenSignal(bricks, brick);
  addGreenYellowDivider(bricks, brick);
  addYellowSignal(bricks, brick);
  addYellowRedDivider(bricks, brick);
  addRedSignalAndCap(bricks, brick);

  return {
    model_name: "Traffic Light",
    prompt: "Traffic light: black pole/body, red/yellow/green signal stack.",
    piece_count: bricks.length,
    dimensions: dimensionsFor(bricks),
    created_from_inventory_id: inventory.inventory_id,
    generator_version: "fixture-traffic-light-100",
    bricks,
    notes: [
      "Uses the 100-piece model maximum and every black piece in the random build inventory.",
      "A tall two-by-two black pole carries a flared black signal housing with reinforced dividers and cap.",
      "The signal stack is ordered green at the bottom, yellow in the middle, and red at the top.",
      "Every raised placement has direct stud support, and the full build is one connected component.",
    ],
  };
}
