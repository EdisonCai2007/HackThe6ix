# Restore Backboard Preview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore generated-model and catalogue-piece rendering while keeping Backboard as the generation provider and making no more than two live Backboard calls during verification.

**Architecture:** Keep the working Backboard-to-existing-generation-service adapter unchanged. Replace the catalogue's one-WebGL-context-per-card renderer with one shared offscreen WebGL renderer that rasterizes each packed-LDraw thumbnail into its card's 2D canvas, preserving the main preview context.

**Tech Stack:** JavaScript ES modules, Node test runner, Three.js, LDrawLoader, Vite.

## Global Constraints

- Make no more than two live Backboard API calls during this task.
- Do not inspect or print secret values from `.env`.
- Do not run browser, DevTools, or WebGL automation without explicit user approval.
- Do not stage or commit changes.
- Preserve the existing generation stages, prompts, deterministic validation, LDraw export, and editor behavior.

---

### Task 1: Shared catalogue thumbnail renderer

**Files:**
- Create: `src/preview/catalogueThumbnailRenderer.js`
- Create: `test/preview/catalogueThumbnailRenderer.test.js`
- Modify: `src/preview/main.js`

**Interfaces:**
- Consumes: catalogue items returned by `catalogueItemsForModel()` and `exportModelToLDraw(model)`.
- Produces: `createCatalogueThumbnailRenderer(options?)`, whose `render(canvas, item, { isCurrent, onError })` method rasterizes a packed-LDraw part preview while reusing one WebGL renderer.

- [x] **Step 1: Write the failing regression test**

```js
test("catalogue thumbnails reuse one WebGL renderer", async () => {
  const module = await import("../../src/preview/catalogueThumbnailRenderer.js").catch(() => null);
  assert.ok(module, "shared catalogue thumbnail renderer module is required");

  let rendererCreations = 0;
  const thumbnailRenderer = module.createCatalogueThumbnailRenderer({
    createRenderer() {
      rendererCreations += 1;
      return fakeRenderer;
    },
    createLoader: () => fakeLoader,
    pixelRatio: () => 1,
  });

  await thumbnailRenderer.render(firstCanvas, item);
  await thumbnailRenderer.render(secondCanvas, item);
  assert.equal(rendererCreations, 1);
});
```

- [x] **Step 2: Run the regression and verify RED**

Run: `node --test test/preview/catalogueThumbnailRenderer.test.js`

Expected: FAIL with `shared catalogue thumbnail renderer module is required` because the shared renderer does not exist yet.

- [x] **Step 3: Implement the shared renderer**

```js
export function createCatalogueThumbnailRenderer({
  createRenderer = defaultRendererFactory,
  createLoader = defaultLoaderFactory,
  pixelRatio = () => Math.min(window.devicePixelRatio, 1.5),
} = {}) {
  let renderer = null;

  function getRenderer() {
    renderer ??= createRenderer();
    return renderer;
  }

  return {
    render(canvas, item, { isCurrent = () => true, onError } = {}) {
      return new Promise((resolve, reject) => {
        createLoader().parse(exportModelToLDraw(thumbnailModelForItem(item)), (group) => {
          if (!isCurrent()) {
            disposeObject(group);
            resolve(false);
            return;
          }

          rasterizeToCanvas(getRenderer(), canvas, group, pixelRatio());
          disposeObject(group);
          resolve(true);
        }, (error) => {
          onError?.(error);
          reject(error);
        });
      });
    },
  };
}
```

The concrete helper must create a detached, alpha-enabled WebGL renderer once; build a temporary lit scene and camera for each parsed part; render synchronously; copy the renderer canvas into the target card's 2D context; then dispose the parsed group.

- [x] **Step 4: Wire the catalogue to the shared renderer**

```js
const catalogueThumbnailRenderer = createCatalogueThumbnailRenderer();

function renderCatalogueThumbnail(canvas, item, epoch) {
  void catalogueThumbnailRenderer.render(canvas, item, {
    isCurrent: () => epoch === catalogueRenderEpoch,
    onError: () => canvas.classList.add("catalogue-card__preview--failed"),
  }).catch(() => {});
}
```

Remove `catalogueThumbnailRenderers`, `disposeCatalogueThumbnails()`, and the per-card `new THREE.WebGLRenderer(...)` path from `main.js`.

- [x] **Step 5: Run focused and full verification**

Run: `node --test test/preview/catalogueThumbnailRenderer.test.js test/ldraw/ldrawLoaderIntegration.test.js test/preview/brickScene.test.js`

Expected: all focused tests PASS.

Run: `npm test`

Expected: all tests PASS with no failures.

### Task 2: Provider and local-server smoke verification

**Files:**
- Modify only if a focused smoke test exposes a provider-boundary regression.

**Interfaces:**
- Consumes: `GENERATION_PROVIDER=backboard`, existing Gemini-named model-stage variables, `/api/inventories`, `/api/generate/stream`, and the existing generation service.
- Produces: a locally served preview plus generation server whose static modules load and whose Backboard adapter remains selected.

- [x] **Step 1: Confirm the existing supervised development command is running**

Run: `npm run dev`

Expected: Vite and the generation server both start, with no missing-module or port errors.

- [x] **Step 2: Perform lightweight HTTP checks without calling Backboard**

Run: `curl -I http://127.0.0.1:5173/` and fetch the changed ES module.

Expected: HTTP 200 responses.

- [x] **Step 3: Preserve the API budget when existing runtime evidence is sufficient**

Existing runtime logs already contain successful Backboard planning and placement responses. Make zero new calls; do not invoke suggestions or repairs.

- [x] **Step 4: Re-run `npm test` after smoke verification**

Expected: all tests PASS.
