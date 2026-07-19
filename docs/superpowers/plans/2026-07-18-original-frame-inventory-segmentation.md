# Original-Frame Inventory Segmentation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate a LabelMe inventory-segmentation bundle from untouched Record3D RGB frames while retaining exact per-session count gates for reviewed fusion.

**Architecture:** Extend the existing inventory LabelMe exporter with a deterministic greedy set-cover selector over fused-instance observations. Export original-frame masks and byte-identical RGB files, retaining session/frame/homography provenance so reviewed masks can later be fused and count-gated.

**Tech Stack:** Python 3.12, OpenCV, NumPy, Ultralytics YOLO/SAM2, LabelMe 6.2.0, pytest.

## Global Constraints

- Never modify or overwrite historical session artifacts or existing review bundles.
- Export only byte-identical `frames/*.rgb.jpg` images; no rectification, warping, blending, or enhancement.
- Use exactly the 12 expected physical counts recorded in the approved design.
- Keep this phase limited to segmentation review; do not change color or part identification.

---

### Task 1: Deterministic minimum-cover source-frame selection

**Files:**
- Modify: `training/inventory_segmentation_labelme.py`
- Test: `tests/training/test_inventory_segmentation_labelme.py`

**Interfaces:**
- Consumes: fused instances containing observations with `view_index` and `identification_focus`.
- Produces: `select_original_review_views(instances, views) -> list[int]`, a deterministic list of selected view indices covering all observable fused instances.

- [ ] Add a failing test with three fake frames proving that the selector chooses two frames rather than all three and breaks equal-coverage ties using summed local focus.
- [ ] Run `.venv/bin/pytest -q tests/training/test_inventory_segmentation_labelme.py` and confirm the new test fails because `select_original_review_views` is absent.
- [ ] Implement greedy uncovered-instance gain selection with summed local-focus and view-quality tie-breakers; raise when any fused instance has no original-frame observation.
- [ ] Re-run the focused tests and confirm they pass.

### Task 2: Original-frame LabelMe export

**Files:**
- Modify: `training/inventory_segmentation_labelme.py`
- Test: `tests/training/test_inventory_segmentation_labelme.py`

**Interfaces:**
- Consumes: session manifest, selected view indices, accepted original detections, optional SAM2 checkpoint.
- Produces: one JSON/image pair per selected real frame plus `bundle.json` provenance.

- [ ] Add failing tests proving source images are copied byte-for-byte, polygons use `mask_original` coordinates, JSON records session/frame/expected count, and the bundle records source SHA-256.
- [ ] Run the focused test and confirm failure because original-frame export mode does not exist.
- [ ] Add `--image-mode original` and implement original-frame export using `shutil.copy2`, original masks/boxes, and the existing gated SAM refinement helper.
- [ ] Re-run focused tests and confirm they pass.

### Task 3: Required-count contract and real bundle generation

**Files:**
- Modify: `training/inventory_segmentation_labelme.py`
- Test: `tests/training/test_inventory_segmentation_labelme.py`
- Create: `/Users/emily/lego-capture/inventory-segmentation-labelme-original-20260718/`

**Interfaces:**
- Consumes: `/Users/emily/lego-capture/inventory-review-20260718/workspace.json` and the 12 session manifests.
- Produces: a non-overwriting original-frame review bundle with the approved physical-count table embedded in its manifest.

- [ ] Add a failing test that rejects a workspace count differing from the approved session count contract.
- [ ] Implement count-contract validation before model inference or output creation.
- [ ] Generate the new bundle using `best.pt`, `sam2.1_s.pt`, device `mps`, and `--image-mode original`.
- [ ] Verify every output image SHA-256 equals its source SHA-256 and every fused component is covered by at least one selected review frame.
- [ ] Launch LabelMe on the new review directory.

### Task 4: Regression verification

**Files:**
- Modify only if a regression is revealed: files already listed above.

**Interfaces:**
- Consumes: completed implementation and generated-bundle validation report.
- Produces: passing focused and full test results.

- [ ] Run `.venv/bin/pytest -q tests/training/test_inventory_segmentation_labelme.py` and require all focused tests to pass.
- [ ] Run `.venv/bin/pytest -q` and require the full `lego-cv` suite to pass.
- [ ] Inspect one generated image/JSON pair and confirm visually and structurally that it is a real source photo with editable polygons and no composite pixels.
