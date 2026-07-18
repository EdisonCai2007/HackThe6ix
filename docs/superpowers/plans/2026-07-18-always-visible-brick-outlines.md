# Always-Visible Brick Outlines Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Give every committed LEGO brick a thin black body outline that changes to yellow when selected while preserving red invalid-state priority.

**Architecture:** Reuse the local `LineSegments` outline already owned by each editable brick in `brickScene.js`. Change only the outline material defaults and the existing visual-state update; model data, brick geometry, selection flow, and editor tools remain untouched.

**Tech Stack:** JavaScript, Three.js, Node.js built-in test runner

## Global Constraints

- Do not add or modify tests.
- Do not stage or commit changes.
- Do not modify model JSON or make rendered Three.js state authoritative.
- Do not run browser, DevTools, or WebGL verification.
- Invalid red outline state takes priority over selected yellow state.
- Temporary catalogue drag-preview bricks retain their current appearance.

---

### Task 1: Update editable brick outline visual states

**Files:**
- Modify: `src/preview/brickScene.js`
- Verify only: `test/preview/brickScene.test.js`
- Verify only: `test/preview/editorGeometry.test.js`

**Interfaces:**
- Consumes: `object.userData.brick`, `object.userData.outline`, `invalidBrickIds`, and `selectedBrickId` inside `createBrickScene()`.
- Produces: the existing outline object with state-dependent `visible`, `material.color`, and `material.depthTest` values.

- [ ] **Step 1: Set the outline material's normal defaults**

In `createSelectionOutline(part)`, initialize the existing `LineBasicMaterial` with black and depth testing enabled:

```js
new THREE.LineBasicMaterial({
  color: 0x000000,
  depthTest: true,
  depthWrite: false,
  toneMapped: false,
})
```

Keep the existing one-pixel line behavior, local `EdgesGeometry`, render order, disabled raycasting, and outline type.

- [ ] **Step 2: Apply the outline state precedence**

In `updateVisualState(object)`, derive selection and preview state and update the existing outline:

```js
const selected = selectedBrickId === brickId;
const preview = object.userData.brick?.preview === true;

if (outline) {
  outline.visible = invalid || selected || !preview;
  outline.material.color.set(
    invalid ? 0xff2f2f : selected ? 0xf2cd37 : 0x000000,
  );
  outline.material.depthTest = !invalid && !selected;
}
```

This yields red non-depth-tested invalid outlines, yellow non-depth-tested selected outlines, black depth-tested normal committed outlines, and hidden normal drag-preview outlines.

- [ ] **Step 3: Run existing focused verification without changing tests**

Run:

```bash
node --test test/preview/brickScene.test.js test/preview/editorGeometry.test.js
```

Expected: exit code `0` with all existing tests passing. Do not add or modify tests if the existing suite does not assert the new colors directly.

- [ ] **Step 4: Self-review the focused diff**

Confirm `git diff -- src/preview/brickScene.js` contains only the material default and visual-state changes described above. Confirm no test, model, selection, tool, or unrelated files were modified by this task.
