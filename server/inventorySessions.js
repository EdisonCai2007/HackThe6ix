import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const INVENTORY_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

function assertInventoryShape(inventory) {
  if (!inventory || typeof inventory !== "object" || !Array.isArray(inventory.items)) {
    throw new Error("inventory.items must be an array.");
  }
}

function assertSafeInventoryId(inventoryId) {
  if (typeof inventoryId !== "string" || inventoryId.trim() === "") {
    throw new Error("inventory_id must be a non-empty string.");
  }

  if (!INVENTORY_ID_PATTERN.test(inventoryId)) {
    throw new Error("inventory_id contains unsupported characters.");
  }
}

function defaultCreateId() {
  return `inv_${randomUUID().replaceAll("-", "")}`;
}

export function createInventorySessionStore({
  rootDir = process.env.INVENTORY_SESSION_DIR ?? "data/inventories",
  createId = defaultCreateId,
  now = () => new Date(),
} = {}) {
  async function create(inventory) {
    assertInventoryShape(inventory);

    const inventoryId = createId();
    assertSafeInventoryId(inventoryId);
    await mkdir(rootDir, { recursive: true });

    const createdAt = now().toISOString();
    const payload = {
      inventory_id: inventoryId,
      source_inventory_id: inventory.inventory_id ?? null,
      created_at: createdAt,
      inventory,
    };

    await writeFile(
      join(rootDir, `${inventoryId}.json`),
      `${JSON.stringify(payload, null, 2)}\n`,
      "utf8",
    );

    return {
      inventory_id: inventoryId,
      source_inventory_id: payload.source_inventory_id,
      item_count: inventory.items.length,
      created_at: createdAt,
    };
  }

  async function load(inventoryId) {
    assertSafeInventoryId(inventoryId);

    let parsed;

    try {
      parsed = JSON.parse(await readFile(join(rootDir, `${inventoryId}.json`), "utf8"));
    } catch (error) {
      if (error.code === "ENOENT") {
        throw new Error(`Inventory session ${inventoryId} was not found.`);
      }

      throw error;
    }

    assertInventoryShape(parsed.inventory);
    return parsed.inventory;
  }

  return { create, load };
}
