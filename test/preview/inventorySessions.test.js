import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { getInventorySessionId } from "../../src/preview/inventorySessions.js";

describe("preview inventory sessions", () => {
  it("uploads inventory once and returns the inventory session id", async () => {
    const inventory = { inventory_id: "duck-demo", items: [] };
    const requests = [];
    const fetchImpl = async (url, options) => {
      requests.push({ url, options });
      return {
        ok: true,
        async json() {
          return { ok: true, inventory_id: "inv_duck" };
        },
      };
    };

    const inventoryId = await getInventorySessionId(inventory, { fetchImpl });

    assert.equal(inventoryId, "inv_duck");
    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, "http://127.0.0.1:8787/api/inventory-sessions");
    assert.equal(requests[0].options.method, "POST");
    assert.deepEqual(JSON.parse(requests[0].options.body), { inventory });
  });

  it("reuses the cached inventory session id for the same inventory object", async () => {
    const inventory = { inventory_id: "duck-demo", items: [] };
    let requestCount = 0;
    const cache = new WeakMap();
    const fetchImpl = async () => {
      requestCount += 1;
      return {
        ok: true,
        async json() {
          return { ok: true, inventory_id: "inv_duck" };
        },
      };
    };

    assert.equal(await getInventorySessionId(inventory, { fetchImpl, cache }), "inv_duck");
    assert.equal(await getInventorySessionId(inventory, { fetchImpl, cache }), "inv_duck");
    assert.equal(requestCount, 1);
  });

  it("throws the server error when inventory upload fails", async () => {
    const inventory = { inventory_id: "bad", items: [] };
    const fetchImpl = async () => ({
      ok: false,
      async json() {
        return { ok: false, errors: ["inventory.items must be an array."] };
      },
    });

    await assert.rejects(
      () => getInventorySessionId(inventory, { fetchImpl }),
      /inventory.items must be an array/,
    );
  });
});
