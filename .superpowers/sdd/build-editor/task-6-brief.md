### Task 6: Catalogue, Toolbar, Compact Status, And Instructions Gate

**Files:**
- Modify: `index.html`
- Modify: `src/preview/main.js`
- Modify: `src/preview/styles.css`

**Interfaces:**
- Consumes:
  - `catalogueItemsForModel(inventory, model)`
  - `addBrickFromCatalogue(model, inventoryItem, draftPosition)`
  - `validateForInstructions(model, inventory)`
  - editor controls and brick scene from earlier tasks
- Produces:
  - Right catalogue UI
  - Top toolbar UI
  - Compact generation/editor status
  - Instructions validation gate

- [ ] **Step 1: Replace timeline DOM with status and add editor UI**

Modify `index.html` inside `.viewer-panel`:

```html
<div class="editor-toolbar" aria-label="Build editor tools">
  <button class="tool-button is-active" id="hand-tool" type="button" aria-pressed="true" title="Hand">H</button>
  <button class="tool-button" id="axis-tool" type="button" aria-pressed="false" title="Axis">A</button>
  <button class="tool-button" id="rotate-tool" type="button" aria-pressed="false" title="Rotate">R</button>
  <button class="instructions-button" id="instructions-button" type="button">Instructions</button>
</div>
<aside class="brick-catalogue" aria-label="Available bricks">
  <div class="brick-catalogue__header">
    <p>Bricks</p>
  </div>
  <div id="brick-catalogue-list" class="brick-catalogue__list"></div>
</aside>
```

Replace:

```html
<ol id="generation-timeline" class="generation-timeline" aria-label="Generation progress"></ol>
```

with:

```html
<div id="generation-status-line" class="generation-status-line" aria-live="polite">
  <span id="generation-spinner" class="generation-spinner" hidden></span>
  <span id="generation-status-text">Idle</span>
</div>
```

- [ ] **Step 2: Add UI element references in main**

In `src/preview/main.js`, replace:

```js
const timelineList = document.querySelector("#generation-timeline");
```

with:

```js
const generationStatusLine = document.querySelector("#generation-status-line");
const generationSpinner = document.querySelector("#generation-spinner");
const generationStatusText = document.querySelector("#generation-status-text");
const catalogueList = document.querySelector("#brick-catalogue-list");
const handTool = document.querySelector("#hand-tool");
const axisTool = document.querySelector("#axis-tool");
const rotateTool = document.querySelector("#rotate-tool");
const instructionsButton = document.querySelector("#instructions-button");
```

Remove `renderTimeline()`, `resetTimeline()`, and timeline row DOM creation. Keep `timelineState` only if needed for generation status mapping, or replace it with:

```js
function setStatusLine(text, { loading = false } = {}) {
  generationStatusText.textContent = text;
  generationSpinner.hidden = !loading;
}
```

Update `updateTimelineStage(stageId, status)` to:

```js
function updateTimelineStage(stageId, status) {
  const stage = timelineStages.find((candidate) => candidate.id === stageId);
  const label = stage?.label ?? stageId;
  setStatusLine(`${label}: ${timelineStatusLabels[status] ?? status}`, {
    loading: status === "running",
  });
}
```

Update `resetTimeline()` call sites to call:

```js
setStatusLine("Starting generation", { loading: true });
```

- [ ] **Step 3: Render catalogue cards**

In `src/preview/main.js`, import:

```js
import {
  addBrickFromCatalogue,
  catalogueItemsForModel,
  validateForInstructions,
} from "./editorState.js";
```

Add:

```js
function renderCatalogue() {
  if (!currentEditorModel) {
    catalogueList.replaceChildren();
    return;
  }

  const items = catalogueItemsForModel(selectedInventory(), currentEditorModel);
  const fragment = document.createDocumentFragment();

  for (const item of items) {
    const button = document.createElement("button");
    button.className = "catalogue-card";
    button.type = "button";
    button.disabled = item.disabled;
    button.dataset.key = item.key;
    button.innerHTML = `
      <span class="catalogue-card__model" aria-hidden="true"></span>
      <span class="catalogue-card__label">${item.label}</span>
      <span class="catalogue-card__count">${item.remaining} / ${item.count}</span>
    `;
    button.addEventListener("click", () => {
      if (item.disabled || !currentEditorModel) {
        return;
      }

      const inventoryItem = selectedInventory().items.find((candidate) =>
        candidate.part_id === item.part_id && candidate.color_id === item.color_id,
      );
      setEditorModel(addBrickFromCatalogue(currentEditorModel, inventoryItem, {
        x: 0,
        y: 0,
        z: 0,
      }));
      renderCatalogue();
      setStatusLine("Editing");
    });
    fragment.append(button);
  }

  catalogueList.replaceChildren(fragment);
}
```

The click-to-add behavior is the fallback. Drag-from-catalogue is added in Task 7.

Call `renderCatalogue()` at the end of `setEditorModel`.

- [ ] **Step 4: Wire toolbar**

Add:

```js
const toolButtons = {
  hand: handTool,
  axis: axisTool,
  rotate: rotateTool,
};

function setActiveTool(tool) {
  for (const [name, button] of Object.entries(toolButtons)) {
    button.classList.toggle("is-active", name === tool);
    button.setAttribute("aria-pressed", String(name === tool));
  }

  editorControls?.setTool(tool);
}

handTool.addEventListener("click", () => setActiveTool("hand"));
axisTool.addEventListener("click", () => setActiveTool("axis"));
rotateTool.addEventListener("click", () => setActiveTool("rotate"));
```

- [ ] **Step 5: Switch successful models into editor scene**

In `showModel`, after model metadata/status updates, replace the `renderModel(...)` call for non-generation draft completion with:

```js
if (options.editorMode) {
  enterEditorScene(model);
  renderCatalogue();
  setStatusLine("Editing");
  options.onRendered?.();
  return;
}
```

In the final successful generation path:

```js
showModel(result.model, result.validation, {
  generationRequest,
  editorMode: true,
});
```

For draft events, keep the existing `renderModel` behavior so live drafts still preview through the old path.

For the initial fixture:

```js
showModel(initialModel, initialValidation, { editorMode: true });
```

- [ ] **Step 6: Add instructions validation gate**

Add:

```js
function brickIdsFromValidation(validation) {
  return validation.errors
    .map((error) => error.brick_instance_id)
    .filter(Boolean);
}

instructionsButton.addEventListener("click", () => {
  if (!currentEditorModel) {
    return;
  }

  const validation = validateForInstructions(currentEditorModel, selectedInventory());

  if (validation.valid) {
    brickScene.setInvalidBrickIds([]);
    setStatusLine("Ready for instructions");
    validationStatus.textContent = "Ready";
    hideErrors();
    return;
  }

  const invalidBrickIds = brickIdsFromValidation(validation);
  brickScene.setInvalidBrickIds(invalidBrickIds);
  validationStatus.textContent = "Fix build";
  setStatusLine(`Invalid: fix ${invalidBrickIds.length || validation.errors.length} issue(s) before instructions`);
  showErrors(validation.errors);
});
```

- [ ] **Step 7: Add CSS**

Append to `src/preview/styles.css`:

```css
.editor-toolbar {
  position: absolute;
  top: 18px;
  left: 50%;
  z-index: 10;
  display: flex;
  align-items: center;
  gap: 8px;
  transform: translateX(-50%);
  padding: 8px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 8px;
  background: rgba(16, 18, 24, 0.78);
  backdrop-filter: blur(14px);
}

.tool-button,
.instructions-button {
  min-width: 38px;
  min-height: 34px;
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.06);
  color: #f5f7fb;
  font: inherit;
  font-weight: 800;
  cursor: pointer;
}

.tool-button.is-active {
  border-color: #f2cd37;
  background: rgba(242, 205, 55, 0.18);
  color: #f2cd37;
}

.instructions-button {
  padding: 0 12px;
  background: #f2cd37;
  color: #17130a;
}

.brick-catalogue {
  position: absolute;
  top: 82px;
  right: 18px;
  bottom: 18px;
  z-index: 9;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  width: 210px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 8px;
  background: rgba(16, 18, 24, 0.78);
  backdrop-filter: blur(14px);
}

.brick-catalogue__header {
  padding: 12px 12px 8px;
}

.brick-catalogue__header p {
  margin: 0;
  font-size: 13px;
  font-weight: 800;
}

.brick-catalogue__list {
  display: grid;
  align-content: start;
  gap: 8px;
  overflow: auto;
  padding: 0 10px 10px;
}

.catalogue-card {
  display: grid;
  grid-template-columns: 42px minmax(0, 1fr);
  grid-template-areas:
    "model label"
    "model count";
  gap: 3px 9px;
  width: 100%;
  min-height: 54px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.06);
  color: #f5f7fb;
  text-align: left;
  cursor: grab;
}

.catalogue-card:disabled {
  cursor: not-allowed;
  filter: grayscale(1);
  opacity: 0.42;
}

.catalogue-card__model {
  grid-area: model;
  align-self: center;
  width: 32px;
  height: 20px;
  margin-left: 8px;
  border-radius: 4px;
  background: #c91a09;
  box-shadow:
    7px -6px 0 -2px #e44434,
    17px -6px 0 -2px #e44434;
}

.catalogue-card__label {
  grid-area: label;
  align-self: end;
  overflow: hidden;
  font-size: 12px;
  font-weight: 800;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.catalogue-card__count {
  grid-area: count;
  color: #aeb6c7;
  font-size: 11px;
  font-weight: 700;
}

.generation-status-line {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 14px;
  color: #d8deeb;
  font-size: 12px;
  font-weight: 700;
}

.generation-spinner {
  width: 13px;
  height: 13px;
  border: 2px solid rgba(255, 255, 255, 0.22);
  border-top-color: #f2cd37;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

@media (max-width: 760px) {
  .brick-catalogue {
    top: auto;
    left: 14px;
    right: 14px;
    bottom: 184px;
    width: auto;
    max-height: 150px;
  }

  .brick-catalogue__list {
    grid-auto-flow: column;
    grid-auto-columns: 180px;
    overflow-x: auto;
    overflow-y: hidden;
  }
}
```

- [ ] **Step 8: Run tests**

Run: `npm test`

Expected: PASS.

- [ ] **Step 9: Run dev server and manually verify initial editor**

Run: `npm run dev`

Expected: Vite and generation server start. Browser preview shows:

- compact top toolbar
- right brick catalogue
- initial car rendered as editable per-brick objects
- clicking a brick selects it
- clicking rotate rotates the selected brick
- clicking instructions on an invalid build highlights invalid pieces and stays in editor mode

- [ ] **Step 10: Commit**

```bash
git add index.html src/preview/main.js src/preview/styles.css
git commit -m "feat: add build editor ui"
```

---

