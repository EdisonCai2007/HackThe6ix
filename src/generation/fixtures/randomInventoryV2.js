import { SUPPORTED_PARTS } from "../partCatalog.js";

const COLORS = {
  black: { color_name: "black", color_id: "0" },
  white: { color_name: "white", color_id: "15" },
  red: { color_name: "red", color_id: "4" },
};

const INVENTORY_PLAN = [
  ["3035", "black", 4],
  ["3020", "black", 8],
  ["3031", "black", 4],
  ["3005", "black", 24],

  ["3034", "red", 8],
  ["3003", "red", 32],
  ["3023", "red", 12],

  ["3023", "white", 4],
];

function itemFor(partId, colorName, count) {
  const part = SUPPORTED_PARTS[partId];
  const color = COLORS[colorName];

  if (!part) {
    throw new Error(`Random inventory V2 references unsupported part ${partId}.`);
  }

  if (!color) {
    throw new Error(`Random inventory V2 references unsupported color ${colorName}.`);
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

/** @type {import("../types.js").Inventory} */
export const randomInventoryV2 = {
  inventory_id: "random-inventory-v2",
  source: "manual_mailbox_fixture",
  items: INVENTORY_PLAN.map(([partId, colorName, count]) =>
    itemFor(partId, colorName, count),
  ),
};
