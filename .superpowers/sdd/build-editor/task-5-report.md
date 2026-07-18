# Task 5 Report: Editor Controls

## Status

DONE

## Files Changed

- `src/preview/editorControls.js`
- `src/preview/main.js`

## Tests Run

- `node --check src/preview/editorControls.js && node --check src/preview/main.js` - PASS (both files passed syntax validation).
- `npm test` - PASS (89 tests passed, 0 failed).

## Self-Review Notes

- Implemented the prescribed hand drag, axis transform, rotate, selection, orbit-control, and disposal behavior in `createEditorControls`.
- Wired editor model updates and one-time controls initialization into `enterEditorScene` without adding the Task 6 catalogue or status/timeline UI.
- Confirmed the integration only consumes the existing `editorGeometry`, `editorState`, and `brickScene` APIs.

## Concerns

- No dedicated browser-control test exists in the task brief or current test suite; browser interactions are covered by the required syntax checks and existing full test suite only.

## Correctness Fix: Center-to-Anchor Conversion

### Files Changed

- `src/preview/editorControls.js`
- `test/preview/editorControls.test.js`
- `.superpowers/sdd/build-editor/task-5-report.md`

### Commands and Results

- `node --test test/preview/editorControls.test.js` - PASS (the new center-to-anchor regression test passed).
- `node --check src/preview/editorControls.js` - PASS.
- `npm test` - PASS (90 tests passed, 0 failed).

### Self-Review

- `lduToGridPosition` now uses rotation-aware dimensions from `getPartDimensions` to subtract the visual center offsets for width, depth, and height.
- Hand drag and axis transforms share the same corrected conversion, preserving permissive unsnapped dragging and snapped axis movement.
- Rotation handling and `main.js` wiring were not changed.

### Concerns

- The regression test exercises the coordinate conversion directly; interactive browser controls remain outside the Node test environment.

## Review Findings Fix: Center Rotation and Axis Grid Snapping

### Files Changed

- `src/preview/editorState.js`
- `src/preview/editorControls.js`
- `test/preview/editorState.test.js`
- `test/preview/editorControls.test.js`
- `.superpowers/sdd/build-editor/task-5-report.md`

### Commands and Results

- `node --test test/preview/editorState.test.js test/preview/editorControls.test.js` - PASS (8 tests passed, including the new center-rotation and plate-layer conversion regressions).
- `node --check src/preview/editorControls.js` - PASS.
- `npm test` - PASS (91 tests passed, 0 failed).

### Self-Review

- `rotateBrickQuarterTurn` derives both pre- and post-rotation dimensions from the part catalog, then offsets x/y anchors to preserve the visual footprint center while retaining z.
- Axis mode no longer applies a uniform TransformControls snap; its existing object-change path converts the visual center back to a model anchor and uses `snapGridPosition`, which rounds horizontal axes to studs and vertical movement to plate layers.
- The focused tests cover a non-square 1x2 rotation and a one-plate center-to-anchor conversion at 8 LDU.

### Concerns

- Center-preserving rotation intentionally produces fractional x/y anchors for odd dimension differences. Validation continues to flag these until a later movement or snapping action resolves them, per the requirement.
