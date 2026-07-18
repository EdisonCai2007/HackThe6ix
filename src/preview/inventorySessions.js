const INVENTORY_SESSION_URL = "http://127.0.0.1:8787/api/inventory-sessions";

const defaultCache = new WeakMap();

function errorMessageFromPayload(payload) {
  if (Array.isArray(payload?.errors) && payload.errors.length > 0) {
    return payload.errors.join("\n");
  }

  return "Inventory upload failed.";
}

export async function getInventorySessionId(
  inventory,
  {
    fetchImpl = fetch,
    cache = defaultCache,
  } = {},
) {
  const cached = cache.get(inventory);

  if (cached) {
    return cached;
  }

  const response = await fetchImpl(INVENTORY_SESSION_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ inventory }),
  });
  const payload = await response.json();

  if (!response.ok || !payload?.ok || typeof payload.inventory_id !== "string") {
    throw new Error(errorMessageFromPayload(payload));
  }

  cache.set(inventory, payload.inventory_id);
  return payload.inventory_id;
}
