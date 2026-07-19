import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { fixedDemoInventory } from "../../src/generation/fixtures/fixedDemoInventory.js";
import { SUPPORTED_PARTS } from "../../src/generation/partCatalog.js";

describe("fixed demo inventory", () => {
  it("preserves every confirmed CSV row and piece count", () => {
    assert.equal(fixedDemoInventory.items.length, 147);
    assert.equal(
      fixedDemoInventory.items.reduce((total, item) => total + item.count, 0),
      787,
    );
  });

  it("maps all 32 physical footprints into the supported catalog", () => {
    const partIds = new Set(fixedDemoInventory.items.map((item) => item.part_id));

    assert.equal(partIds.size, 32);
    assert.equal(
      fixedDemoInventory.items.every((item) => item.supported && SUPPORTED_PARTS[item.part_id]),
      true,
    );
  });

  it("preserves exact part and color totals", () => {
    const count = (partId, colorName) => fixedDemoInventory.items.find(
      (item) => item.part_id === partId && item.color_name === colorName,
    )?.count;

    assert.equal(count("3005", "red"), 30);
    assert.equal(count("3004", "beige"), 8);
    assert.equal(count("3033", "dark green"), 1);
  });
});
