# Yellow Mask Confirmation Implementation Plan

**Goal:** Show the true piece mask in LEGO yellow and provide compact Yes/No confirmation with a type-only correction slide.

**Architecture:** Keep the current FastAPI review backend and source-frame stage. Convert each binary mask into a transparent yellow canvas positioned by its crop coordinates, then toggle the inspector between its existing review content and a small correction panel using the existing client state.

**Tech Stack:** Static HTML, CSS masking, vanilla JavaScript, FastAPI static-client tests, browser interaction testing.

## Global Constraints

- Preserve the existing API and review JSON schema.
- Use `assets.views[0].mask` and `assets.views[0].crop_box_original` as the only segmentation geometry.
- Do not show a waypoint number or rectangle.
- Quick controls are labeled exactly `Yes` and `No`.
- Correction asks only for type and retains the existing color.
- Do not commit, stage, reset, discard, merge, or push the user's dirty working tree.

---

### Task 1: Mask-based waypoint rendering

**Files:**
- Modify: `tests/test_inventory_review_app.py`
- Modify: `inventory_review_web/app.js`
- Modify: `inventory_review_web/styles.css`

**Interfaces:**
- Consumes: `row.assets.views[0].mask`, `row.assets.views[0].crop_box_original`, and `frame.size_wh`.
- Produces: `waypointButton(row, index, frame, selected)` with an invisible button hit region and transparent `.segmentation-silhouette` canvas painted by `paintSegmentationMask(canvas)`.

- [ ] **Step 1: Write the failing test**

```python
def test_confirmation_uses_real_mask_without_numbered_box(tmp_path):
    client = TestClient(create_app(_waypoint_workspace(tmp_path)[0]))
    script = client.get("/app.js").text
    styles = client.get("/styles.css").text
    assert "crop_box_original" in script
    assert '<canvas class="segmentation-silhouette"' in script
    assert "function paintSegmentationMask" in script
    assert "getImageData" in script
    assert "pixelData[offset + 3] = luminance" in script
    assert "drop-shadow" in styles
```

- [ ] **Step 2: Run test to verify it fails**

Run: `./.venv/bin/pytest -q tests/test_inventory_review_app.py -k real_mask -x`

Expected: FAIL because mask-backed waypoint rendering does not exist.

- [ ] **Step 3: Implement mask positioning and yellow silhouette**

Update `waypointButton` to use the first view's crop box and mask URL, return an accessible button containing a canvas, convert mask luminance into transparent yellow pixels, and style the transparent canvas with a yellow drop-shadow. Remove visible waypoint-number styling from the selected button.

- [ ] **Step 4: Run the focused test**

Run: `./.venv/bin/pytest -q tests/test_inventory_review_app.py -k real_mask -x`

Expected: PASS.

### Task 2: Compact confirmation and correction slide

**Files:**
- Modify: `tests/test_inventory_review_app.py`
- Modify: `inventory_review_web/index.html`
- Modify: `inventory_review_web/app.js`
- Modify: `inventory_review_web/styles.css`

**Interfaces:**
- Consumes: `state.correcting`, the current component review fields, and `confirmCurrent()`.
- Produces: `renderCorrectionSlide(row)`, `beginCorrection()`, `cancelCorrection()`, and `saveCorrection()`.

- [ ] **Step 1: Write the failing test**

```python
def test_confirmation_has_compact_yes_no_and_type_correction_slide(tmp_path):
    client = TestClient(create_app(_waypoint_workspace(tmp_path)[0]))
    index = client.get("/").text
    script = client.get("/app.js").text
    assert '>Yes</button>' in index
    assert '>No</button>' in index
    assert 'id="correction-slide"' in index
    assert 'placeholder="e.g. Brick 2 x 8"' in index
    assert "function cancelCorrection" in script
    assert "function saveCorrection" in script
```

- [ ] **Step 2: Run test to verify it fails**

Run: `./.venv/bin/pytest -q tests/test_inventory_review_app.py -k compact_yes_no -x`

Expected: FAIL because the correction slide and compact labels do not exist.

- [ ] **Step 3: Implement the two UI states**

Add the correction slide, set the quick button copy to `Yes`/`No`, hide the normal inspector and callout during correction, populate the correction crop and type, make Back restore confirmation, and make Save clear Part ID, copy the new type, retain color, set segmentation to `correct`, and call `confirmCurrent()`.

- [ ] **Step 4: Run focused confirmation tests**

Run: `./.venv/bin/pytest -q tests/test_inventory_review_app.py -k 'confidence_first or real_mask or compact_yes_no' -x`

Expected: PASS.

### Task 3: End-to-end verification

**Files:**
- Verify only: `inventory_review_web/index.html`, `inventory_review_web/app.js`, `inventory_review_web/styles.css`

**Interfaces:**
- Consumes: the disposable confirmation workspace on port 8767.
- Produces: a browser-visible yellow silhouette and working confirmation/correction transitions.

- [ ] **Step 1: Run static and full automated verification**

Run: `node --check inventory_review_web/app.js && git diff --check && ./.venv/bin/pytest -q`

Expected: JavaScript syntax succeeds, diff check succeeds, and all tests pass.

- [ ] **Step 2: Reset only the disposable review copy**

Copy the original source review JSON to `.work/confirmation-ui-demo/review-run/review.json`; do not edit the original review JSON.

- [ ] **Step 3: Browser-test the disposable UI**

Verify the stage contains no visible waypoint number or rectangle, the selected piece is a yellow mask silhouette, buttons read Yes/No and are compact, No displays the correction slide, Back restores confirmation, and Save persists/advances in the disposable copy.

- [ ] **Step 4: Restore the disposable review copy and leave the result open**

Restore the disposable JSON from the source a second time, reload the page on the unresolved piece, and leave that tab as the deliverable result for the user.
