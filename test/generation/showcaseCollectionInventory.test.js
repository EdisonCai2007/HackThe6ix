import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildShowcaseBonsaiModel } from "../../src/generation/fixtures/showcaseBonsaiModel.js";
import { buildShowcaseDuckModel } from "../../src/generation/fixtures/showcaseDuckModel.js";
import { buildShowcaseElectricGuitarModel } from "../../src/generation/fixtures/showcaseElectricGuitarModel.js";
import { fixedDemoInventory } from "../../src/generation/fixtures/fixedDemoInventory.js";

function inventoryKey({ part_id, color_id }) {
  return `${part_id}:${color_id}`;
}

describe("locked final showcase collection", () => {
  it("fits the guitar, bonsai, and duck into one exact physical inventory", () => {
    const models = [
      buildShowcaseElectricGuitarModel(),
      buildShowcaseBonsaiModel(),
      buildShowcaseDuckModel(),
    ];
    const available = new Map(
      fixedDemoInventory.items
        .filter(({ supported }) => supported)
        .map((item) => [inventoryKey(item), item.count]),
    );
    const used = new Map();

    for (const model of models) {
      for (const brick of model.bricks) {
        const key = inventoryKey(brick);
        used.set(key, (used.get(key) ?? 0) + 1);
      }
    }

    assert.equal(models.reduce((total, model) => total + model.piece_count, 0), 247);

    for (const [key, usedCount] of used) {
      assert.ok(available.has(key), `Collection uses unavailable exact pair ${key}.`);
      assert.ok(
        usedCount <= available.get(key),
        `Collection uses ${usedCount} of ${key}, but only ${available.get(key)} exist.`,
      );
    }
  });
});
