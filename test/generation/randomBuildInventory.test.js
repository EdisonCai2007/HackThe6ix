import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { randomBuildInventory } from "../../src/generation/fixtures/randomBuildInventory.js";
import { SUPPORTED_PARTS } from "../../src/generation/partCatalog.js";

function totalPieceCount(inventory) {
  return inventory.items.reduce((total, item) => total + item.count, 0);
}

describe("randomBuildInventory", () => {
  it("provides a broad supported catalog-compatible assortment", () => {
    assert.equal(randomBuildInventory.inventory_id, "random-build-assortment");
    assert.equal(randomBuildInventory.source, "manual_test_fixture");
    assert.equal(totalPieceCount(randomBuildInventory), 85);

    const usedPartIds = new Set();
    const usedColorIds = new Set();

    for (const item of randomBuildInventory.items) {
      const catalogPart = SUPPORTED_PARTS[item.part_id];

      assert.ok(catalogPart, `${item.part_id} should be in SUPPORTED_PARTS`);
      assert.equal(item.supported, true);
      assert.equal(item.label, catalogPart.label);
      assert.equal(item.category, catalogPart.category);
      assert.equal(item.ldraw_id, catalogPart.ldraw_id);
      assert.equal(item.rebrickable_part_num, item.part_id);
      assert.ok(item.count > 0);

      usedPartIds.add(item.part_id);
      usedColorIds.add(item.color_id);
    }

    assert.deepEqual(
      [...usedPartIds].sort(),
      Object.keys(SUPPORTED_PARTS).sort(),
    );
    assert.ok(usedColorIds.size >= 8);
    assert.ok(randomBuildInventory.items.some((item) => item.part_id === "3031"));
    assert.ok(randomBuildInventory.items.some((item) => item.part_id === "3032"));
    assert.ok(randomBuildInventory.items.some((item) => item.part_id === "3035"));
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
