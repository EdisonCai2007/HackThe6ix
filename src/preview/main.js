import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { LDrawLoader } from "three/addons/loaders/LDrawLoader.js";
import { LDrawConditionalLineMaterial } from "three/addons/materials/LDrawConditionalLineMaterial.js";

import { buildCampfireModel } from "../generation/fixtures/campfireModel.js";
import { fixedDemoInventory } from "../generation/fixtures/fixedDemoInventory.js";
import { randomBuildInventory } from "../generation/fixtures/randomBuildInventory.js";
import { validateGeneratedModelShape } from "../generation/generatedModelSchema.js";
import { validateModel } from "../generation/validator.js";
import { exportModelToLDraw } from "../ldraw/exportLDraw.js";
import { createBrickScene } from "./brickScene.js";
import { promptTextForBuildSuggestion } from "./buildSuggestionPrompt.js";
import { cameraFrameForModelSize } from "./cameraFraming.js";
import { createCatalogueThumbnailRenderer } from "./catalogueThumbnailRenderer.js";
import {
  CATALOGUE_PREVIEW_BRICK_ID,
  commitCataloguePreview,
  createCataloguePreviewBrick,
} from "./catalogueDrag.js";
import { createEditorControls, editorToolAvailability } from "./editorControls.js";
import {
  deleteSelectedBrick,
  shouldIgnoreEditorShortcut,
} from "./editorDeletion.js";
import { STUD_LDU } from "./editorGeometry.js";
import { createEditorHistory } from "./editorHistory.js";
import { installFixturePreviewPicker } from "./fixturePreviewPicker.js";
import { createIsometricSnapshotRenderer } from "./isometricSnapshotRenderer.js";
import { nextToolAfterSelectionChange } from "./editorToolState.js";
import { countInventoryBricks } from "./inventoryPieceCount.js";
import { getInventorySessionId } from "./inventorySessions.js";
import { createLeftPanelResizer } from "./leftPanelResize.js";
import { placementOffsetForBox } from "./modelPlacement.js";
import { createShowcaseSelection } from "./showcaseSelection.js";
import {
  catalogueItemsForModel,
  validateForInstructions,
} from "./editorState.js";

const canvas = document.querySelector("#preview-canvas");
const modelName = document.querySelector("#model-name");
const pieceCount = document.querySelector("#piece-count");
const validationStatus = document.querySelector("#validation-status");
const form = document.querySelector("#generation-form");
const promptInput = document.querySelector("#prompt-input");
const inventorySelect = document.querySelector("#inventory-select");
const generateButton = document.querySelector("#generate-button");
const notesList = document.querySelector("#generation-notes");
const validationErrors = document.querySelector("#validation-errors");
const generationStatusLine = document.querySelector("#generation-status-line");
const generationSpinner = document.querySelector("#generation-spinner");
const generationStatusText = document.querySelector("#generation-status-text");
const catalogueList = document.querySelector("#brick-catalogue-list");
const undoTool = document.querySelector("#undo-tool");
const redoTool = document.querySelector("#redo-tool");
const handTool = document.querySelector("#hand-tool");
const axisTool = document.querySelector("#axis-tool");
const rotateTool = document.querySelector("#rotate-tool");
const deleteTool = document.querySelector("#delete-tool");
const instructionsButton = document.querySelector("#instructions-button");
const brickContextMenu = document.querySelector("#brick-context-menu");
const brickContextDelete = document.querySelector("#brick-context-delete");
const leftPanelColumn = document.querySelector("#left-panel-column");
const leftPanelToggle = document.querySelector("#left-panel-toggle");
const statusPanel = document.querySelector("#status-panel");
const statusPanelClose = document.querySelector("#status-panel-close");
const buildSuggestionsPanel = document.querySelector("#build-suggestions-panel");
const buildSuggestionsPanelClose = document.querySelector("#build-suggestions-panel-close");
const buildSuggestionsRefresh = document.querySelector("#build-suggestions-refresh");
const buildSuggestionsStatus = document.querySelector("#build-suggestions-status");
const buildSuggestionsList = document.querySelector("#build-suggestions-list");
const promptPanelClose = document.querySelector("#prompt-panel-close");
const statusBuildResizeHandle = document.querySelector("#status-build-resize-handle");
const buildPromptResizeHandle = document.querySelector("#build-prompt-resize-handle");
const brickCataloguePanel = document.querySelector("#brick-catalogue-panel");
const brickCatalogueClose = document.querySelector("#brick-catalogue-close");
const rightDrawer = document.querySelector("#right-drawer");
const rightDrawerToggle = document.querySelector("#right-drawer-toggle");

const timelineStages = [
  { id: "geometry_generate", label: "BrickGPT geometry generation" },
  { id: "geometry_normalize", label: "Target-volume normalization" },
  { id: "inventory_compile", label: "Exact-inventory compilation" },
  { id: "candidate_validate", label: "Candidate validation" },
  { id: "candidate_select", label: "Best-candidate selection" },
  { id: "structure_generate", label: "Structure generation" },
  { id: "structure_parse", label: "Structure JSON parse" },
  { id: "placement_generate", label: "Placement generation" },
  { id: "placement_parse", label: "Placement JSON parse" },
  { id: "validation", label: "Validation" },
  { id: "refinement", label: "Isometric refinement" },
];

const timelineStatusLabels = {
  pending: "Pending",
  running: "Running",
  complete: "Complete",
  skipped: "Skipped",
  failed: "Failed",
};

const resultStageTimelineMap = {
  structure_parse: "structure_parse",
  placement_parse: "placement_parse",
  placement_shape: "validation",
  validation: "validation",
  refinement_context: "refinement",
};

const inventories = [
  { id: "fixed-demo", label: "Fixed 787-piece inventory", inventory: fixedDemoInventory },
  { id: "random-build", label: "Random build assortment", inventory: randomBuildInventory },
];

for (const option of inventories) {
  const element = document.createElement("option");
  element.value = option.id;
  element.textContent = option.label;
  inventorySelect.append(element);
}

inventorySelect.value = "fixed-demo";

let isLeftPanelCollapsed = false;
let isRightDrawerCollapsed = false;
let buildSuggestionsRequestVersion = 0;
const showcaseSelection = createShowcaseSelection();
const leftPanelResizer = createLeftPanelResizer({
  container: leftPanelColumn,
  panels: [statusPanel, buildSuggestionsPanel, form],
  handles: [statusBuildResizeHandle, buildPromptResizeHandle],
});

function panelToggleWidth() {
  const value = getComputedStyle(document.documentElement).getPropertyValue("--panel-toggle-width");
  return Number.parseFloat(value) || 22;
}

function collapsedLeftPanelOffset() {
  return `${panelToggleWidth() - leftPanelColumn.offsetWidth}px`;
}

function setLeftPanelCollapsed(collapsed) {
  isLeftPanelCollapsed = collapsed;
  leftPanelColumn.classList.toggle("is-collapsed", collapsed);
  leftPanelColumn.style.left = collapsed ? collapsedLeftPanelOffset() : "";
  leftPanelToggle.setAttribute("aria-expanded", String(!collapsed));
  leftPanelToggle.setAttribute(
    "aria-label",
    collapsed ? "Expand left panels" : "Collapse left panels",
  );
}

function collapsedDrawerRightOffset() {
  return `${panelToggleWidth() - rightDrawer.offsetWidth}px`;
}

function setRightDrawerCollapsed(collapsed) {
  isRightDrawerCollapsed = collapsed;
  rightDrawer.classList.toggle("is-collapsed", collapsed);
  rightDrawer.style.right = collapsed ? collapsedDrawerRightOffset() : "";
  rightDrawerToggle.setAttribute("aria-expanded", String(!collapsed));
  rightDrawerToggle.setAttribute(
    "aria-label",
    collapsed ? "Expand build controls" : "Collapse build controls",
  );
}

function collapseLeftPanelWhenEmpty() {
  if (statusPanel.hidden && buildSuggestionsPanel.hidden && form.hidden) {
    setLeftPanelCollapsed(true);
  }
}

function selectedInventory() {
  return inventories.find((entry) => entry.id === inventorySelect.value)?.inventory ?? randomBuildInventory;
}

function showBuildSuggestionsStatus(message) {
  buildSuggestionsStatus.textContent = message;
  buildSuggestionsStatus.hidden = false;
  buildSuggestionsList.replaceChildren();
}

function showBuildSuggestions(suggestions) {
  buildSuggestionsList.replaceChildren(
    ...suggestions.map((suggestion) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "build-suggestion";
      button.textContent = suggestion.label;
      button.addEventListener("click", () => {
        showcaseSelection.selectSuggestion(suggestion);
        promptInput.value = promptTextForBuildSuggestion(suggestion);
        promptInput.focus();
      });
      return button;
    }),
  );
  buildSuggestionsStatus.hidden = true;
}

async function requestBuildSuggestions() {
  const requestVersion = ++buildSuggestionsRequestVersion;
  const inventory = selectedInventory();
  showBuildSuggestionsStatus("Loading ideas...");
  buildSuggestionsRefresh.disabled = true;

  try {
    const inventoryId = await getInventorySessionId(inventory);

    if (
      requestVersion !== buildSuggestionsRequestVersion ||
      inventory !== selectedInventory()
    ) {
      return;
    }

    const response = await fetch("http://127.0.0.1:8787/api/suggest-builds", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ inventory_id: inventoryId }),
    });
    const data = await response.json();

    if (
      requestVersion !== buildSuggestionsRequestVersion ||
      inventory !== selectedInventory()
    ) {
      return;
    }

    const suggestions = data?.ok && Array.isArray(data.suggestions)
      ? data.suggestions
        .filter((suggestion) =>
          typeof suggestion?.label === "string" &&
          typeof suggestion.prompt_metadata === "string",
        )
        .slice(0, 5)
      : [];

    if (!response.ok || !data?.ok || suggestions.length === 0) {
      showBuildSuggestionsStatus("Couldn't load suggestions");
      return;
    }

    showBuildSuggestions(suggestions);
  } catch {
    if (requestVersion === buildSuggestionsRequestVersion) {
      showBuildSuggestionsStatus("Couldn't load suggestions");
    }
  } finally {
    if (requestVersion === buildSuggestionsRequestVersion) {
      buildSuggestionsRefresh.disabled = false;
    }
  }
}

function setStatusLine(text, { loading = false } = {}) {
  generationStatusText.textContent = text;
  generationSpinner.hidden = !loading;
}

function updateTimelineStage(stageId, status) {
  const stage = timelineStages.find((candidate) => candidate.id === stageId);
  const label = stage?.label ?? stageId;
  setStatusLine(`${label}: ${timelineStatusLabels[status] ?? status}`, {
    loading: status === "running",
  });
}

function markTimelineFailureFromResult(stage) {
  const timelineStage = resultStageTimelineMap[stage];

  if (timelineStage) {
    updateTimelineStage(timelineStage, "failed");
    return true;
  }

  return false;
}

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  alpha: true,
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x111318);
const clock = new THREE.Clock();

const camera = new THREE.PerspectiveCamera(
  45,
  window.innerWidth / window.innerHeight,
  0.1,
  3000,
);
camera.position.set(180, 150, 230);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.target.set(20, 40, 35);
controls.minDistance = 90;
controls.maxDistance = 650;
const modelViewDirection = new THREE.Vector3(1.1, 0.75, 1.35).normalize();

const hemiLight = new THREE.HemisphereLight(0xffffff, 0x252a32, 1.8);
scene.add(hemiLight);

const keyLight = new THREE.DirectionalLight(0xffffff, 2.2);
keyLight.position.set(180, 260, 140);
keyLight.castShadow = true;
scene.add(keyLight);

const fillLight = new THREE.DirectionalLight(0x8fb7ff, 0.9);
fillLight.position.set(-160, 90, -120);
scene.add(fillLight);

const grid = new THREE.GridHelper(420, 21, 0x445064, 0x252b35);
grid.position.y = 0;
scene.add(grid);

let currentModelGroup = null;
let renderEpoch = 0;
let currentRenderGenerationRequest = null;
let activeGenerationRequest = null;
let brickScene = null;
let currentEditorModel = null;
let currentEditorInventory = null;
let editorControls = null;
let selectedBrickId = null;
let activeEditorTool = "hand";
let catalogueRenderEpoch = 0;
const catalogueThumbnailRenderer = createCatalogueThumbnailRenderer();
const isometricSnapshotRenderer = createIsometricSnapshotRenderer();
const editorHistory = createEditorHistory({ limit: 10 });
const dropRaycaster = new THREE.Raycaster();
const dropPointer = new THREE.Vector2();
const dropPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const dropPoint = new THREE.Vector3();
let activeCatalogueDrag = null;

function disposeModelGroup(group) {
  group.traverse((child) => {
    child.geometry?.dispose?.();
    if (Array.isArray(child.material)) {
      child.material.forEach((material) => material.dispose?.());
    } else {
      child.material?.dispose?.();
    }
  });
}

function clearCurrentModel() {
  if (!currentModelGroup) {
    return;
  }

  scene.remove(currentModelGroup);
  disposeModelGroup(currentModelGroup);
  currentModelGroup = null;
}

function zoomCameraOutToMaxDistance() {
  const viewDirection = camera.position.clone().sub(controls.target);

  if (!Number.isFinite(viewDirection.lengthSq()) || viewDirection.lengthSq() === 0) {
    viewDirection.copy(modelViewDirection);
  } else {
    viewDirection.normalize();
  }

  camera.position.copy(controls.target).add(
    viewDirection.multiplyScalar(controls.maxDistance),
  );
  controls.update();
}

function frameCameraForBox(box, { distanceMode = "initial" } = {}) {
  if (box.isEmpty()) {
    return false;
  }

  const size = box.getSize(new THREE.Vector3());
  const target = box.getCenter(new THREE.Vector3());
  const fov = THREE.MathUtils.degToRad(camera.fov);
  const frame = cameraFrameForModelSize(size, fov, { distanceMode });

  controls.target.copy(target);
  camera.position.copy(target).add(
    modelViewDirection.clone().multiplyScalar(frame.distance),
  );
  camera.near = frame.near;
  camera.far = frame.far;
  camera.updateProjectionMatrix();
  controls.minDistance = frame.minDistance;
  controls.maxDistance = frame.maxDistance;
  controls.update();
  return true;
}

function frameBrickSceneCameraForGeneration() {
  if (!brickScene) {
    return false;
  }

  scene.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(brickScene.root);
  return frameCameraForBox(box, { distanceMode: "max" });
}

function isActiveStreamingRequest(generationRequest) {
  return (
    generationRequest === activeGenerationRequest &&
    generationRequest?.streamEventsOpen !== false
  );
}

function setCanvasGenerationLocked(locked) {
  const generationLocked = Boolean(locked);

  if (generationLocked) {
    cancelCatalogueDrag();
  }

  editorControls?.setLocked?.(generationLocked);
  controls.enabled = !generationLocked;
  updateToolButtons();
}

function activateStreamingBrickScene(generationRequest) {
  if (!isActiveStreamingRequest(generationRequest)) {
    return false;
  }

  if (!brickScene) {
    brickScene = createBrickScene(scene);
  }

  if (!generationRequest.streamingSceneActive || currentModelGroup) {
    invalidateCurrentRender();
    clearCurrentModel();
    generationRequest.streamingSceneActive = true;
  }

  return true;
}

function modelFromBrickMap(model, bricksById) {
  const bricks = [...bricksById.values()];
  return {
    ...model,
    bricks,
    piece_count: bricks.length,
  };
}

function defaultStreamingModel(generationRequest) {
  return {
    model_name: "Streaming draft",
    prompt: generationRequest.userPrompt,
    piece_count: 0,
    dimensions: { width_studs: 1, depth_studs: 1, height_layers: 1 },
    created_from_inventory_id: generationRequest.inventory?.inventory_id ?? "streaming",
    generator_version: "streaming",
    bricks: [],
    notes: ["Generation is still in progress."],
  };
}

function replaceProvisionalModel(generationRequest, model) {
  const bricksById = new Map();

  for (const brick of model.bricks ?? []) {
    if (brick?.id) {
      bricksById.set(brick.id, brick);
    }
  }

  generationRequest.provisionalBricks = bricksById;
  generationRequest.provisionalModel = modelFromBrickMap(model, bricksById);
  return generationRequest.provisionalModel;
}

function updateProvisionalBrick(generationRequest, brick) {
  const bricksById = generationRequest.provisionalBricks ?? new Map(
    (generationRequest.provisionalModel?.bricks ?? [])
      .filter((candidate) => candidate?.id)
      .map((candidate) => [candidate.id, candidate]),
  );
  generationRequest.provisionalBricks = bricksById;
  bricksById.set(brick.id, brick);

  const baseModel = generationRequest.provisionalModel ?? defaultStreamingModel(generationRequest);
  generationRequest.provisionalModel = modelFromBrickMap(baseModel, bricksById);
  return generationRequest.provisionalModel;
}

function showStreamingModel(
  model,
  validation,
  generationRequest,
  { statusText, statusLine, updateErrors = false } = {},
) {
  if (!activateStreamingBrickScene(generationRequest)) {
    return false;
  }

  brickScene.setModel(model, { preserveRootPlacement: true });
  brickScene.setInvalidBrickIds(brickIdsFromValidation(validation));
  frameBrickSceneCameraForGeneration();
  modelName.textContent = model.model_name;
  pieceCount.textContent = String(model.piece_count);
  validationStatus.textContent = statusText ?? (
    validation.valid ? "Streaming preview (locked)" : "Streaming preview: invalid piece(s)"
  );
  setNotes(model.notes);

  if (updateErrors) {
    if (validation.valid) {
      hideErrors();
    } else {
      showErrors(validation.errors);
    }
  }

  if (statusLine) {
    setStatusLine(statusLine, { loading: true });
  }

  generationRequest.hasRenderedDraft = true;
  return true;
}

function hasBrick(model, brickId) {
  return Boolean(brickId && model.bricks.some((brick) => brick.id === brickId));
}

function setEditorModel(model, { editedBrickId = null, recordHistory = true } = {}) {
  if (recordHistory) {
    editorHistory.push(model);
    currentEditorModel = editorHistory.current();
  } else {
    currentEditorModel = model;
  }

  pieceCount.textContent = String(currentEditorModel.piece_count);

  if (editedBrickId) {
    const editedBrick = currentEditorModel.bricks.find((brick) => brick.id === editedBrickId);
    if (editedBrick) {
      brickScene.updateBrick(editedBrick);
    } else {
      brickScene.setModel(currentEditorModel);
    }
  } else {
    brickScene.setModel(currentEditorModel, { preserveRootPlacement: true });
  }

  if (selectedBrickId && !hasBrick(currentEditorModel, selectedBrickId)) {
    editorControls?.setSelectedBrickId(null);
  } else if (!editedBrickId && selectedBrickId) {
    editorControls?.setSelectedBrickId(selectedBrickId);
  }

  editorControls?.setModel(currentEditorModel);
  renderCatalogue();
  updateToolButtons();
}

function closeBrickContextMenu() {
  brickContextMenu.hidden = true;
}

function openBrickContextMenu({ clientX, clientY }) {
  const menuWidth = 136;
  const menuHeight = 48;
  const left = Math.min(clientX, window.innerWidth - menuWidth - 8);
  const top = Math.min(clientY, window.innerHeight - menuHeight - 8);

  brickContextMenu.style.left = `${Math.max(8, left)}px`;
  brickContextMenu.style.top = `${Math.max(8, top)}px`;
  brickContextMenu.hidden = false;
}

function clearEditorSelection() {
  selectedBrickId = null;
  editorControls?.setSelectedBrickId(null);
  brickScene?.setSelectedBrick(null);
  updateToolButtons();
}

function deleteSelectedEditorBrick() {
  return deleteSelectedBrick({
    model: currentEditorModel,
    selectedBrickId,
    setModel: setEditorModel,
    clearSelection: clearEditorSelection,
    setTool: setActiveTool,
    closeContextMenu: closeBrickContextMenu,
    setStatusLine,
  });
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
    isLocked: () => Boolean(activeGenerationRequest?.streamingLocked),
    onSelectionChange: (brickId) => {
      selectedBrickId = brickId;
      closeBrickContextMenu();
      const nextTool = nextToolAfterSelectionChange(activeEditorTool, brickId);
      if (nextTool !== activeEditorTool) {
        activeEditorTool = editorControls?.setTool(nextTool) ?? nextTool;
      }
      updateToolButtons();
    },
    onBrickContextMenu: openBrickContextMenu,
  });
}

function exitEditorScene() {
  cancelCatalogueDrag();
  editorControls?.reset();
  brickScene?.setInvalidBrickIds([]);
  brickScene?.setModel({ bricks: [] });
  currentEditorModel = null;
  currentEditorInventory = null;
  selectedBrickId = null;
  activeEditorTool = "hand";
  closeBrickContextMenu();
  catalogueList.replaceChildren();
  updateToolButtons();
}

function enterEditorScene(model, inventory) {
  exitEditorScene();

  if (!brickScene) {
    brickScene = createBrickScene(scene);
  }

  editorHistory.reset(model);
  currentEditorModel = editorHistory.current();
  currentEditorInventory = inventory;
  clearCurrentModel();
  brickScene.setModel(currentEditorModel);
  ensureEditorControls();
  setActiveTool("hand");
}

function renderCatalogueThumbnail(canvas, item, epoch) {
  void catalogueThumbnailRenderer.render(canvas, item, {
    isCurrent: () => epoch === catalogueRenderEpoch,
    onError: () => canvas.classList.add("catalogue-card__preview--failed"),
  }).catch(() => {});
}

function renderCatalogue() {
  const inventory = currentEditorInventory;
  catalogueRenderEpoch += 1;

  if (!currentEditorModel || !inventory) {
    catalogueList.replaceChildren();
    return;
  }

  const items = catalogueItemsForModel(inventory, currentEditorModel);
  const fragment = document.createDocumentFragment();
  const epoch = catalogueRenderEpoch;
  const thumbnails = [];

  for (const item of items) {
    const button = document.createElement("button");
    button.className = "catalogue-card";
    button.type = "button";
    button.disabled = item.disabled;
    button.draggable = false;
    button.dataset.key = item.key;

    const preview = document.createElement("canvas");
    preview.className = "catalogue-card__preview";
    preview.setAttribute("aria-hidden", "true");

    const count = document.createElement("span");
    count.className = "catalogue-card__count";
    count.textContent = `x${item.remaining}`;

    const label = document.createElement("span");
    label.className = "catalogue-card__label";
    label.textContent = item.label;

    const color = document.createElement("span");
    color.className = "catalogue-card__color";
    color.textContent = item.color_name;

    button.append(preview, count, label, color);
    thumbnails.push({ preview, item });

    button.addEventListener("dragstart", (event) => event.preventDefault());
    button.addEventListener("pointerdown", (event) => {
      beginCatalogueDrag(event, item, inventory);
    });
    fragment.append(button);
  }

  catalogueList.replaceChildren(fragment);
  for (const thumbnail of thumbnails) {
    renderCatalogueThumbnail(thumbnail.preview, thumbnail.item, epoch);
  }
}

function inventoryItemForCatalogueItem(inventory, catalogueItem) {
  return inventory.items.find((item) =>
    item.part_id === catalogueItem.part_id && item.color_id === catalogueItem.color_id,
  ) ?? null;
}

function pointerIsInsideCanvas(event) {
  const rect = renderer.domElement.getBoundingClientRect();
  return event.clientX >= rect.left &&
    event.clientX <= rect.right &&
    event.clientY >= rect.top &&
    event.clientY <= rect.bottom;
}

function gridPositionFromCanvasPointer(event) {
  if (!pointerIsInsideCanvas(event)) {
    return null;
  }

  const rect = renderer.domElement.getBoundingClientRect();
  dropPointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  dropPointer.y = -(((event.clientY - rect.top) / rect.height) * 2 - 1);
  dropRaycaster.setFromCamera(dropPointer, camera);

  if (!dropRaycaster.ray.intersectPlane(dropPlane, dropPoint)) {
    return null;
  }

  const localDropPoint = brickScene?.root
    ? brickScene.root.worldToLocal(dropPoint.clone())
    : dropPoint;

  return {
    x: localDropPoint.x / STUD_LDU,
    y: localDropPoint.z / STUD_LDU,
    z: 0,
  };
}

function removeCataloguePreview() {
  brickScene?.removeBrick(CATALOGUE_PREVIEW_BRICK_ID);

  if (activeCatalogueDrag) {
    activeCatalogueDrag.previewBrick = null;
  }
}

function detachCatalogueDragListeners() {
  window.removeEventListener("pointermove", updateCatalogueDrag);
  window.removeEventListener("pointerup", commitCatalogueDrag);
  window.removeEventListener("pointercancel", cancelCatalogueDrag);
}

function updateCatalogueDrag(event) {
  const drag = activeCatalogueDrag;

  if (!drag || event.pointerId !== drag.pointerId) {
    return;
  }

  event.preventDefault();

  if (
    !currentEditorModel ||
    currentEditorInventory !== drag.inventory ||
    !brickScene
  ) {
    removeCataloguePreview();
    return;
  }

  const gridPosition = gridPositionFromCanvasPointer(event);

  if (!gridPosition) {
    removeCataloguePreview();
    return;
  }

  const previewBrick = createCataloguePreviewBrick(
    currentEditorModel,
    drag.inventoryItem,
    gridPosition,
  );
  drag.previewBrick = previewBrick;
  brickScene.updateBrick(previewBrick);
}

function beginCatalogueDrag(event, catalogueItem, inventory) {
  if (
    event.button !== 0 ||
    catalogueItem.disabled ||
    !currentEditorModel ||
    currentEditorInventory !== inventory ||
    activeCatalogueDrag
  ) {
    return;
  }

  const inventoryItem = inventoryItemForCatalogueItem(inventory, catalogueItem);

  if (!inventoryItem) {
    return;
  }

  event.preventDefault();
  event.currentTarget.setPointerCapture?.(event.pointerId);
  activeCatalogueDrag = {
    pointerId: event.pointerId,
    sourceElement: event.currentTarget,
    inventory,
    inventoryItem,
    previewBrick: null,
    previousOrbitEnabled: controls.enabled,
  };
  controls.enabled = false;
  window.addEventListener("pointermove", updateCatalogueDrag, { passive: false });
  window.addEventListener("pointerup", commitCatalogueDrag, { passive: false });
  window.addEventListener("pointercancel", cancelCatalogueDrag, { passive: false });
  updateCatalogueDrag(event);
}

function finishCatalogueDrag(event) {
  const drag = activeCatalogueDrag;

  if (!drag || event?.pointerId !== drag.pointerId) {
    return null;
  }

  detachCatalogueDragListeners();
  drag.sourceElement.releasePointerCapture?.(drag.pointerId);
  controls.enabled = drag.previousOrbitEnabled;
  activeCatalogueDrag = null;
  return drag;
}

function commitCatalogueDrag(event) {
  const drag = activeCatalogueDrag;

  if (!drag || event.pointerId !== drag.pointerId) {
    return;
  }

  updateCatalogueDrag(event);
  const completedDrag = finishCatalogueDrag(event);
  const previewBrick = completedDrag?.previewBrick;

  if (
    !previewBrick ||
    !currentEditorModel ||
    currentEditorInventory !== completedDrag.inventory
  ) {
    removeCataloguePreview();
    return;
  }

  brickScene.removeBrick(CATALOGUE_PREVIEW_BRICK_ID);
  const result = commitCataloguePreview(
    currentEditorModel,
    completedDrag.inventoryItem,
    previewBrick,
  );

  if (!result.brickId) {
    return;
  }

  setEditorModel(result.model, { editedBrickId: result.brickId });
  editorControls?.setSelectedBrickId(result.brickId);
  setStatusLine("Editing");
}

function cancelCatalogueDrag(event = null) {
  const drag = activeCatalogueDrag;

  if (!drag) {
    return;
  }

  if (event && event.pointerId !== drag.pointerId) {
    return;
  }

  finishCatalogueDrag({ pointerId: drag.pointerId });
  removeCataloguePreview();
}

function invalidateCurrentRender() {
  renderEpoch += 1;
  currentRenderGenerationRequest = null;
}

function renderModel(
  model,
  { onRendered, onRenderError, generationRequest = null } = {},
) {
  const requestEpoch = ++renderEpoch;
  currentRenderGenerationRequest = generationRequest;
  exitEditorScene();
  const loader = new LDrawLoader();
  loader.setConditionalLineMaterial(LDrawConditionalLineMaterial);
  const ldrawText = exportModelToLDraw(model);

  function isCurrentRender() {
    return (
      requestEpoch === renderEpoch &&
      currentRenderGenerationRequest === generationRequest
    );
  }

  loader.parse(
    ldrawText,
    (group) => {
      if (!isCurrentRender()) {
        disposeModelGroup(group);
        return;
      }

      clearCurrentModel();
      group.rotation.x = Math.PI;
      group.traverse((child) => {
        if (child.isMesh) {
          child.castShadow = true;
          child.receiveShadow = true;
        }
      });

      const box = new THREE.Box3().setFromObject(group);
      group.position.add(placementOffsetForBox(box));

      scene.add(group);
      currentModelGroup = group;
      scene.updateMatrixWorld(true);
      frameCameraForBox(new THREE.Box3().setFromObject(group));
      onRendered?.();
    },
    (error) => {
      if (!isCurrentRender()) {
        return;
      }

      if (onRenderError) {
        onRenderError(error);
        return;
      }

      validationStatus.textContent = "Load error";
      validationErrors.hidden = false;
      validationErrors.textContent = error.message;
    },
  );
}

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

function showModel(model, validation, options = {}) {
  modelName.textContent = model.model_name;
  pieceCount.textContent = String(model.piece_count);
  validationStatus.textContent =
    options.statusText ?? (validation.valid ? "Valid" : "Invalid");
  setNotes(model.notes);

  if (validation.valid || options.hideErrors) {
    hideErrors();
  } else {
    showErrors(validation.errors);
  }

  if (options.editorMode) {
    invalidateCurrentRender();
    enterEditorScene(model, options.editorInventory ?? selectedInventory());
    if (options.generationRequest) {
      frameBrickSceneCameraForGeneration();
    }
    renderCatalogue();
    setStatusLine("Editing");
    options.onRendered?.();
    return;
  }

  renderModel(model, {
    onRendered: options.onRendered,
    onRenderError: options.onRenderError,
    generationRequest: options.generationRequest,
  });
}

const toolButtons = {
  hand: handTool,
  axis: axisTool,
  rotate: rotateTool,
};

function setActiveTool(tool) {
  const availability = editorToolAvailability(selectedBrickId);
  const requestedTool = availability[tool] ? tool : "hand";
  activeEditorTool = editorControls?.setTool(requestedTool) ?? requestedTool;
  updateToolButtons();
}

function updateToolButtons() {
  const availability = editorToolAvailability(selectedBrickId);
  const generationLocked = Boolean(activeGenerationRequest?.streamingLocked);

  undoTool.disabled = generationLocked || !currentEditorModel || !editorHistory.canUndo();
  redoTool.disabled = generationLocked || !currentEditorModel || !editorHistory.canRedo();

  for (const [name, button] of Object.entries(toolButtons)) {
    button.disabled = generationLocked || !availability[name];
    button.classList.toggle("is-active", name === activeEditorTool);
    button.setAttribute("aria-pressed", String(name === activeEditorTool));
  }

  deleteTool.disabled = generationLocked || !selectedBrickId;
}

function applyHistoryModel(model) {
  if (!model || !currentEditorModel) {
    return false;
  }

  const preferredSelectedBrickId = selectedBrickId;
  closeBrickContextMenu();
  setEditorModel(model, { recordHistory: false });

  if (hasBrick(currentEditorModel, preferredSelectedBrickId)) {
    editorControls?.setSelectedBrickId(preferredSelectedBrickId);
  } else {
    clearEditorSelection();
  }

  setStatusLine("Editing");
  updateToolButtons();
  return true;
}

function undoEditorModel() {
  if (!currentEditorModel || !editorHistory.canUndo()) {
    return false;
  }

  return applyHistoryModel(editorHistory.undo());
}

function redoEditorModel() {
  if (!currentEditorModel || !editorHistory.canRedo()) {
    return false;
  }

  return applyHistoryModel(editorHistory.redo());
}

handTool.addEventListener("click", () => setActiveTool("hand"));
axisTool.addEventListener("click", () => setActiveTool("axis"));
rotateTool.addEventListener("click", () => setActiveTool("rotate"));
undoTool.addEventListener("click", undoEditorModel);
redoTool.addEventListener("click", redoEditorModel);
deleteTool.addEventListener("click", deleteSelectedEditorBrick);
brickContextDelete.addEventListener("click", deleteSelectedEditorBrick);
leftPanelToggle.addEventListener("click", () => {
  setLeftPanelCollapsed(!isLeftPanelCollapsed);
});
statusPanelClose.addEventListener("click", () => {
  statusPanel.hidden = true;
  leftPanelResizer.update();
  collapseLeftPanelWhenEmpty();
});
buildSuggestionsPanelClose.addEventListener("click", () => {
  buildSuggestionsPanel.hidden = true;
  leftPanelResizer.update();
  collapseLeftPanelWhenEmpty();
});
buildSuggestionsRefresh.addEventListener("click", requestBuildSuggestions);
inventorySelect.addEventListener("change", () => {
  showcaseSelection.clear();
  requestBuildSuggestions();
});
promptInput.addEventListener("input", () => showcaseSelection.clear());
promptPanelClose.addEventListener("click", () => {
  form.hidden = true;
  leftPanelResizer.update();
  collapseLeftPanelWhenEmpty();
});
brickCatalogueClose.addEventListener("click", () => {
  brickCataloguePanel.hidden = true;
});
rightDrawerToggle.addEventListener("click", () => {
  setRightDrawerCollapsed(!isRightDrawerCollapsed);
});

document.addEventListener("pointerdown", (event) => {
  if (!brickContextMenu.hidden && !brickContextMenu.contains(event.target)) {
    closeBrickContextMenu();
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    closeBrickContextMenu();
    return;
  }

  if (shouldIgnoreEditorShortcut(event.target)) {
    return;
  }

  const shortcutKey = event.key.toLowerCase();
  const hasPrimaryModifier = event.metaKey || event.ctrlKey;
  const isUndoShortcut = hasPrimaryModifier && !event.shiftKey && shortcutKey === "z";
  const isRedoShortcut = (
    (hasPrimaryModifier && event.shiftKey && shortcutKey === "z") ||
    (event.ctrlKey && shortcutKey === "y")
  );

  if (isUndoShortcut && undoEditorModel()) {
    event.preventDefault();
    return;
  }

  if (isRedoShortcut && redoEditorModel()) {
    event.preventDefault();
    return;
  }

  if (event.key !== "Delete" && event.key !== "Backspace") {
    return;
  }

  if (deleteSelectedEditorBrick()) {
    event.preventDefault();
  }
});

function brickIdsFromValidation(validation) {
  const ids = new Set();

  for (const error of validation.errors) {
    if (error.brick_instance_id) {
      ids.add(error.brick_instance_id);
      continue;
    }

    for (const component of error.component_brick_ids ?? []) {
      for (const brickId of component) {
        ids.add(brickId);
      }
    }
  }

  return [...ids];
}

instructionsButton.addEventListener("click", () => {
  if (!currentEditorModel || !currentEditorInventory) {
    return;
  }

  const validation = validateForInstructions(currentEditorModel, currentEditorInventory);

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

async function requestInitialGeneration(generationRequest) {
  const inventoryId = await getInventorySessionId(generationRequest.inventory);
  generationRequest.inventoryId = inventoryId;
  const response = await fetch("http://127.0.0.1:8787/api/generate/stream", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      userPrompt: generationRequest.userPrompt,
      inventory_id: inventoryId,
      targetPieceCount: generationRequest.targetPieceCount,
      ...(generationRequest.showcaseId
        ? { showcase_id: generationRequest.showcaseId }
        : {}),
    }),
    signal: generationRequest.controller.signal,
  });

  const result = await readGenerationStream(response, generationRequest);

  if (!response.ok || !result.ok) {
    throw result;
  }

  generationRequest.initialResult = result;
  return result;
}

async function requestRefinement(generationRequest, initialResult, image) {
  const response = await fetch("http://127.0.0.1:8787/api/generate/refine", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
    body: JSON.stringify({
      refinementId: initialResult.refinementId,
      image,
    }),
    signal: generationRequest.controller.signal,
  });
  const result = await readGenerationStream(response, generationRequest);

  if (!response.ok || !result.ok) {
    throw result;
  }

  return result;
}

async function requestGeneration(generationRequest) {
  const initialResult = await requestInitialGeneration(generationRequest);

  if (!isActiveStreamingRequest(generationRequest)) {
    throw new DOMException("Generation request was superseded.", "AbortError");
  }

  if (initialResult.requiresRefinement === false || initialResult.complete === true) {
    updateTimelineStage("refinement", "skipped");
    return initialResult;
  }

  setStatusLine("Rendering isometric refinement view", { loading: true });
  const image = await isometricSnapshotRenderer.capture(
    initialResult.cleanedModel ?? initialResult.model,
  );

  if (!isActiveStreamingRequest(generationRequest)) {
    throw new DOMException("Generation request was superseded.", "AbortError");
  }

  updateTimelineStage("refinement", "running");
  const result = await requestRefinement(generationRequest, initialResult, image);
  updateTimelineStage("refinement", "complete");
  return result;
}

function parseSseBlock(block) {
  const lines = block.split("\n");
  let eventName = "message";
  const dataLines = [];

  for (const line of lines) {
    if (line.startsWith("event:")) {
      eventName = line.slice("event:".length).trim();
    } else if (line.startsWith("data:")) {
      dataLines.push(line.slice("data:".length).trimStart());
    }
  }

  if (dataLines.length === 0) {
    return null;
  }

  return {
    eventName,
    payload: JSON.parse(dataLines.join("\n")),
  };
}

function handleSseBlock(block, generationRequest) {
  if (block.trim() === "") {
    return undefined;
  }

  const event = parseSseBlock(block);

  if (!event) {
    return undefined;
  }

  if (!isActiveStreamingRequest(generationRequest)) {
    return undefined;
  }

  if (event.eventName === "progress") {
    updateTimelineStage(event.payload.stage, event.payload.status);
    return undefined;
  }

  if (event.eventName === "draft") {
    handleDraftEvent(event.payload, generationRequest);
    return undefined;
  }

  if (event.eventName === "brick") {
    handleBrickEvent(event.payload, generationRequest);
    return undefined;
  }

  if (event.eventName === "warning") {
    generationRequest.streamWarnings = [...(generationRequest.streamWarnings ?? []), event.payload.warning];
    return undefined;
  }

  if (event.eventName === "result") {
    return event.payload;
  }

  return undefined;
}

function handleBrickEvent(payload, generationRequest) {
  if (!isActiveStreamingRequest(generationRequest) || !payload?.brick?.id) {
    return;
  }

  const model = updateProvisionalBrick(generationRequest, payload.brick);
  const validation = validateModel(model, generationRequest.inventory);
  showStreamingModel(model, validation, generationRequest, {
    statusLine: `${payload.phase === "repair" ? "Repair" : "Placement"}: ${model.piece_count} brick(s)`,
  });
}

function handleDraftEvent(payload, generationRequest) {
  if (!isActiveStreamingRequest(generationRequest)) {
    return;
  }

  const shapeResult = validateGeneratedModelShape(payload.model);

  if (!shapeResult.ok) {
    validationStatus.textContent = "Draft shape error";
    showErrors(shapeResult.errors);
    return;
  }

  const validation = payload.validation ?? {
    valid: false,
    errors: [],
    warnings: [],
    inventory_usage: [],
  };

  try {
    const model = replaceProvisionalModel(generationRequest, payload.model);
    const statusText = payload.stage === "cleaned_placement_draft"
      ? "Refining cleaned draft"
      : payload.stage === "inventory_compile"
        ? "Compiling best inventory-safe candidate"
        : "Generating draft";

    showStreamingModel(model, validation, generationRequest, {
      statusText,
      statusLine: statusText,
      updateErrors: true,
    });
  } catch (error) {
    validationStatus.textContent = "Draft render error";
    showErrors([error?.message ?? "Unknown draft render error"]);
  }
}

async function readGenerationStream(response, generationRequest) {
  if (!response.body) {
    throw new Error("Generation response did not include a readable stream.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let result;

  for (;;) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });

    const blocks = buffer.split("\n\n");
    buffer = blocks.pop() ?? "";

    for (const block of blocks) {
      result = handleSseBlock(block, generationRequest) ?? result;
    }

    if (done) {
      break;
    }
  }

  result = handleSseBlock(buffer, generationRequest) ?? result;

  if (!result) {
    throw new Error("Generation stream ended without a result event.");
  }

  return result;
}

function resize() {
  const width = window.innerWidth;
  const height = window.innerHeight;

  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height);

  if (isRightDrawerCollapsed) {
    rightDrawer.style.right = collapsedDrawerRightOffset();
  }

  if (isLeftPanelCollapsed) {
    leftPanelColumn.style.left = collapsedLeftPanelOffset();
  }

  leftPanelResizer.update();
}

window.addEventListener("resize", resize);

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  activeGenerationRequest?.controller.abort();
  const inventory = selectedInventory();
  const selectedPayload = showcaseSelection.extendGenerationPayload({
    userPrompt: promptInput.value.trim(),
  });
  const generationRequest = {
    hasRenderedDraft: false,
    streamingLocked: true,
    streamEventsOpen: true,
    inventory,
    userPrompt: selectedPayload.userPrompt,
    showcaseId: selectedPayload.showcase_id,
    targetPieceCount: countInventoryBricks(inventory),
    controller: new AbortController(),
  };
  invalidateCurrentRender();
  activeGenerationRequest = generationRequest;
  setCanvasGenerationLocked(true);
  zoomCameraOutToMaxDistance();
  generateButton.disabled = true;
  validationStatus.textContent = "Generating";
  modelName.textContent = "Generating model";
  pieceCount.textContent = "-";
  setNotes([]);
  hideErrors();
  setStatusLine("Starting generation", { loading: true });

  try {
    const result = await requestGeneration(generationRequest);
    if (activeGenerationRequest !== generationRequest) {
      return;
    }

    generationRequest.streamingLocked = false;
    generationRequest.streamEventsOpen = false;
    setCanvasGenerationLocked(false);
    showModel(result.model, result.validation, {
      generationRequest,
      editorMode: true,
      editorInventory: generationRequest.inventory,
    });
  } catch (error) {
    if (activeGenerationRequest !== generationRequest) {
      return;
    }

    generationRequest.streamEventsOpen = false;
    generationRequest.recoveryAvailable = true;

    if (generationRequest.provisionalModel?.bricks?.length) {
      generationRequest.streamingLocked = false;
      setCanvasGenerationLocked(false);
      invalidateCurrentRender();
      const partial = generationRequest.provisionalModel;
      const partialValidation = {
        valid: false,
        errors: [{ field: "stream", message: "Generation did not complete; review this partial draft." }],
        warnings: generationRequest.streamWarnings ?? [],
      };
      showModel(partial, partialValidation, {
        statusText: "Incomplete streamed draft",
        generationRequest,
        editorMode: true,
        editorInventory: generationRequest.inventory,
      });
      setStatusLine(error?.name === "AbortError"
        ? "Generation canceled; partial draft preserved — retry available"
        : "Generation failed; partial draft preserved — retry available");
      return;
    }

    if (generationRequest.initialResult) {
      generationRequest.streamingLocked = false;
      setCanvasGenerationLocked(false);
      const initialResult = generationRequest.initialResult;
      updateTimelineStage("refinement", "failed");
      showModel(initialResult.cleanedModel ?? initialResult.model, initialResult.validation, {
        statusText: initialResult.validation.valid ? "Valid initial draft" : "Invalid initial draft",
        generationRequest,
        editorMode: true,
        editorInventory: generationRequest.inventory,
      });
      setStatusLine("Editing initial draft (refinement unavailable) — retry available");
      return;
    }

    if (error?.name === "AbortError") {
      setStatusLine("Generation canceled");
      return;
    }

    invalidateCurrentRender();
    validationStatus.textContent = "Failed";
    if (!generationRequest.hasRenderedDraft) {
      clearCurrentModel();
      modelName.textContent = "Generation failed";
      pieceCount.textContent = "-";
      setNotes([]);
    }
    if (!markTimelineFailureFromResult(error.stage)) {
      setStatusLine("Generation: Failed");
    }
    showErrors(error.errors ?? [error.message ?? "Unknown generation error"]);
  } finally {
    if (activeGenerationRequest === generationRequest) {
      generationRequest.streamEventsOpen = false;
      generationRequest.streamingLocked = false;
      activeGenerationRequest = null;
      setCanvasGenerationLocked(false);
      generateButton.disabled = false;
    }
  }
});

// Removable preview-only feature: delete this installer call and its module.
installFixturePreviewPicker({
  form,
  beforeElement: generateButton,
  inventory: randomBuildInventory,
  disabledWhen: generateButton,
  onSelect: ({ fixture, inventory, model }) => {
    const validation = validateModel(model, inventory);
    showModel(model, validation, {
      editorMode: true,
      editorInventory: inventory,
      onRendered: () => setStatusLine(`Fixture preview: ${fixture.label}`),
    });
  },
});

const initialModel = buildCampfireModel(randomBuildInventory);
const initialValidation = validateModel(initialModel, randomBuildInventory);
showModel(initialModel, initialValidation, {
  editorMode: true,
  editorInventory: randomBuildInventory,
});
requestBuildSuggestions();

function animate() {
  controls.update();
  brickScene?.update(clock.getElapsedTime());
  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}

animate();
