### Task 5: Editor Controls

**Files:**
- Create: `src/preview/editorControls.js`
- Modify: `src/preview/main.js`

**Interfaces:**
- Consumes:
  - `moveBrick(model, brickId, position, options)`
  - `rotateBrickQuarterTurn(model, brickId)`
  - `brickScene.getBrickObject(brickId)`
  - `brickScene.setSelectedBrick(brickId)`
- Produces:
  - `createEditorControls(options): EditorControls`
  - `EditorControls.setTool(tool: "hand" | "axis" | "rotate"): void`
  - `EditorControls.setModel(model: GeneratedModel): void`
  - `EditorControls.setSelectedBrickId(brickId: string | null): void`
  - `EditorControls.dispose(): void`

- [ ] **Step 1: Create editor controls module**

Create `src/preview/editorControls.js`:

```js
import * as THREE from "three";
import { TransformControls } from "three/addons/controls/TransformControls.js";

import { STUD_LDU, PLATE_UNIT_LDU, snapGridPosition } from "./editorGeometry.js";
import { moveBrick, rotateBrickQuarterTurn } from "./editorState.js";

function brickIdFromObject(object) {
  let current = object;

  while (current) {
    if (current.userData?.type === "editable-brick") {
      return current.userData.brickId;
    }
    current = current.parent;
  }

  return null;
}

function lduToGridPosition(position) {
  return {
    x: position.x / STUD_LDU,
    y: position.z / STUD_LDU,
    z: -position.y / PLATE_UNIT_LDU,
  };
}

export function createEditorControls({
  camera,
  domElement,
  scene,
  orbitControls,
  brickScene,
  getModel,
  setModel,
  onSelectionChange,
}) {
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const dragPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const dragPoint = new THREE.Vector3();
  const transformControls = new TransformControls(camera, domElement);
  transformControls.setMode("translate");
  transformControls.setTranslationSnap(STUD_LDU);
  scene.add(transformControls);

  let tool = "hand";
  let selectedBrickId = null;
  let draggingBrickId = null;

  function updatePointer(event) {
    const rect = domElement.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -(((event.clientY - rect.top) / rect.height) * 2 - 1);
  }

  function selectBrick(brickId) {
    selectedBrickId = brickId;
    brickScene.setSelectedBrick(brickId);
    onSelectionChange?.(brickId);

    if (tool === "axis" && brickId) {
      transformControls.attach(brickScene.getBrickObject(brickId));
    } else {
      transformControls.detach();
    }
  }

  function intersectBrick(event) {
    updatePointer(event);
    raycaster.setFromCamera(pointer, camera);
    const intersections = raycaster.intersectObjects([...brickScene.objectsById.values()], true);

    for (const intersection of intersections) {
      const brickId = brickIdFromObject(intersection.object);

      if (brickId) {
        return brickId;
      }
    }

    return null;
  }

  function pointerDown(event) {
    if (tool !== "hand") {
      return;
    }

    const brickId = intersectBrick(event);
    selectBrick(brickId);

    if (!brickId) {
      return;
    }

    draggingBrickId = brickId;
    orbitControls.enabled = false;
    const object = brickScene.getBrickObject(brickId);
    dragPlane.constant = -object.position.y;
    domElement.setPointerCapture(event.pointerId);
  }

  function pointerMove(event) {
    if (tool !== "hand" || !draggingBrickId) {
      return;
    }

    updatePointer(event);
    raycaster.setFromCamera(pointer, camera);

    if (!raycaster.ray.intersectPlane(dragPlane, dragPoint)) {
      return;
    }

    const model = getModel();
    const nextModel = moveBrick(model, draggingBrickId, lduToGridPosition(dragPoint), {
      snap: false,
      stackOnDrop: false,
    });
    setModel(nextModel, { editedBrickId: draggingBrickId });
  }

  function pointerUp(event) {
    if (tool !== "hand" || !draggingBrickId) {
      return;
    }

    const model = getModel();
    const brick = model.bricks.find((candidate) => candidate.id === draggingBrickId);
    const nextModel = moveBrick(model, draggingBrickId, snapGridPosition(brick.position), {
      snap: true,
      stackOnDrop: true,
    });

    setModel(nextModel, { editedBrickId: draggingBrickId });
    draggingBrickId = null;
    orbitControls.enabled = true;
    domElement.releasePointerCapture(event.pointerId);
  }

  transformControls.addEventListener("dragging-changed", (event) => {
    orbitControls.enabled = !event.value;
  });

  transformControls.addEventListener("objectChange", () => {
    if (!selectedBrickId || tool !== "axis") {
      return;
    }

    const object = brickScene.getBrickObject(selectedBrickId);
    const gridPosition = snapGridPosition(lduToGridPosition(object.position));
    const nextModel = moveBrick(getModel(), selectedBrickId, gridPosition, {
      snap: true,
      stackOnDrop: false,
    });
    setModel(nextModel, { editedBrickId: selectedBrickId });
  });

  domElement.addEventListener("pointerdown", pointerDown);
  domElement.addEventListener("pointermove", pointerMove);
  domElement.addEventListener("pointerup", pointerUp);

  return {
    setTool(nextTool) {
      tool = nextTool;

      if (tool === "rotate" && selectedBrickId) {
        setModel(rotateBrickQuarterTurn(getModel(), selectedBrickId), {
          editedBrickId: selectedBrickId,
        });
        tool = "hand";
      }

      if (tool === "axis" && selectedBrickId) {
        transformControls.attach(brickScene.getBrickObject(selectedBrickId));
      } else {
        transformControls.detach();
      }
    },
    setModel() {},
    setSelectedBrickId: selectBrick,
    dispose() {
      domElement.removeEventListener("pointerdown", pointerDown);
      domElement.removeEventListener("pointermove", pointerMove);
      domElement.removeEventListener("pointerup", pointerUp);
      transformControls.dispose();
      scene.remove(transformControls);
    },
  };
}
```

- [ ] **Step 2: Import editor controls in main**

In `src/preview/main.js`, add:

```js
import { createEditorControls } from "./editorControls.js";
```

After `let currentEditorModel = null;`, add:

```js
let editorControls = null;
let selectedBrickId = null;
```

Add:

```js
function setEditorModel(model, { editedBrickId = null } = {}) {
  currentEditorModel = model;

  if (editedBrickId) {
    const editedBrick = model.bricks.find((brick) => brick.id === editedBrickId);
    if (editedBrick) {
      brickScene.updateBrick(editedBrick);
    }
  } else {
    brickScene.setModel(model);
  }
}

function ensureEditorControls() {
  if (editorControls || !brickScene) {
    return;
  }

  editorControls = createEditorControls({
    camera,
    domElement: renderer.domElement,
    scene,
    orbitControls: controls,
    brickScene,
    getModel: () => currentEditorModel,
    setModel: setEditorModel,
    onSelectionChange: (brickId) => {
      selectedBrickId = brickId;
    },
  });
}
```

Update `enterEditorScene(model)`:

```js
function enterEditorScene(model) {
  if (!brickScene) {
    brickScene = createBrickScene(scene);
  }

  currentEditorModel = model;
  clearCurrentModel();
  brickScene.setModel(model);
  ensureEditorControls();
}
```

- [ ] **Step 3: Run tests**

Run: `npm test`

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/preview/editorControls.js src/preview/main.js
git commit -m "feat: add editor transform controls"
```

---

