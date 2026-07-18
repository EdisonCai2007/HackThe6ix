### Task 8: Final Browser Polish And Verification

**Files:**
- Modify: `src/preview/main.js`
- Modify: `src/preview/styles.css`
- Modify: `docs/superpowers/specs/2026-07-17-build-editor-design.md` only if implementation intentionally differs from the approved spec.

**Interfaces:**
- Consumes all prior tasks.
- Produces a verified editor experience.

- [ ] **Step 1: Run full automated tests**

Run: `npm test`

Expected: PASS.

- [ ] **Step 2: Start the app**

Run: `npm run dev`

Expected: Vite preview and local generation server are available.

- [ ] **Step 3: Verify desktop behavior**

Open the local URL from the dev server and verify:

- initial model loads in editable scene
- toolbar stays at the top of the viewport
- right catalogue is visible and scrollable
- hand tool is active by default
- dragging an existing brick follows the pointer smoothly
- releasing a hand drag snaps the brick to the grid
- axis tool shows handles and moves only along the chosen axis
- rotate tool rotates the selected brick by 90 degrees around its visual center
- invalid state is allowed while editing
- instructions gate blocks invalid model and highlights affected bricks red
- fixing invalid pieces allows instructions status to become ready
- no full-scene flicker happens for normal move or rotate edits

- [ ] **Step 4: Verify mobile/narrow layout**

Resize the browser below `760px` width and verify:

- toolbar does not overlap model card controls
- catalogue collapses into the smaller lower layout
- catalogue cards remain readable
- text does not overflow buttons or cards

- [ ] **Step 5: Fix any layout or interaction regressions**

If desktop or mobile verification reveals overlap, add targeted CSS corrections. Example acceptable fixes:

```css
.model-card {
  max-width: min(320px, calc(100vw - 260px));
}

@media (max-width: 760px) {
  .model-card {
    max-width: calc(100vw - 28px);
  }
}
```

If transform controls fight orbit controls, ensure the `dragging-changed` listener keeps this exact behavior:

```js
transformControls.addEventListener("dragging-changed", (event) => {
  orbitControls.enabled = !event.value;
});
```

- [ ] **Step 6: Re-run verification after fixes**

Run: `npm test`

Expected: PASS.

Run: `npm run dev`

Expected: manual checks from Steps 3 and 4 pass.

- [ ] **Step 7: Commit final polish**

```bash
git add src/preview/main.js src/preview/styles.css docs/superpowers/specs/2026-07-17-build-editor-design.md
git commit -m "polish: verify build editor experience"
```

---

## Self-Review Notes

- Spec coverage: The plan covers permissive editing, right catalogue, used-up disabled items, hand/axis/rotate tools, snap-on-release, stacking on drop, per-brick scene updates, instructions validation gate, red xray-style highlighting, compact status, and limited preview/editor scope.
- Scope: This is a single implementation plan because all tasks build one cohesive editor surface. The instructions builder itself remains out of scope.
- Type consistency: Shared helpers use the existing `GeneratedModel`, `PlacedBrick`, and `Inventory` shapes from `src/generation/types.js`. The editor stores positions in grid units and converts to LDU only in preview geometry/scene code.
