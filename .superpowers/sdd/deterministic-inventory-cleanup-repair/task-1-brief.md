### Task 1: Deterministic Inventory Cleanup Helper

**Files:**
- Create: `src/generation/inventoryCleanup.js`
- Create: `test/generation/inventoryCleanup.test.js`

**Interfaces:**
- Consumes: `SUPPORTED_PARTS` from `src/generation/partCatalog.js`; `GeneratedModel` and `Inventory` shapes from existing typedefs.
- Produces:
  - `cleanupIllegalInventoryUsage(model, inventory): { model: GeneratedModel, removedBricks: RemovedBrick[] }`
  - `RemovedBrick` fields: `id`, `feature`, `part_id`, `color_id`, `reason`, `message`

- [ ] **Step 1: Write failing cleanup tests**

Create `test/generation/inventoryCleanup.test.js`:

```js
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { cleanupIllegalInventoryUsage } from "../../src/generation/inventoryCleanup.js";

const baseModel = {
  model_name: "Tiny Test",
  prompt: "build me a tiny test",
  piece_count: 1,
  dimensions: { width_studs: 4, depth_studs: 4, height_layers: 3 },
  created_from_inventory_id: "test-inventory",
  generator_version: "test",
  bricks: [
    {
      id: "body-1",
      part_id: "3001",
      ldraw_id: "3001.dat",
      label: "2x4 brick",
      color_id: "14",
      color_name: "yellow",
      position: { x: 0, y: 0, z: 0 },
      rotation: 0,
      feature: "body",
      step: 1,
    },
  ],
  notes: ["test model"],
};

const inventory = {
  inventory_id: "test-inventory",
  source: "manual_test_fixture",
  items: [
    {
      label: "2x4 brick",
      category: "brick",
      part_id: "3001",
      ldraw_id: "3001.dat",
      color_name: "yellow",
      color_id: "14",
      count: 1,
      supported: true,
    },
    {
      label: "1x2 plate",
      category: "plate",
      part_id: "3023",
      ldraw_id: "3023.dat",
      color_name: "white",
      color_id: "15",
      count: 1,
      supported: true,
    },
  ],
};

function withBricks(bricks) {
  return {
    ...baseModel,
    piece_count: bricks.length,
    bricks,
  };
}

describe("cleanupIllegalInventoryUsage", () => {
  it("removes unsupported part ids and reports the removed feature", () => {
    const illegalBrick = {
      ...baseModel.bricks[0],
      id: "fake-eye",
      part_id: "9999",
      ldraw_id: "9999.dat",
      feature: "eye",
    };

    const result = cleanupIllegalInventoryUsage(withBricks([illegalBrick]), inventory);

    assert.deepEqual(result.model.bricks, []);
    assert.equal(result.model.piece_count, 0);
    assert.deepEqual(result.removedBricks, [
      {
        id: "fake-eye",
        feature: "eye",
        part_id: "9999",
        color_id: "14",
        reason: "unsupported_part",
        message: "fake-eye uses unsupported part 9999.",
      },
    ]);
  });

  it("removes supported part/color combinations absent from inventory", () => {
    const absentColorBrick = {
      ...baseModel.bricks[0],
      id: "red-body",
      color_id: "4",
      color_name: "red",
    };

    const result = cleanupIllegalInventoryUsage(withBricks([absentColorBrick]), inventory);

    assert.deepEqual(result.model.bricks, []);
    assert.equal(result.removedBricks[0].reason, "inventory_missing");
    assert.equal(
      result.removedBricks[0].message,
      "red-body uses part 3001 color 4, which is not in the confirmed supported inventory.",
    );
  });

  it("keeps the first allowed bricks and removes later excess bricks by model order", () => {
    const first = { ...baseModel.bricks[0], id: "body-1" };
    const second = { ...baseModel.bricks[0], id: "body-2", position: { x: 0, y: 0, z: 3 } };
    const third = { ...baseModel.bricks[0], id: "body-3", position: { x: 0, y: 0, z: 6 } };

    const result = cleanupIllegalInventoryUsage(withBricks([first, second, third]), inventory);

    assert.deepEqual(
      result.model.bricks.map((brick) => brick.id),
      ["body-1"],
    );
    assert.equal(result.model.piece_count, 1);
    assert.deepEqual(
      result.removedBricks.map((brick) => brick.id),
      ["body-2", "body-3"],
    );
    assert.deepEqual(
      result.removedBricks.map((brick) => brick.reason),
      ["inventory_exceeded", "inventory_exceeded"],
    );
  });

  it("leaves legal inventory usage unchanged", () => {
    const result = cleanupIllegalInventoryUsage(baseModel, inventory);

    assert.deepEqual(result.model, baseModel);
    assert.deepEqual(result.removedBricks, []);
  });
});
```

- [ ] **Step 2: Run the new tests to verify they fail**

Run: `node --test test/generation/inventoryCleanup.test.js`

Expected: FAIL with a module resolution error for `src/generation/inventoryCleanup.js`.

- [ ] **Step 3: Implement cleanup helper**

Create `src/generation/inventoryCleanup.js`:

```js
import { SUPPORTED_PARTS } from "./partCatalog.js";

function keyFor(partId, colorId) {
  return `${partId}:${colorId}`;
}

function buildAvailableInventory(inventory) {
  const available = new Map();

  for (const item of inventory.items) {
    if (!item.supported || !SUPPORTED_PARTS[item.part_id]) {
      continue;
    }

    const key = keyFor(item.part_id, item.color_id);
    available.set(key, (available.get(key) ?? 0) + item.count);
  }

  return available;
}

function removedBrickFor(brick, reason, message) {
  return {
    id: brick.id,
    feature: brick.feature,
    part_id: brick.part_id,
    color_id: brick.color_id,
    reason,
    message,
  };
}

export function cleanupIllegalInventoryUsage(model, inventory) {
  const available = buildAvailableInventory(inventory);
  const keptCounts = new Map();
  const keptBricks = [];
  const removedBricks = [];

  for (const brick of model.bricks) {
    if (!SUPPORTED_PARTS[brick.part_id]) {
      removedBricks.push(
        removedBrickFor(
          brick,
          "unsupported_part",
          `${brick.id} uses unsupported part ${brick.part_id}.`,
        ),
      );
      continue;
    }

    const inventoryKey = keyFor(brick.part_id, brick.color_id);
    const availableCount = available.get(inventoryKey) ?? 0;

    if (availableCount === 0) {
      removedBricks.push(
        removedBrickFor(
          brick,
          "inventory_missing",
          `${brick.id} uses part ${brick.part_id} color ${brick.color_id}, which is not in the confirmed supported inventory.`,
        ),
      );
      continue;
    }

    const keptCount = keptCounts.get(inventoryKey) ?? 0;

    if (keptCount >= availableCount) {
      removedBricks.push(
        removedBrickFor(
          brick,
          "inventory_exceeded",
          `${brick.id} exceeds available inventory for part ${brick.part_id} color ${brick.color_id}.`,
        ),
      );
      continue;
    }

    keptCounts.set(inventoryKey, keptCount + 1);
    keptBricks.push(brick);
  }

  return {
    model: {
      ...model,
      piece_count: keptBricks.length,
      bricks: keptBricks,
    },
    removedBricks,
  };
}
```

- [ ] **Step 4: Run cleanup tests to verify they pass**

Run: `node --test test/generation/inventoryCleanup.test.js`

Expected: PASS, 4 tests pass.

- [ ] **Step 5: Run existing validator-adjacent tests**

Run: `node --test test/generation/validator.test.js test/generation/service.test.js`

Expected: PASS. If service tests fail because cleanup has not been wired yet, confirm failures are not in `validator.test.js`, then continue to Task 2.

- [ ] **Step 6: Commit Task 1**

Run:

```bash
git add src/generation/inventoryCleanup.js test/generation/inventoryCleanup.test.js
git commit -m "Add deterministic inventory cleanup"
```

Expected: commit succeeds. If `git status` reports this checkout is not a repository, record `commit blocked: not a git repository` and continue without fabricating a commit.

---

