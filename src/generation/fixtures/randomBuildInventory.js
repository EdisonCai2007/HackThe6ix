import { SUPPORTED_PARTS } from "../partCatalog.js";

const COLORS = {
  black: { color_name: "black", color_id: "0" },
  white: { color_name: "white", color_id: "15" },
  red: { color_name: "red", color_id: "4" },
  blue: { color_name: "blue", color_id: "1" },
  yellow: { color_name: "yellow", color_id: "14" },
  brown: { color_name: "brown", color_id: "6" },
  green: { color_name: "green", color_id: "2" },
};

const INVENTORY_PLAN = [
  ["3005", "black", 45],
  ["3004", "black", 0],
  ["3622", "black", 7],
  ["3010", "black", 12],
  ["3009", "black", 0],
  ["3008", "black", 5],
  ["3003", "black", 2],
  ["3002", "black", 11],
  ["3001", "black", 0],
  ["3023", "black", 12],
  ["3623", "black", 13],
  ["3710", "black", 0],
  ["3666", "black", 4],
  ["3022", "black", 1],
  ["3021", "black", 0],
  ["3020", "black", 6],
  ["3795", "black", 0],
  ["3034", "black", 0],
  ["3031", "black", 2],
  ["3032", "black", 0],
  ["3035", "black", 2],

  ["3005", "blue", 2],
  ["3004", "blue", 0],
  ["3622", "blue", 6],
  ["3010", "blue", 39],
  ["3009", "blue", 0],
  ["3008", "blue", 4],
  ["3003", "blue", 1],
  ["3002", "blue", 0],
  ["3001", "blue", 10],
  ["3023", "blue", 0],
  ["3623", "blue", 2],
  ["3710", "blue", 3],
  ["3666", "blue", 0],
  ["3022", "blue", 0],
  ["3021", "blue", 1],
  ["3020", "blue", 11],
  ["3795", "blue", 10],
  ["3034", "blue", 0],
  ["3031", "blue", 0],
  ["3032", "blue", 3],
  ["3035", "blue", 0],

  ["3005", "white", 0],
  ["3004", "white", 40],
  ["3622", "white", 3],
  ["3010", "white", 0],
  ["3009", "white", 6],
  ["3008", "white", 0],
  ["3003", "white", 2],
  ["3002", "white", 1],
  ["3001", "white", 3],
  ["3023", "white", 3],
  ["3623", "white", 0],
  ["3710", "white", 5],
  ["3666", "white", 5],
  ["3022", "white", 0],
  ["3021", "white", 4],
  ["3020", "white", 0],
  ["3795", "white", 1],
  ["3034", "white", 2],
  ["3031", "white", 0],
  ["3032", "white", 4],
  ["3035", "white", 0],

  ["3005", "red", 6],
  ["3004", "red", 11],
  ["3622", "red", 18],
  ["3010", "red", 0],
  ["3009", "red", 2],
  ["3008", "red", 4],
  ["3003", "red", 0],
  ["3002", "red", 6],
  ["3001", "red", 3],
  ["3023", "red", 0],
  ["3623", "red", 3],
  ["3710", "red", 2],
  ["3666", "red", 0],
  ["3022", "red", 5],
  ["3021", "red", 5],
  ["3020", "red", 1],
  ["3795", "red", 0],
  ["3034", "red", 0],
  ["3031", "red", 2],
  ["3032", "red", 3],
  ["3035", "red", 0],

  ["3005", "yellow", 4],
  ["3004", "yellow", 0],
  ["3622", "yellow", 2],
  ["3010", "yellow", 8],
  ["3009", "yellow", 13],
  ["3008", "yellow", 0],
  ["3003", "yellow", 1],
  ["3002", "yellow", 3],
  ["3001", "yellow", 5],
  ["3023", "yellow", 1],
  ["3623", "yellow", 4],
  ["3710", "yellow", 0],
  ["3666", "yellow", 2],
  ["3022", "yellow", 0],
  ["3021", "yellow", 1],
  ["3020", "yellow", 3],
  ["3795", "yellow", 0],
  ["3034", "yellow", 0],
  ["3031", "yellow", 5],
  ["3032", "yellow", 0],
  ["3035", "yellow", 0],

  ["3005", "green", 0],
  ["3004", "green", 0],
  ["3622", "green", 0],
  ["3010", "green", 0],
  ["3009", "green", 0],
  ["3008", "green", 0],
  ["3003", "green", 0],
  ["3002", "green", 22],
  ["3001", "green", 11],
  ["3023", "green", 0],
  ["3623", "green", 0],
  ["3710", "green", 0],
  ["3666", "green", 0],
  ["3022", "green", 1],
  ["3021", "green", 0],
  ["3020", "green", 0],
  ["3795", "green", 0],
  ["3034", "green", 0],
  ["3031", "green", 2],
  ["3032", "green", 0],
  ["3035", "green", 8],

  ["3005", "brown", 0],
  ["3004", "brown", 1],
  ["3622", "brown", 0],
  ["3010", "brown", 0],
  ["3009", "brown", 0],
  ["3008", "brown", 19],
  ["3003", "brown", 12],
  ["3002", "brown", 0],
  ["3001", "brown", 0],
  ["3023", "brown", 0],
  ["3623", "brown", 0],
  ["3710", "brown", 0],
  ["3666", "brown", 0],
  ["3022", "brown", 0],
  ["3021", "brown", 0],
  ["3020", "brown", 0],
  ["3795", "brown", 0],
  ["3034", "brown", 0],
  ["3031", "brown", 0],
  ["3032", "brown", 8],
  ["3035", "brown", 0],
];

function itemFor(partId, colorName, count) {
  const part = SUPPORTED_PARTS[partId];
  const color = COLORS[colorName];

  if (!part) {
    throw new Error(`Random build inventory references unsupported part ${partId}.`);
  }

  if (!color) {
    throw new Error(`Random build inventory references unsupported color ${colorName}.`);
  }

  return {
    label: part.label,
    category: part.category,
    part_id: part.part_id,
    ldraw_id: part.ldraw_id,
    rebrickable_part_num: part.part_id,
    color_name: color.color_name,
    color_id: color.color_id,
    count,
    supported: true,
  };
}

function completeInventoryPlan() {
  const plannedCounts = new Map(
    INVENTORY_PLAN.map(([partId, colorName, count]) => [`${partId}:${colorName}`, count]),
  );

  return Object.keys(SUPPORTED_PARTS).flatMap((partId) =>
    Object.keys(COLORS).map((colorName) => [
      partId,
      colorName,
      plannedCounts.get(`${partId}:${colorName}`) ?? 0,
    ]),
  );
}

/** @type {import("../types.js").Inventory} */
export const randomBuildInventory = {
  inventory_id: "random-build-assortment",
  source: "manual_test_fixture",
  items: completeInventoryPlan().map(([partId, colorName, count]) =>
    itemFor(partId, colorName, count),
  ),
};
