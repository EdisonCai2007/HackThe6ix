import { getPartDimensions } from "../partCatalog.js";
import { randomBuildInventory } from "./randomBuildInventory.js";

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
        `Castle gate requires ${color_name} part ${part_id}, which is not in inventory ${inventory.inventory_id}.`,
      );
    }

    const nextUsedCount = (used.get(key) ?? 0) + 1;

    if (nextUsedCount > item.count) {
      throw new Error(
        `Castle gate requires ${nextUsedCount} ${color_name} ${item.label}s, but inventory ${inventory.inventory_id} only has ${item.count}.`,
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

function addApproach(bricks, brick) {
  for (const y of [-2, 6, 14, 22]) {
    for (const x of [12, 16]) {
      bricks.push(
        brick({
          id: `approach-plate-${x}-${y}`,
          part_id: "3035",
          color_name: "green",
          position: { x, y, z: 0 },
          feature: "approach-path",
          step: 1,
        }),
      );
    }
  }

  for (const y of [4, 12, 20]) {
    for (const x of [13, 17]) {
      bricks.push(
        brick({
          id: `approach-longitudinal-tie-${x}-${y}`,
          part_id: "3001",
          color_name: "green",
          position: { x, y, z: 1 },
          feature: "approach-path",
          step: 2,
        }),
      );
    }
  }

  for (const y of [0, 8, 16, 24]) {
    bricks.push(
      brick({
        id: `approach-cross-tie-${y}`,
        part_id: "3001",
        color_name: "green",
        position: { x: 14, y, z: 1 },
        rotation: 90,
        feature: "approach-path",
        step: 2,
      }),
    );
  }

  bricks.push(
    brick({
      id: "approach-gate-tie",
      part_id: "3001",
      color_name: "green",
      position: { x: 15, y: 28, z: 1 },
      feature: "approach-path",
      step: 2,
    }),
  );
}

function addFoundation(bricks, brick) {
  for (let x = 0; x < 32; x += 4) {
    bricks.push(
      brick({
        id: `foundation-plate-${x}`,
        part_id: "3032",
        color_name: "brown",
        position: { x, y: 30, z: 0 },
        feature: "wall-foundation",
        step: 3,
      }),
    );
  }

  for (let seam = 4; seam < 32; seam += 4) {
    bricks.push(
      brick({
        id: `foundation-tie-${seam}`,
        part_id: "3003",
        color_name: "brown",
        position: { x: seam - 1, y: 32, z: 1 },
        feature: "wall-foundation",
        step: 4,
      }),
    );
  }
}

function addWallPiece(bricks, brick, {
  id,
  part_id,
  color_name,
  x,
  y = 32,
  z,
  rotation = 0,
  feature,
  step,
}) {
  bricks.push(
    brick({
      id,
      part_id,
      color_name,
      position: { x, y, z },
      rotation,
      feature,
      step,
    }),
  );
}

function addWallSideSections(bricks, brick, z, course) {
  const step = course + 4;
  const placements = [
    ["west-tower", "3008", "brown", 0, 90, "tower"],
    ["west-panel-outer", "3004", "white", 8, 90, "wall-panel"],
    ["west-panel-inner", "3004", "white", 10, 90, "wall-panel"],
    ["east-panel-inner", "3004", "white", 20, 90, "wall-panel"],
    ["east-panel-outer", "3004", "white", 22, 90, "wall-panel"],
    ["east-tower", "3008", "brown", 24, 90, "tower"],
  ];

  for (const [id, part_id, color_name, x, rotation, feature] of placements) {
    addWallPiece(bricks, brick, {
      id: `${id}-course-${course}`,
      part_id,
      color_name,
      x,
      z,
      rotation,
      feature,
      step,
    });
  }
}

function addWall(bricks, brick) {
  for (const [course, z] of [
    [1, 4],
    [2, 7],
    [3, 10],
  ]) {
    addWallSideSections(bricks, brick, z, course);

    for (const [side, x] of [["west", 12], ["east", 19]]) {
      addWallPiece(bricks, brick, {
        id: `gate-jamb-${side}-course-${course}`,
        part_id: "3008",
        color_name: "brown",
        x,
        y: 30,
        z,
        feature: "gate-jamb",
        step: course + 4,
      });
    }
  }

  for (const [course, z] of [
    [4, 13],
    [5, 16],
  ]) {
    addWallSideSections(bricks, brick, z, course);
    addWallPiece(bricks, brick, {
      id: `gate-lintel-course-${course}`,
      part_id: "3008",
      color_name: "brown",
      x: 12,
      z,
      rotation: 90,
      feature: "gate-lintel",
      step: course + 4,
    });
  }
}

function addBattlements(bricks, brick) {
  for (let x = 0; x < 32; x += 2) {
    bricks.push(
      brick({
        id: `battlement-${x}`,
        part_id: "3005",
        color_name: "black",
        position: { x, y: 32, z: 19 },
        feature: "battlement",
        step: 10,
      }),
    );
  }
}

function addFlags(bricks, brick) {
  for (const [side, poleX, flagX] of [
    ["west", 2, 2],
    ["east", 28, 27],
  ]) {
    for (const z of [22, 25]) {
      bricks.push(
        brick({
          id: `flagpole-${side}-${z}`,
          part_id: "3005",
          color_name: "black",
          position: { x: poleX, y: 32, z },
          feature: "flagpole",
          step: 11,
        }),
      );
    }

    for (const [index, [part_id, z]] of [
      ["3021", 28],
      ["3021", 29],
      ["3022", 30],
      ["3022", 31],
    ].entries()) {
      bricks.push(
        brick({
          id: `flag-${side}-${index}`,
          part_id,
          color_name: "red",
          position: { x: flagX, y: 32, z },
          feature: "flag",
          step: 12,
        }),
      );
    }
  }
}

/**
 * Deterministic 100-piece castle gate with a connected approach and two flags.
 *
 * @param {import("../types.js").Inventory} inventory
 * @returns {import("../types.js").GeneratedModel}
 */
export function buildCastleGateModel(inventory = randomBuildInventory) {
  const bricks = [];
  const brick = createBrickFactory(inventory);

  addApproach(bricks, brick);
  addFoundation(bricks, brick);
  addWall(bricks, brick);
  addBattlements(bricks, brick);
  addFlags(bricks, brick);

  return {
    model_name: "Royal Castle Gate",
    prompt: "Castle gate: brown/white wall massing, black battlements, red flags, green approach path.",
    piece_count: bricks.length,
    dimensions: dimensionsFor(bricks),
    created_from_inventory_id: inventory.inventory_id,
    generator_version: "mvp-castle-gate-v1",
    bricks,
    notes: [
      "A tied green plate road forms an eight-stud-wide approach to the gate.",
      "Brown towers and deep jambs frame white wall panels around a six-stud opening.",
      "A double-course lintel carries sixteen black battlements and two raised red flags.",
      "Uses the 100-piece model maximum with only pieces from the random build inventory.",
    ],
  };
}
