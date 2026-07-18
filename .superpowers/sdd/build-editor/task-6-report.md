# Task 6 Report

## Status

DONE_WITH_CONCERNS

## Files Changed

- `index.html`
- `src/preview/main.js`
- `src/preview/styles.css`
- `.superpowers/sdd/build-editor/task-6-report.md`

## Implementation

- Replaced the generation timeline with the compact, live generation/editor status line.
- Added the editor toolbar, right-side catalogue, responsive catalogue styles, and click-to-add fallback.
- Routed the initial fixture and successful final generation models into the editable brick scene while retaining the LDraw draft-preview path.
- Added toolbar state wiring and the instructions validation gate, including invalid-brick highlighting.
- Cleared editor objects when switching to the old draft renderer and invalidated pending draft renders before entering editor mode, preventing stale draft output from replacing the completed editor model.
- Kept the model-card piece count synchronized after catalogue additions.

## Tests Run

- `node --check src/preview/main.js` - PASS
- `node --check src/preview/editorControls.js` - PASS
- `npm test` - PASS (`91` tests, `0` failures)
- Browser smoke check at `http://127.0.0.1:5174/` - PASS for initial editor UI, catalogue rendering/disabled counts, hand/axis toolbar state, catalogue add (`70` to `71` pieces), and invalid instructions gating (`Fix build`, visible errors, invalid-status line).

## Self-Review Notes

- The final editor path calls `invalidateCurrentRender()` before replacing a draft preview, so a late LDraw parse cannot overwrite the editor scene.
- Draft events still use `renderModel`, as required; editor objects are cleared before that draft preview is displayed.
- Catalogue additions use the selected inventory, refresh availability counts, and leave validation permissive until Instructions is clicked.

## Concerns

- The browser console reports `THREE.Object3D.add: object not an instance of THREE.Object3D. TransformControls` when `createEditorControls` initializes. The installed Three.js implementation defines `TransformControls` as `Controls` and exposes a `getHelper()` scene object, but `src/preview/editorControls.js` adds the controls instance directly to the scene. This prevents complete axis-gizmo verification. The helper module is outside Task 6 ownership, so it was not modified.
- `npm run dev` could not start because a pre-existing process already occupied `127.0.0.1:8787`; the independent Vite preview started successfully on `http://127.0.0.1:5174/`.

## TransformControls Integration Fix

- Updated `src/preview/editorControls.js` to add and remove `transformControls.getHelper()` when the installed Three.js API provides it, with a fallback to the controls instance for older versions without `getHelper()`.
- Added a regression test covering helper attachment and disposal cleanup.
- Required verification: `node --check src/preview/editorControls.js`, `node --test test/preview/editorControls.test.js`, and `npm test`.

## Review Findings Fixes

### Files Changed

- `src/preview/main.js`
- `src/preview/editorControls.js`
- `src/preview/brickScene.js`
- `test/preview/editorControls.test.js`
- `.superpowers/sdd/build-editor/task-6-report.md`

### Commands and Results

- `node --test test/preview/editorControls.test.js` - PASS (`4` tests, `0` failures). The new effective-tool regression initially failed because `setTool("rotate")` returned `undefined`.
- `node --check src/preview/main.js src/preview/editorControls.js src/preview/brickScene.js` - PASS.
- `npm test` - PASS (`93` tests, `0` failures).

### Self-Review

- Rotate is now one-shot in all cases: it rotates the selected brick when present, then returns `hand`; without a selected brick, it immediately returns `hand` without disabling hand selection or dragging.
- `main.js` applies the returned effective tool before setting toolbar state, keeping button state synchronized with editor behavior.
- Invalid bricks receive a lightweight red box overlay with disabled depth testing/writing and a render-loop opacity pulse. Only current invalid ids are updated each frame; overlays do not participate in raycasting.

### Concerns

- The flashing xray treatment is covered by code review and Node checks, but no browser visual smoke test was run in this fix pass.
