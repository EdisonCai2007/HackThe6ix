import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, it } from "node:test";

import { createInventorySessionStore } from "../../server/inventorySessions.js";

describe("inventory session store", () => {
  it("stores exact inventory JSON and loads it by generated id", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "inventory-sessions-"));

    try {
      const store = createInventorySessionStore({
        rootDir,
        createId: () => "inv_test_123",
        now: () => new Date("2026-07-17T22:00:00.000Z"),
      });
      const inventory = {
        inventory_id: "house-fly-demo",
        source: "manual_test_fixture",
        items: [
          {
            part_id: "3001",
            ldraw_id: "3001.dat",
            color_name: "black",
            color_id: "0",
            count: 2,
            supported: true,
          },
        ],
      };

      const session = await store.create(inventory);
      const storedText = await readFile(join(rootDir, "inv_test_123.json"), "utf8");
      const loaded = await store.load("inv_test_123");

      assert.deepEqual(session, {
        inventory_id: "inv_test_123",
        source_inventory_id: "house-fly-demo",
        item_count: 1,
        created_at: "2026-07-17T22:00:00.000Z",
      });
      assert.deepEqual(JSON.parse(storedText).inventory, inventory);
      assert.deepEqual(loaded, inventory);
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it("rejects inventory without an items array", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "inventory-sessions-"));

    try {
      const store = createInventorySessionStore({ rootDir });

      await assert.rejects(
        () => store.create({ inventory_id: "bad" }),
        /inventory.items must be an array/,
      );
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it("rejects unsafe inventory session ids", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "inventory-sessions-"));

    try {
      const store = createInventorySessionStore({ rootDir });

      await assert.rejects(
        () => store.load("../secret"),
        /inventory_id contains unsupported characters/,
      );
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });
});
