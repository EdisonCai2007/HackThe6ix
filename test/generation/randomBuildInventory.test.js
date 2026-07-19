import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { randomBuildInventory } from "../../src/generation/fixtures/randomBuildInventory.js";
import { SUPPORTED_PARTS } from "../../src/generation/partCatalog.js";

const ALLOWED_COLORS = new Map([
  ["0", "black"],
  ["1", "blue"],
  ["2", "green"],
  ["4", "red"],
  ["6", "brown"],
  ["14", "yellow"],
  ["15", "white"],
]);

function totalPieceCount(inventory) {
  return inventory.items.reduce((total, item) => total + item.count, 0);
}

function countsBy(inventory, key) {
  const counts = new Map();

  for (const item of inventory.items) {
    counts.set(item[key], (counts.get(item[key]) ?? 0) + item.count);
  }

  return counts;
}

function inventoryKey(partId, colorId) {
  return `${partId}:${colorId}`;
}

function expectedFullComboKeys() {
  return Object.keys(SUPPORTED_PARTS).flatMap((partId) =>
    [...ALLOWED_COLORS.keys()].map((colorId) => inventoryKey(partId, colorId)),
  );
}

function assertCatalogCompatibleItem(item) {
  const catalogPart = SUPPORTED_PARTS[item.part_id];

  assert.ok(catalogPart, `${item.part_id} should be in SUPPORTED_PARTS`);
  assert.equal(item.supported, true);
  assert.equal(item.label, catalogPart.label);
  assert.equal(item.category, catalogPart.category);
  assert.equal(item.ldraw_id, catalogPart.ldraw_id);
  assert.equal(item.rebrickable_part_num, item.part_id);
  assert.equal(item.color_name, ALLOWED_COLORS.get(item.color_id));
  assert.equal(Number.isInteger(item.count), true);
  assert.ok(item.count >= 0);
}

describe("randomBuildInventory", () => {
  it("provides every supported part and color in a weighted 500-piece assortment", () => {
    assert.equal(randomBuildInventory.inventory_id, "random-build-assortment");
    assert.equal(randomBuildInventory.source, "manual_test_fixture");
    assert.equal(totalPieceCount(randomBuildInventory), 500);
    assert.equal(
      randomBuildInventory.items.length,
      Object.keys(SUPPORTED_PARTS).length * ALLOWED_COLORS.size,
    );

    const usedPartIds = new Set();
    const usedColorIds = new Set();
    const seenCombos = new Map();

    for (const item of randomBuildInventory.items) {
      assertCatalogCompatibleItem(item);

      const key = inventoryKey(item.part_id, item.color_id);
      assert.equal(seenCombos.has(key), false, `${key} should only appear once`);
      seenCombos.set(key, item.count);
      usedPartIds.add(item.part_id);
      usedColorIds.add(item.color_id);
    }

    assert.deepEqual(
      [...usedPartIds].sort(),
      Object.keys(SUPPORTED_PARTS).sort(),
    );
    assert.deepEqual([...usedColorIds].sort(), [...ALLOWED_COLORS.keys()].sort());
    assert.deepEqual([...seenCombos.keys()].sort(), expectedFullComboKeys().sort());

    const categoryCounts = countsBy(randomBuildInventory, "category");
    assert.equal(categoryCounts.get("brick"), 350);
    assert.equal(categoryCounts.get("plate"), 150);

    const colorCounts = [...countsBy(randomBuildInventory, "color_id").values()];
    assert.equal(colorCounts.length, ALLOWED_COLORS.size);
    assert.ok(Math.max(...colorCounts) - Math.min(...colorCounts) >= 80);
    assert.ok([...seenCombos.values()].some((count) => count === 0));
    assert.ok(Math.max(...seenCombos.values()) >= 40);
  });

  it("is available from the preview inventory selector", () => {
    const previewSource = readFileSync(
      new URL("../../src/preview/main.js", import.meta.url),
      "utf8",
    );

    assert.match(previewSource, /randomBuildInventory/);
    assert.match(previewSource, /Random build assortment/);
  });
});
