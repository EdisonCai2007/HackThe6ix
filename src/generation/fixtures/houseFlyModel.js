import { getPartDimensions } from "../partCatalog.js";
import { houseFlyInventory } from "./houseFlyInventory.js";

function placed({
  id,
  part_id,
  label,
  color_id,
  color_name,
  position,
  rotation = 0,
  feature,
  step,
}) {
  return {
    id,
    part_id,
    ldraw_id: `${part_id}.dat`,
    label,
    color_id,
    color_name,
    position,
    rotation,
    feature,
    step,
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

function bodyBrick(props) {
  return placed({
    color_id: props.color_id ?? "0",
    color_name: props.color_name ?? "black",
    ...props,
  });
}

function addBodyBase(bricks) {
  const base = [
    { id: "head-base-left", part_id: "3003", label: "2x2 brick", x: 4, y: 0, color_id: "0", color_name: "black" },
    { id: "head-base-right", part_id: "3003", label: "2x2 brick", x: 6, y: 0, color_id: "0", color_name: "black" },
    { id: "thorax-base", part_id: "3001", label: "2x4 brick", x: 4, y: 2, rotation: 90, color_id: "72", color_name: "dark bluish gray" },
    { id: "abdomen-base-1", part_id: "3001", label: "2x4 brick", x: 4, y: 4, rotation: 90, color_id: "72", color_name: "dark bluish gray" },
    { id: "abdomen-base-2", part_id: "3001", label: "2x4 brick", x: 4, y: 6, rotation: 90, color_id: "72", color_name: "dark bluish gray" },
    { id: "abdomen-rear-base", part_id: "3001", label: "2x4 brick", x: 4, y: 8, rotation: 90, color_id: "0", color_name: "black" },
  ];

  for (const item of base) {
    bricks.push(
      bodyBrick({
        id: item.id,
        part_id: item.part_id,
        label: item.label,
        color_id: item.color_id,
        color_name: item.color_name,
        position: { x: item.x, y: item.y, z: 0 },
        rotation: item.rotation ?? 0,
        feature: "body",
        step: 1,
      }),
    );
  }
}

function addLegsAndAntennae(bricks) {
  const legPairs = [
    { y: 2, name: "front" },
    { y: 5, name: "middle" },
    { y: 8, name: "rear" },
  ];

  for (const { y, name } of legPairs) {
    bricks.push(
      bodyBrick({
        id: `leg-left-${name}`,
        part_id: "3004",
        label: "1x2 brick",
        position: { x: 2, y, z: 0 },
        rotation: 90,
        feature: "leg",
        step: 2,
      }),
      bodyBrick({
        id: `leg-right-${name}`,
        part_id: "3004",
        label: "1x2 brick",
        position: { x: 8, y, z: 0 },
        rotation: 90,
        feature: "leg",
        step: 2,
      }),
      bodyBrick({
        id: `foot-left-${name}`,
        part_id: "3005",
        label: "1x1 brick",
        position: { x: 1, y, z: 0 },
        feature: "foot",
        step: 2,
      }),
      bodyBrick({
        id: `foot-right-${name}`,
        part_id: "3005",
        label: "1x1 brick",
        position: { x: 10, y, z: 0 },
        feature: "foot",
        step: 2,
      }),
    );
  }

  const antennae = [
    { id: "antenna-base-left", x: 4, y: -1 },
    { id: "antenna-base-right", x: 7, y: -1 },
    { id: "antenna-tip-left", x: 4, y: -2 },
    { id: "antenna-tip-right", x: 7, y: -2 },
  ];

  for (const antenna of antennae) {
    bricks.push(
      bodyBrick({
        id: antenna.id,
        part_id: "3005",
        label: "1x1 brick",
        position: { x: antenna.x, y: antenna.y, z: 0 },
        feature: "antenna",
        step: 2,
      }),
    );
  }

  bricks.push(
    bodyBrick({
      id: "mouthpart",
      part_id: "3004",
      label: "1x2 brick",
      position: { x: 5, y: -2, z: 0 },
      rotation: 90,
      feature: "mouthpart",
      step: 2,
    }),
  );
}

function addUpperBodyAndEyes(bricks) {
  const upperBody = [
    { id: "head-crown", part_id: "3003", label: "2x2 brick", x: 5, y: 0, color_id: "0", color_name: "black" },
    { id: "thorax-left", part_id: "3003", label: "2x2 brick", x: 4, y: 2, color_id: "72", color_name: "dark bluish gray" },
    { id: "thorax-right", part_id: "3003", label: "2x2 brick", x: 6, y: 2, color_id: "72", color_name: "dark bluish gray" },
    { id: "abdomen-left-1", part_id: "3003", label: "2x2 brick", x: 4, y: 4, color_id: "72", color_name: "dark bluish gray" },
    { id: "abdomen-right-1", part_id: "3003", label: "2x2 brick", x: 6, y: 4, color_id: "72", color_name: "dark bluish gray" },
    { id: "abdomen-left-2", part_id: "3003", label: "2x2 brick", x: 4, y: 6, color_id: "0", color_name: "black" },
    { id: "abdomen-right-2", part_id: "3003", label: "2x2 brick", x: 6, y: 6, color_id: "0", color_name: "black" },
    { id: "rear-left", part_id: "3003", label: "2x2 brick", x: 4, y: 8, color_id: "0", color_name: "black" },
    { id: "rear-right", part_id: "3003", label: "2x2 brick", x: 6, y: 8, color_id: "0", color_name: "black" },
  ];

  for (const item of upperBody) {
    bricks.push(
      bodyBrick({
        id: item.id,
        part_id: item.part_id,
        label: item.label,
        color_id: item.color_id,
        color_name: item.color_name,
        position: { x: item.x, y: item.y, z: 3 },
        feature: "body",
        step: 3,
      }),
    );
  }

  bricks.push(
    placed({
      id: "eye-left",
      part_id: "3004",
      label: "1x2 brick",
      color_id: "4",
      color_name: "red",
      position: { x: 4, y: -1, z: 3 },
      feature: "eye",
      step: 3,
    }),
    placed({
      id: "eye-right",
      part_id: "3004",
      label: "1x2 brick",
      color_id: "4",
      color_name: "red",
      position: { x: 7, y: -1, z: 3 },
      feature: "eye",
      step: 3,
    }),
  );
}

function addWings(bricks) {
  const wingPieces = [
    { id: "wing-left-front", part_id: "3020", label: "2x4 plate", x: 1, y: 2, rotation: 90 },
    { id: "wing-right-front", part_id: "3020", label: "2x4 plate", x: 7, y: 2, rotation: 90 },
    { id: "wing-left-middle", part_id: "3020", label: "2x4 plate", x: 1, y: 4, rotation: 90 },
    { id: "wing-right-middle", part_id: "3020", label: "2x4 plate", x: 7, y: 4, rotation: 90 },
    { id: "wing-left-rear", part_id: "3020", label: "2x4 plate", x: 1, y: 6, rotation: 90 },
    { id: "wing-right-rear", part_id: "3020", label: "2x4 plate", x: 7, y: 6, rotation: 90 },
    { id: "wing-left-tip", part_id: "3022", label: "2x2 plate", x: 3, y: 8 },
    { id: "wing-right-tip", part_id: "3022", label: "2x2 plate", x: 7, y: 8 },
  ];

  for (const item of wingPieces) {
    bricks.push(
      placed({
        id: item.id,
        part_id: item.part_id,
        label: item.label,
        color_id: "43",
        color_name: "translucent light blue",
        position: { x: item.x, y: item.y, z: 6 },
        rotation: item.rotation ?? 0,
        feature: "wing",
        step: 4,
      }),
    );
  }
}

function addBodyStripes(bricks) {
  const stripePositions = [
    { x: 5, y: 2 },
    { x: 5, y: 3 },
    { x: 5, y: 4 },
    { x: 5, y: 5 },
    { x: 5, y: 6 },
    { x: 5, y: 7 },
    { x: 5, y: 8 },
    { x: 5, y: 9 },
  ];

  for (const [index, position] of stripePositions.entries()) {
    bricks.push(
      bodyBrick({
        id: `body-stripe-${index}`,
        part_id: "3004",
        label: "1x2 brick",
        position: { ...position, z: 6 },
        rotation: 90,
        feature: "body-stripe",
        step: 5,
      }),
    );
  }
}

/**
 * Deterministic 50-piece common house fly model with red eyes, wings, and legs.
 *
 * @param {import("../types.js").Inventory} inventory
 * @returns {import("../types.js").GeneratedModel}
 */
export function buildHouseFlyModel(inventory = houseFlyInventory) {
  const bricks = [];

  addBodyBase(bricks);
  addLegsAndAntennae(bricks);
  addUpperBodyAndEyes(bricks);
  addWings(bricks);
  addBodyStripes(bricks);

  return {
    model_name: "Common House Fly",
    prompt: "build me a common house fly with red eyes, wings, and legs",
    piece_count: bricks.length,
    dimensions: dimensionsFor(bricks),
    created_from_inventory_id: inventory.inventory_id,
    generator_version: "mvp-house-fly",
    bricks,
    notes: [
      "Blocky common house fly using rectangular MVP parts only.",
      "Includes red compound eyes, translucent wing panels, six legs, antennae, and body striping.",
      "Kept at exactly 50 pieces to stay inside the current validator maximum.",
    ],
  };
}
