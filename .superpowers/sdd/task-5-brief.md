### Task 5: Preview UI And Render Refresh

**Files:**
- Modify: `index.html`
- Modify: `src/preview/main.js`
- Modify: `src/preview/styles.css`

**Interfaces:**
- Consumes: `POST http://127.0.0.1:8787/api/generate`
- Consumes: fixture inventories from `src/generation/fixtures/*Inventory.js`
- Consumes: `exportModelToLDraw(model)`
- Produces: browser UI for prompt, inventory, generation status, notes, errors, and model render

- [ ] **Step 1: Update HTML controls**

Modify `index.html` inside `.viewer-panel` so it contains:

```html
<canvas id="preview-canvas"></canvas>
<form class="control-panel" id="generation-form">
  <label>
    Prompt
    <input id="prompt-input" name="prompt" value="build me a duck" autocomplete="off" />
  </label>
  <label>
    Inventory
    <select id="inventory-select" name="inventory"></select>
  </label>
  <label>
    Target pieces
    <input id="target-pieces" name="targetPieces" type="number" min="1" max="50" value="15" />
  </label>
  <button id="generate-button" type="submit">Generate</button>
</form>
<div class="model-card">
  <p id="model-name">Ready to generate</p>
  <dl>
    <div>
      <dt>Pieces</dt>
      <dd id="piece-count">-</dd>
    </div>
    <div>
      <dt>Status</dt>
      <dd id="validation-status">Idle</dd>
    </div>
  </dl>
  <ul id="generation-notes" class="generation-notes"></ul>
  <pre id="validation-errors" class="validation-errors" hidden></pre>
</div>
```

- [ ] **Step 2: Replace hardwired preview setup with selectable inventories**

Modify imports at the top of `src/preview/main.js`:

```js
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { LDrawLoader } from "three/addons/loaders/LDrawLoader.js";
import { LDrawConditionalLineMaterial } from "three/addons/materials/LDrawConditionalLineMaterial.js";

import { carInventory } from "../generation/fixtures/carInventory.js";
import { daisyInventory } from "../generation/fixtures/daisyInventory.js";
import { duckInventory } from "../generation/fixtures/duckInventory.js";
import { horseInventory } from "../generation/fixtures/horseInventory.js";
import { houseFlyInventory } from "../generation/fixtures/houseFlyInventory.js";
import { sandcastleInventory } from "../generation/fixtures/sandcastleInventory.js";
import { buildSmallDuckModel } from "../generation/fixtures/smallDuckModel.js";
import { validateModel } from "../generation/validator.js";
import { exportModelToLDraw } from "../ldraw/exportLDraw.js";
```

Add DOM references:

```js
const form = document.querySelector("#generation-form");
const promptInput = document.querySelector("#prompt-input");
const inventorySelect = document.querySelector("#inventory-select");
const targetPiecesInput = document.querySelector("#target-pieces");
const generateButton = document.querySelector("#generate-button");
const notesList = document.querySelector("#generation-notes");
const validationErrors = document.querySelector("#validation-errors");
```

Add inventory options:

```js
const inventories = [
  { id: "duck", label: "Duck demo pieces", inventory: duckInventory },
  { id: "car", label: "Car demo pieces", inventory: carInventory },
  { id: "daisy", label: "Daisy demo pieces", inventory: daisyInventory },
  { id: "horse", label: "Horse demo pieces", inventory: horseInventory },
  { id: "house-fly", label: "House fly demo pieces", inventory: houseFlyInventory },
  { id: "sandcastle", label: "Sandcastle demo pieces", inventory: sandcastleInventory },
];

for (const option of inventories) {
  const element = document.createElement("option");
  element.value = option.id;
  element.textContent = option.label;
  inventorySelect.append(element);
}

function selectedInventory() {
  return inventories.find((entry) => entry.id === inventorySelect.value)?.inventory ?? duckInventory;
}
```

- [ ] **Step 3: Extract reusable model rendering**

In `src/preview/main.js`, replace the current one-time `loader.parse(...)` block with these helpers:

```js
let currentModelGroup = null;

function clearCurrentModel() {
  if (!currentModelGroup) {
    return;
  }

  scene.remove(currentModelGroup);
  currentModelGroup.traverse((child) => {
    child.geometry?.dispose?.();
    if (Array.isArray(child.material)) {
      child.material.forEach((material) => material.dispose?.());
    } else {
      child.material?.dispose?.();
    }
  });
  currentModelGroup = null;
}

function renderModel(model) {
  const loader = new LDrawLoader();
  loader.setConditionalLineMaterial(LDrawConditionalLineMaterial);
  const ldrawText = exportModelToLDraw(model);

  loader.parse(
    ldrawText,
    (group) => {
      clearCurrentModel();
      group.rotation.x = Math.PI;
      group.traverse((child) => {
        if (child.isMesh) {
          child.castShadow = true;
          child.receiveShadow = true;
        }
      });

      const box = new THREE.Box3().setFromObject(group);
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());
      group.position.sub(center);

      scene.add(group);
      currentModelGroup = group;
      controls.target.set(0, 0, 0);

      const maxDimension = Math.max(size.x, size.y, size.z);
      const fov = THREE.MathUtils.degToRad(camera.fov);
      const distance = (maxDimension / (2 * Math.tan(fov / 2))) * 1.45;
      const viewDirection = new THREE.Vector3(1.1, 0.75, 1.35).normalize();

      camera.position.copy(viewDirection.multiplyScalar(distance));
      camera.near = Math.max(0.1, distance / 100);
      camera.far = distance * 10;
      camera.updateProjectionMatrix();
      controls.minDistance = distance * 0.35;
      controls.maxDistance = distance * 2.2;
      controls.update();
    },
    (error) => {
      validationStatus.textContent = "Load error";
      validationErrors.hidden = false;
      validationErrors.textContent = error.message;
    },
  );
}
```

- [ ] **Step 4: Add status and generation request helpers**

Add these helpers in `src/preview/main.js`:

```js
function setNotes(notes) {
  notesList.replaceChildren();

  for (const note of notes ?? []) {
    const item = document.createElement("li");
    item.textContent = note;
    notesList.append(item);
  }
}

function showErrors(errors) {
  validationErrors.hidden = false;
  validationErrors.textContent = JSON.stringify(errors, null, 2);
}

function hideErrors() {
  validationErrors.hidden = true;
  validationErrors.textContent = "";
}

function showModel(model, validation) {
  modelName.textContent = model.model_name;
  pieceCount.textContent = String(model.piece_count);
  validationStatus.textContent = validation.valid ? "Valid" : "Invalid";
  setNotes(model.notes);
  hideErrors();
  renderModel(model);
}

async function requestGeneration() {
  const response = await fetch("http://127.0.0.1:8787/api/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      userPrompt: promptInput.value,
      inventory: selectedInventory(),
      targetPieceCount: Number(targetPiecesInput.value),
    }),
  });

  const result = await response.json();

  if (!response.ok || !result.ok) {
    throw result;
  }

  return result;
}
```

- [ ] **Step 5: Wire submit behavior and initial local preview**

Add this near the bottom of `src/preview/main.js`, before `animate()`:

```js
form.addEventListener("submit", async (event) => {
  event.preventDefault();
  generateButton.disabled = true;
  validationStatus.textContent = "Generating";
  modelName.textContent = "Calling OpenRouter";
  pieceCount.textContent = "-";
  setNotes([]);
  hideErrors();

  try {
    const result = await requestGeneration();
    showModel(result.model, result.validation);
  } catch (error) {
    validationStatus.textContent = "Failed";
    modelName.textContent = "Generation failed";
    pieceCount.textContent = "-";
    setNotes([]);
    showErrors(error.errors ?? [error.message ?? "Unknown generation error"]);
  } finally {
    generateButton.disabled = false;
  }
});

const initialModel = buildSmallDuckModel(duckInventory);
const initialValidation = validateModel(initialModel, duckInventory);
showModel(initialModel, initialValidation);
```

Remove the old hardwired `const model = buildSmallDuckModel(...)`, `const validation = ...`, one-time metadata assignment, and one-time `loader.parse(...)` block after the grid setup.

- [ ] **Step 6: Add compact UI styles**

Add to `src/preview/styles.css`:

```css
.control-panel {
  position: absolute;
  left: 24px;
  bottom: 24px;
  display: grid;
  width: min(420px, calc(100vw - 48px));
  gap: 10px;
  padding: 14px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 8px;
  background: rgba(16, 18, 24, 0.78);
  backdrop-filter: blur(14px);
  box-shadow: 0 18px 48px rgba(0, 0, 0, 0.28);
}

.control-panel label {
  display: grid;
  gap: 5px;
  color: #c8d0df;
  font-size: 12px;
  font-weight: 700;
}

.control-panel input,
.control-panel select {
  width: 100%;
  min-height: 34px;
  border: 1px solid rgba(255, 255, 255, 0.16);
  border-radius: 6px;
  background: #0f1218;
  color: #f5f7fb;
  font: inherit;
  font-size: 14px;
  padding: 7px 9px;
}

.control-panel button {
  min-height: 36px;
  border: 0;
  border-radius: 6px;
  background: #f2cd37;
  color: #17130a;
  font-weight: 800;
  cursor: pointer;
}

.control-panel button:disabled {
  cursor: wait;
  opacity: 0.65;
}

.generation-notes {
  margin: 14px 0 0;
  padding-left: 18px;
  color: #d8deeb;
  font-size: 13px;
}

.validation-errors {
  max-height: 170px;
  overflow: auto;
  margin: 14px 0 0;
  padding: 10px;
  border-radius: 6px;
  background: rgba(201, 26, 9, 0.18);
  color: #ffd8d2;
  font-size: 12px;
  white-space: pre-wrap;
}

@media (max-width: 640px) {
  .control-panel {
    left: 14px;
    right: 14px;
    bottom: 14px;
    width: auto;
  }

  .model-card {
    max-height: 38vh;
    overflow: auto;
  }
}
```

- [ ] **Step 7: Run source-level tests**

Run: `npm test`

Expected: PASS.

- [ ] **Step 8: Run local preview without live OpenRouter**

Run: `npm run dev`

Expected: Vite starts on `http://127.0.0.1:5173/`. The page initially renders the local duck fixture. Pressing Generate without the service running should show a failure message instead of crashing.

- [ ] **Step 9: Stop Vite**

Press `Ctrl-C` in the Vite terminal.

Expected: process exits cleanly.

- [ ] **Step 10: Record blocked commit**

Run: `git status --short`

Expected: FAIL with `fatal: not a git repository`. Record that commit is blocked until `.git` is restored.

---

