### Task 7: Catalogue Drag-To-Scene

**Files:**
- Modify: `src/preview/editorControls.js`
- Modify: `src/preview/main.js`

**Interfaces:**
- Consumes:
  - catalogue item DOM data
  - `addBrickFromCatalogue`
  - `moveBrick`
- Produces:
  - Dragging from catalogue into scene creates a new brick at the snapped drop position.

- [ ] **Step 1: Mark catalogue cards draggable**

In `renderCatalogue()`, add:

```js
button.draggable = !item.disabled;
button.addEventListener("dragstart", (event) => {
  event.dataTransfer.setData("application/x-lego-inventory-key", item.key);
  event.dataTransfer.effectAllowed = "copy";
});
```

- [ ] **Step 2: Add scene drop handling**

In `src/preview/main.js`, add:

```js
function gridPositionFromCanvasDrop(event) {
  const rect = renderer.domElement.getBoundingClientRect();
  const xRatio = (event.clientX - rect.left) / rect.width;
  const yRatio = (event.clientY - rect.top) / rect.height;

  return {
    x: Math.round((xRatio - 0.5) * 24),
    y: Math.round((yRatio - 0.5) * 18),
    z: 0,
  };
}

renderer.domElement.addEventListener("dragover", (event) => {
  if (event.dataTransfer.types.includes("application/x-lego-inventory-key")) {
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  }
});

renderer.domElement.addEventListener("drop", (event) => {
  const key = event.dataTransfer.getData("application/x-lego-inventory-key");

  if (!key || !currentEditorModel) {
    return;
  }

  event.preventDefault();
  const inventoryItem = selectedInventory().items.find((item) =>
    `${item.part_id}:${item.color_id}` === key,
  );

  if (!inventoryItem) {
    return;
  }

  const nextModel = addBrickFromCatalogue(
    currentEditorModel,
    inventoryItem,
    gridPositionFromCanvasDrop(event),
  );
  const addedBrick = nextModel.bricks.at(-1);
  const stackedModel = moveBrick(nextModel, addedBrick.id, addedBrick.position, {
    snap: true,
    stackOnDrop: true,
  });
  setEditorModel(stackedModel, { editedBrickId: addedBrick.id });
  brickScene.setSelectedBrick(addedBrick.id);
  selectedBrickId = addedBrick.id;
  renderCatalogue();
  setStatusLine("Editing");
});
```

This gives functional drag-to-scene. A later polish pass can replace `gridPositionFromCanvasDrop` with raycast-to-ground math if the camera projection feels imprecise.

- [ ] **Step 3: Run tests**

Run: `npm test`

Expected: PASS.

- [ ] **Step 4: Manual verification**

Run: `npm run dev`

Expected:

- drag a catalogue card onto the scene
- the new brick appears
- the catalogue count decreases
- a used-up item remains visible and disabled
- dropping over an existing footprint stacks on top

- [ ] **Step 5: Commit**

```bash
git add src/preview/main.js
git commit -m "feat: drag catalogue bricks into editor"
```

---

