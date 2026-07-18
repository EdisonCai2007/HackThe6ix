import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { countInventoryBricks } from "../../src/preview/inventoryPieceCount.js";

describe("preview inventory piece count", () => {
  it("totals the supported brick counts available in inventory", () => {
    const inventory = {
      items: [
        { count: 3, supported: true },
        { count: 4, supported: true },
        { count: 99, supported: false },
        { count: 0, supported: true },
        { supported: true },
      ],
    };

    assert.equal(countInventoryBricks(inventory), 7);
  });
});
