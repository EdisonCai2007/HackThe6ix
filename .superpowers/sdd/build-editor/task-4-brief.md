### Task 4: Per-Brick Three.js Scene Objects

**Files:**
- Create: `src/preview/brickScene.js`
- Modify: `src/preview/styles.css`

**Interfaces:**
- Consumes:
  - `SUPPORTED_PARTS`
  - `getPartDimensions(partId, rotation)`
  - `positionToLduCenter(brick)`
- Produces:
  - `createBrickScene(scene: THREE.Scene): BrickScene`
  - `BrickScene.setModel(model: GeneratedModel): void`
  - `BrickScene.updateBrick(brick: PlacedBrick): void`
  - `BrickScene.removeBrick(brickId: string): void`
  - `BrickScene.getBrickObject(brickId: string): THREE.Object3D | null`
  - `BrickScene.setSelectedBrick(brickId: string | null): void`
  - `BrickScene.setInvalidBrickIds(ids: string[]): void`
  - `BrickScene.dispose(): void`

- [ ] **Step 1: Create per-brick scene module**

Create `src/preview/brickScene.js`:

```js
import * as THREE from "three";

import { getPartDimensions, SUPPORTED_PARTS } from "../generation/partCatalog.js";
import { PLATE_UNIT_LDU, STUD_LDU, positionToLduCenter } from "./editorGeometry.js";

const COLOR_HEX = {
  0: 0x05131d,
  4: 0xc91a09,
  14: 0xf2cd37,
  15: 0xffffff,
  19: 0xe4cd9e,
  25: 0xfe8a18,
  43: 0xaeefec,
  72: 0x6c6e68,
};

function partHeightLdu(part) {
  return part.category === "plate" ? PLATE_UNIT_LDU : PLATE_UNIT_LDU * 3;
}

function materialForBrick(brick) {
  const transparent = brick.color_id === "43";

  return new THREE.MeshStandardMaterial({
    color: COLOR_HEX[brick.color_id] ?? 0xd9d9d9,
    roughness: 0.46,
    metalness: 0.02,
    transparent,
    opacity: transparent ? 0.62 : 1,
  });
}

function createStudMesh(material) {
  const geometry = new THREE.CylinderGeometry(6, 6, 4, 16);
  const stud = new THREE.Mesh(geometry, material);
  stud.castShadow = true;
  stud.receiveShadow = true;
  return stud;
}

function createBrickObject(brick) {
  const part = SUPPORTED_PARTS[brick.part_id];
  const dimensions = getPartDimensions(brick.part_id, brick.rotation);

  if (!part || !dimensions) {
    return null;
  }

  const group = new THREE.Group();
  group.name = brick.id;
  group.userData.brickId = brick.id;
  group.userData.type = "editable-brick";

  const material = materialForBrick(brick);
  const height = partHeightLdu(part);
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(part.width * STUD_LDU, height, part.depth * STUD_LDU),
    material,
  );
  body.castShadow = true;
  body.receiveShadow = true;
  group.add(body);

  const topY = -(height / 2) - 2;

  for (let x = 0; x < part.width; x += 1) {
    for (let z = 0; z < part.depth; z += 1) {
      const stud = createStudMesh(material);
      stud.position.set(
        -(part.width * STUD_LDU) / 2 + STUD_LDU / 2 + x * STUD_LDU,
        topY,
        -(part.depth * STUD_LDU) / 2 + STUD_LDU / 2 + z * STUD_LDU,
      );
      group.add(stud);
    }
  }

  const outline = new THREE.BoxHelper(group, 0xff2f2f);
  outline.visible = false;
  outline.userData.type = "selection-outline";
  group.add(outline);
  group.userData.outline = outline;

  applyBrickTransform(group, brick);
  return group;
}

function applyBrickTransform(object, brick) {
  const center = positionToLduCenter(brick);
  object.position.set(center.x, center.y, center.z);
  object.rotation.y = THREE.MathUtils.degToRad(brick.rotation);
  object.userData.brick = brick;
  object.userData.outline?.update?.();
}

function disposeObject(object) {
  object.traverse((child) => {
    child.geometry?.dispose?.();
    if (Array.isArray(child.material)) {
      child.material.forEach((material) => material.dispose?.());
    } else {
      child.material?.dispose?.();
    }
  });
}

export function createBrickScene(scene) {
  const root = new THREE.Group();
  root.name = "editable-brick-root";
  scene.add(root);

  const objectsById = new Map();
  let selectedBrickId = null;
  let invalidBrickIds = new Set();

  function updateVisualState(object) {
    const brickId = object.userData.brickId;
    const outline = object.userData.outline;
    const invalid = invalidBrickIds.has(brickId);

    if (outline) {
      outline.visible = invalid || selectedBrickId === brickId;
      outline.material.color.set(invalid ? 0xff2f2f : 0xf2cd37);
    }

    object.traverse((child) => {
      if (child.isMesh && child.material) {
        child.material.emissive?.setHex(invalid ? 0x661111 : 0x000000);
      }
    });
  }

  return {
    root,
    objectsById,
    setModel(model) {
      const nextIds = new Set(model.bricks.map((brick) => brick.id));

      for (const [brickId, object] of objectsById.entries()) {
        if (!nextIds.has(brickId)) {
          root.remove(object);
          disposeObject(object);
          objectsById.delete(brickId);
        }
      }

      for (const brick of model.bricks) {
        this.updateBrick(brick);
      }
    },
    updateBrick(brick) {
      const existing = objectsById.get(brick.id);

      if (existing) {
        applyBrickTransform(existing, brick);
        updateVisualState(existing);
        return;
      }

      const object = createBrickObject(brick);

      if (!object) {
        return;
      }

      objectsById.set(brick.id, object);
      root.add(object);
      updateVisualState(object);
    },
    removeBrick(brickId) {
      const object = objectsById.get(brickId);

      if (!object) {
        return;
      }

      root.remove(object);
      disposeObject(object);
      objectsById.delete(brickId);
    },
    getBrickObject(brickId) {
      return objectsById.get(brickId) ?? null;
    },
    setSelectedBrick(brickId) {
      selectedBrickId = brickId;
      for (const object of objectsById.values()) {
        updateVisualState(object);
      }
    },
    setInvalidBrickIds(ids) {
      invalidBrickIds = new Set(ids);
      for (const object of objectsById.values()) {
        updateVisualState(object);
      }
    },
    dispose() {
      for (const object of objectsById.values()) {
        root.remove(object);
        disposeObject(object);
      }
      objectsById.clear();
      scene.remove(root);
    },
  };
}
```

- [ ] **Step 2: Add invalid highlight animation CSS hook**

Add to `src/preview/styles.css`:

```css
@keyframes invalidPulse {
  0% {
    opacity: 0.55;
  }

  50% {
    opacity: 1;
  }

  100% {
    opacity: 0.55;
  }
}
```

The Three.js outline itself is not controlled by CSS, but this keyframe is used by DOM validation issue rows in Task 6.

- [ ] **Step 3: Wire editable scene root in main without changing user behavior**

In `src/preview/main.js`, import the module:

```js
import { createBrickScene } from "./brickScene.js";
```

After `let activeGenerationRequest = null;`, add:

```js
let brickScene = null;
let currentEditorModel = null;
```

Add helper:

```js
function enterEditorScene(model) {
  if (!brickScene) {
    brickScene = createBrickScene(scene);
  }

  currentEditorModel = model;
  clearCurrentModel();
  brickScene.setModel(model);
}
```

At the end of `showModel`, after `renderModel(...)`, do not call `enterEditorScene` yet. This task only introduces the module. Task 6 switches the render path after controls and UI exist.

- [ ] **Step 4: Run tests**

Run: `npm test`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/preview/brickScene.js src/preview/main.js src/preview/styles.css
git commit -m "feat: add per-brick preview scene"
```

---

