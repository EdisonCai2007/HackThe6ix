# Final narrow re-review package

## Focus
Verify final re-review issue is fixed: current-request draft ownership should be set only after accepted loader success, and stale loader errors/successes should not overwrite final UI state.

## src/preview/main.js

```js
let renderEpoch = 0;
let currentRenderGenerationRequest = null;
let activeGenerationRequest = null;

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

  renderModel(model, {
    onRendered: options.onRendered,
    onRenderError: options.onRenderError,
    generationRequest: options.generationRequest,
  });
}

async function requestGeneration(generationRequest) {
  const response = await fetch("http://127.0.0.1:8787/api/generate/stream", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      userPrompt: promptInput.value,
      inventory: selectedInventory(),
      targetPieceCount: Number(targetPiecesInput.value),
    }),
  });

  const result = await readGenerationStream(response, generationRequest);

  if (!response.ok || !result.ok) {
    throw result;
  }

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

  if (generationRequest !== activeGenerationRequest) {
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

  if (event.eventName === "result") {
    return event.payload;
  }

  return undefined;
}

function handleDraftEvent(payload, generationRequest) {
  if (generationRequest !== activeGenerationRequest) {
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
    showModel(payload.model, validation, {
      statusText: payload.stage === "pruned_draft" ? "Repairing pruned draft" : "Repairing draft",
      hideErrors: payload.stage === "placement_draft",
      generationRequest,
      onRendered: () => {
        if (generationRequest === activeGenerationRequest) {
          generationRequest.hasRenderedDraft = true;
        }
      },
      onRenderError: (error) => {
        if (generationRequest !== activeGenerationRequest) {
          return;
        }

        validationStatus.textContent = "Draft render error";
        showErrors([error?.message ?? "Unknown draft render error"]);
      },
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
}

window.addEventListener("resize", resize);

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const generationRequest = { hasRenderedDraft: false };
  invalidateCurrentRender();
  activeGenerationRequest = generationRequest;
  generateButton.disabled = true;
  validationStatus.textContent = "Generating";
  modelName.textContent = "Calling Gemini";
  pieceCount.textContent = "-";
  setNotes([]);
  hideErrors();
  resetTimeline();

  try {
    const result = await requestGeneration(generationRequest);
    if (activeGenerationRequest !== generationRequest) {
      return;
    }

    showModel(result.model, result.validation, { generationRequest });
  } catch (error) {
    if (activeGenerationRequest !== generationRequest) {
      return;
    }

    invalidateCurrentRender();
    validationStatus.textContent = "Failed";
    if (!generationRequest.hasRenderedDraft) {
      clearCurrentModel();
      modelName.textContent = "Generation failed";
      pieceCount.textContent = "-";

```

## final-fix-report.md

```md
# Final Fix Report

## Status

DONE

## Implemented Fixes

- `src/generation/service.js`: runs deterministic inventory cleanup for `unsupported_part`, `inventory_missing`, and `inventory_exceeded` before deciding whether AI repair is allowed. Repairability now comes from the pruned validation result; a valid pruned model still receives one AI repair attempt when cleanup removed bricks.
- `test/generation/service.test.js`: covers unsupported-only cleanup and mixed unsupported/buildability failures, including the pruned-model and removed-brick repair context.
- `src/preview/main.js`: uses a render epoch to ignore stale `LDrawLoader.parse()` success and error callbacks. Generation state now tracks whether the active request attempted a draft, so a pre-draft failure clears stale scene metadata and shows `Generation failed`.

## Verification

| Command | Result |
| --- | --- |
| `node --test test/generation/service.test.js` | Passed: 17 tests, 0 failures. |
| `npm test` | Passed: 72 tests across 15 suites, 0 failures. |
| `node --check src/generation/service.js` | Passed: exit 0. |
| `node --check src/preview/main.js` | Passed: exit 0. |

## Preview Test Coverage

No preview unit test was added. `src/preview/main.js` initializes the DOM, Three.js renderer, and animation loop at module load, and the repository has no browser-test harness or pure render-state helper. Adding that harness would be a broad refactor outside this fix. The updated module received a syntax check; the service behavior has focused automated coverage.

## Commit Status

Blocked: `/Users/edisoncai/Documents/GitHub/HackThe6ix` is not a Git repository (`git rev-parse --is-inside-work-tree` exits 128). No repository was initialized and no commit was created.

## Final Re-review Fix

Status: DONE

- `src/preview/main.js` now records `hasRenderedDraft` only in the accepted `LDrawLoader.parse()` success callback, after `currentModelGroup` is set and displayed.
- `renderModel()` now accepts render callbacks and generation-request context. Render callbacks require both the latest render epoch and the current render owner, so stale draft/final loader successes and errors cannot mutate the UI.
- Starting a generation and handling a generation failure both invalidate pending loader callbacks. A failure retains the current scene only when its request has rendered a draft successfully; it no longer treats an attempted draft as ownership.
- Final renders retain their normal accepted-loader behavior. A newer generation, render, or final failure invalidates its pending callbacks before they can replace newer UI state.

### Verification

| Command | Result |
| --- | --- |
| `node --check src/preview/main.js` | Passed: exit 0. |
| `npm test` | Passed: 72 tests across 15 suites, 0 failures. |

### Preview Test Coverage

No preview unit test was added. `src/preview/main.js` initializes DOM, WebGL, and an animation loop at module load, and this repository has no browser/DOM test harness or isolated renderer-state helper. Adding one would exceed the narrow fix scope; the existing `LDrawLoader` integration tests and the required full Node suite remain green.

### Commit Status

Blocked: `/Users/edisoncai/Documents/GitHub/HackThe6ix` is not a Git repository. No repository was initialized and no commit was created.

```
