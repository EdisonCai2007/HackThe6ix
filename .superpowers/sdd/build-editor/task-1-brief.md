### Task 1: Pure Editor Geometry

**Files:**
- Create: `src/preview/editorGeometry.js`
- Test: `test/preview/editorGeometry.test.js`

**Interfaces:**
- Consumes: `getPartDimensions(partId, rotation)` from `src/generation/partCatalog.js`
- Produces:
  - `STUD_LDU: 20`
  - `PLATE_UNIT_LDU: 8`
  - `snapGridPosition(position: {x:number,y:number,z:number}): {x:number,y:number,z:number}`
  - `isSnappedGridPosition(position: {x:number,y:number,z:number}): boolean`
  - `normalizedRotation(rotation: number): 0 | 90 | 180 | 270 | null`
  - `occupiedCellsForBrick(brick: PlacedBrick): Array<{x:number,y:number,z:number}>`
  - `findDropZForFootprint(brick: PlacedBrick, bricks: PlacedBrick[]): number`
  - `positionToLduCenter(brick: PlacedBrick): THREE-like {x:number,y:number,z:number}`

- [ ] **Step 1: Write failing geometry tests**

Create `test/preview/editorGeometry.test.js`:

```js
import assert from "node:assert/strict";
import test from "node:test";

import {
  findDropZForFootprint,
  isSnappedGridPosition,
  normalizedRotation,
  occupiedCellsForBrick,
  positionToLduCenter,
  snapGridPosition,
} from "../../src/preview/editorGeometry.js";

test("snapGridPosition rounds studs and plate layers", () => {
  assert.deepEqual(
    snapGridPosition({ x: 1.49, y: 2.51, z: 3.2 }),
    { x: 1, y: 3, z: 3 },
  );
});

test("isSnappedGridPosition rejects off-grid editor positions", () => {
  assert.equal(isSnappedGridPosition({ x: 1, y: 2, z: 3 }), true);
  assert.equal(isSnappedGridPosition({ x: 1.2, y: 2, z: 3 }), false);
  assert.equal(isSnappedGridPosition({ x: 1, y: 2.4, z: 3 }), false);
  assert.equal(isSnappedGridPosition({ x: 1, y: 2, z: 3.1 }), false);
});

test("normalizedRotation accepts only quarter turns", () => {
  assert.equal(normalizedRotation(0), 0);
  assert.equal(normalizedRotation(90), 90);
  assert.equal(normalizedRotation(450), 90);
  assert.equal(normalizedRotation(-90), 270);
  assert.equal(normalizedRotation(45), null);
});

test("occupiedCellsForBrick respects plate-unit part height", () => {
  const cells = occupiedCellsForBrick({
    id: "brick-1",
    part_id: "3004",
    position: { x: 2, y: 4, z: 1 },
    rotation: 0,
  });

  assert.equal(cells.length, 6);
  assert.deepEqual(cells[0], { x: 2, y: 4, z: 1 });
  assert.deepEqual(cells.at(-1), { x: 2, y: 5, z: 3 });
});

test("findDropZForFootprint places a brick on top of the highest overlapping stack", () => {
  const moving = {
    id: "moving",
    part_id: "3004",
    position: { x: 0, y: 0, z: 0 },
    rotation: 0,
  };
  const existing = [
    {
      id: "base",
      part_id: "3035",
      position: { x: 0, y: 0, z: 0 },
      rotation: 0,
    },
    {
      id: "upper",
      part_id: "3005",
      position: { x: 0, y: 0, z: 1 },
      rotation: 0,
    },
  ];

  assert.equal(findDropZForFootprint(moving, existing), 4);
});

test("positionToLduCenter converts grid anchor to visible center coordinates", () => {
  assert.deepEqual(
    positionToLduCenter({
      id: "plate",
      part_id: "3020",
      position: { x: 2, y: 3, z: 1 },
      rotation: 90,
    }),
    { x: 80, y: -12, z: 80 },
  );
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/preview/editorGeometry.test.js`

Expected: FAIL with module not found for `src/preview/editorGeometry.js`.

- [ ] **Step 3: Implement geometry helpers**

Create `src/preview/editorGeometry.js`:

```js
import { getPartDimensions, SUPPORTED_PARTS } from "../generation/partCatalog.js";

export const STUD_LDU = 20;
export const PLATE_UNIT_LDU = 8;

export function snapGridPosition(position) {
  return {
    x: Math.round(position.x),
    y: Math.round(position.y),
    z: Math.round(position.z),
  };
}

export function isSnappedGridPosition(position) {
  return Number.isInteger(position.x) &&
    Number.isInteger(position.y) &&
    Number.isInteger(position.z);
}

export function normalizedRotation(rotation) {
  const normalized = ((rotation % 360) + 360) % 360;
  return normalized % 90 === 0 ? normalized : null;
}

export function occupiedCellsForBrick(brick) {
  const dimensions = getPartDimensions(brick.part_id, brick.rotation);

  if (!dimensions) {
    return [];
  }

  const cells = [];

  for (let x = brick.position.x; x < brick.position.x + dimensions.width; x += 1) {
    for (let y = brick.position.y; y < brick.position.y + dimensions.depth; y += 1) {
      for (let z = brick.position.z; z < brick.position.z + dimensions.height; z += 1) {
        cells.push({ x, y, z });
      }
    }
  }

  return cells;
}

function footprintCells(brick) {
  const dimensions = getPartDimensions(brick.part_id, brick.rotation);

  if (!dimensions) {
    return [];
  }

  const cells = [];

  for (let x = brick.position.x; x < brick.position.x + dimensions.width; x += 1) {
    for (let y = brick.position.y; y < brick.position.y + dimensions.depth; y += 1) {
      cells.push({ x, y });
    }
  }

  return cells;
}

export function findDropZForFootprint(brick, bricks) {
  const movingFootprint = new Set(
    footprintCells(brick).map((cell) => `${cell.x},${cell.y}`),
  );
  let highestTop = 0;

  for (const existingBrick of bricks) {
    if (existingBrick.id === brick.id) {
      continue;
    }

    const dimensions = getPartDimensions(existingBrick.part_id, existingBrick.rotation);

    if (!dimensions) {
      continue;
    }

    const overlaps = footprintCells(existingBrick).some((cell) =>
      movingFootprint.has(`${cell.x},${cell.y}`),
    );

    if (overlaps) {
      highestTop = Math.max(
        highestTop,
        existingBrick.position.z + dimensions.height,
      );
    }
  }

  return highestTop;
}

function partHeightLdu(part) {
  return part.category === "plate" ? PLATE_UNIT_LDU : PLATE_UNIT_LDU * 3;
}

export function positionToLduCenter(brick) {
  const part = SUPPORTED_PARTS[brick.part_id];
  const dimensions = getPartDimensions(brick.part_id, brick.rotation);

  if (!part || !dimensions) {
    return { x: 0, y: 0, z: 0 };
  }

  return {
    x: (brick.position.x + dimensions.width / 2) * STUD_LDU,
    y: -(brick.position.z * PLATE_UNIT_LDU + partHeightLdu(part) / 2),
    z: (brick.position.y + dimensions.depth / 2) * STUD_LDU,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/preview/editorGeometry.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/preview/editorGeometry.js test/preview/editorGeometry.test.js
git commit -m "feat: add editor geometry helpers"
```

---

