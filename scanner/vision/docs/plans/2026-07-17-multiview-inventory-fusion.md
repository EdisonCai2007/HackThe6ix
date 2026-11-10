# Multi-view Inventory Fusion Implementation Plan

**Goal:** Export a small coverage-complete set of clean rectified views, fuse per-view LEGO detections into one inventory, and render a comprehensive object-aware mosaic without detecting stitch seams.

**Architecture:** `lego-capture/multiview.py` owns common-canvas geometry, valid-mask erosion, greedy coverage selection, and a versioned manifest. `lego-cv/pipeline/multiview.py` detects each clean view, associates compatible observations in table coordinates, selects one complete crop per physical piece, and composes a visualization whose background may blend but whose object patches remain intact. `session_cli.py` is the end-to-end offline entry point; single-photo APIs remain compatible.

**Tech Stack:** Python 3.11, NumPy, OpenCV, scikit-image, pytest, existing Record3D session format and Brickognize client.

## Global Constraints

- Inventory count must come from fused per-view observations, never by redetecting the final mosaic.
- Preserve the existing single-image CLI/API and legacy response fields.
- Keep selected-view inference bounded to at most five frames by default.
- Treat source-footprint boundary detections as incomplete and prefer complete observations.
- Store all spatial detections in the existing rectified table canvas so future environments only need calibrated poses/intrinsics.
- Do not implement or train YOLO instance segmentation in this plan.
- Preserve `/Users/emily/lego-cv/IMG_4841.jpg` untouched.

---

### Task 1: Coverage-aware rectified-view manifest

**Files:**
- Create: `/Users/emily/lego-capture/multiview.py`
- Create: `/Users/emily/lego-capture/tests/test_multiview.py`
- Modify: `/Users/emily/lego-capture/README.md`

**Interfaces:**
- Consumes: `topdown._rectify`, `topdown._topdownness`, `topdown.sharpness`, bounded workspace geometry, and `SessionReader.frames()`.
- Produces: `select_covering_views(candidates, max_frames=5, min_gain=0.002) -> list[ViewCandidate]` and `export_multiview(session_dir, px_per_mm=2.0, max_frames=5, edge_margin_px=8) -> tuple[Path, dict]`.
- Manifest: version `1`, absolute `session_dir`, common `origin_xy`, `px_per_m`, `size_wh`, `union_coverage`, `selected_coverage`, and relative view image/mask paths with frame ID and quality.

- [ ] **Step 1: Write failing selection and export tests**

```python
def test_selection_reaches_union_and_uses_sharp_tie():
    candidates = synthetic_candidates_with_overlapping_boolean_masks()
    selected = select_covering_views(candidates, max_frames=3)
    assert [view.frame_id for view in selected] == [2, 3]

def test_export_writes_versioned_common_canvas_manifest(session):
    path, manifest = export_multiview(session, px_per_mm=1.0, max_frames=3)
    assert path.exists() and manifest["version"] == 1
    assert 1 <= len(manifest["views"]) <= 3
    assert all((session / view["image"]).exists() for view in manifest["views"])
    assert all((session / view["mask"]).exists() for view in manifest["views"])
```

- [ ] **Step 2: Run the focused tests and verify RED**

Run: `cd /Users/emily/lego-capture && .venv/bin/python -m pytest tests/test_multiview.py -q`

Expected: collection failure because `multiview` does not exist.

- [ ] **Step 3: Implement selection, export, CLI, and documentation**

Create a `ViewCandidate` dataclass containing `frame_id`, `quality`, `image`, and eroded boolean `valid`. Build the bounded canvas with the same workspace bounds as `topdown.py`. Compute the usable union before selection. Repeatedly choose the candidate with the largest newly covered pixel count, breaking ties by quality; stop at `max_frames`, `99.5%` of usable union, or fractional gain below `min_gain`. Write JPEG views, PNG masks, and `multiview/manifest.json` using paths relative to the session.

- [ ] **Step 4: Run focused and full capture tests and verify GREEN**

Run: `cd /Users/emily/lego-capture && .venv/bin/python -m pytest tests/test_multiview.py -q && .venv/bin/python -m pytest -q`

Expected: all tests pass.

- [ ] **Step 5: Commit capture exporter**

```bash
git -C /Users/emily/lego-capture add multiview.py tests/test_multiview.py README.md
git -C /Users/emily/lego-capture commit -m "feat: export coverage-aware rectified views"
```

### Task 2: Deterministic table-coordinate observation fusion

**Files:**
- Create: `/Users/emily/lego-cv/pipeline/multiview.py`
- Create: `/Users/emily/lego-cv/tests/test_multiview.py`

**Interfaces:**
- Consumes: version-1 manifest, `pipeline.detect.detect`, `crop_box`, and palette color helpers.
- Produces: `Observation`, `FusedInstance`, `load_observations(manifest_path, detector="cv")`, `fuse_observations(observations)`, and `box_is_complete(box, valid_mask, margin=8)`.

- [ ] **Step 1: Write failing completeness and fusion tests**

```python
def test_boundary_observation_is_incomplete():
    mask = np.ones((100, 100), np.uint8) * 255
    assert not box_is_complete((0, 20, 30, 50), mask, margin=4)

def test_three_views_of_one_piece_fuse_once_and_prefer_complete():
    observations = [
        obs(frame=1, box=(10, 10, 40, 40), color="red", complete=False),
        obs(frame=2, box=(13, 11, 43, 41), color="red", complete=True),
        obs(frame=3, box=(11, 13, 41, 43), color="red", complete=True),
    ]
    instances = fuse_observations(observations)
    assert len(instances) == 1
    assert instances[0].best.frame_id == 2

def test_nearby_different_colors_and_distinct_same_color_pieces_stay_separate():
    observations = two_views_of_three_physical_pieces()
    assert len(fuse_observations(observations)) == 3
```

- [ ] **Step 2: Run the focused tests and verify RED**

Run: `cd /Users/emily/lego-cv && .venv/bin/python -m pytest tests/test_multiview.py -q`

Expected: collection failure because `pipeline.multiview` does not exist.

- [ ] **Step 3: Implement observation loading and deterministic fusion**

Classify color before identification. Score pairwise compatibility only across different source frames using broad color family, box-size ratio, intersection-over-union, and normalized center distance. Sort candidate edges by compatibility and use union-find while forbidding a cluster from containing two detections from the same frame. Select `best` by `(complete, boundary_clearance, quality, box_area)` with deterministic frame-ID tie-breaking.

- [ ] **Step 4: Run focused and full CV tests and verify GREEN**

Run: `cd /Users/emily/lego-cv && .venv/bin/python -m pytest tests/test_multiview.py -q && .venv/bin/python -m pytest -q`

Expected: all tests pass.

- [ ] **Step 5: Commit fusion core**

```bash
git -C /Users/emily/lego-cv add pipeline/multiview.py tests/test_multiview.py
git -C /Users/emily/lego-cv commit -m "feat: fuse multiview piece observations"
```

### Task 3: Object-aware mosaic and end-to-end session CLI

**Files:**
- Modify: `/Users/emily/lego-cv/pipeline/multiview.py`
- Create: `/Users/emily/lego-cv/session_cli.py`
- Modify: `/Users/emily/lego-cv/tests/test_multiview.py`
- Create: `/Users/emily/lego-cv/tests/test_session_cli.py`
- Modify: `/Users/emily/lego-cv/README.md`

**Interfaces:**
- Consumes: fused instances and their selected source observations.
- Produces: `compose_object_aware_mosaic(views, instances) -> np.ndarray`, `scan_manifest(manifest_path, detector="cv", cache_dir=Path(".cache")) -> MultiViewScanResult`, and CLI outputs `inventory.json`, `topdown.jpg`, `debug.jpg`, and `multiview_result.json` in the session directory.

- [ ] **Step 1: Write failing mosaic and session-output tests**

```python
def test_mosaic_contains_one_intact_selected_object_without_source_seam():
    views, instance = shifted_object_views()
    mosaic = compose_object_aware_mosaic(views, [instance])
    assert connected_red_components(mosaic) == 1

def test_scan_manifest_identifies_only_one_best_crop_per_instance(monkeypatch, manifest):
    calls = install_fake_identifier(monkeypatch)
    result = scan_manifest(manifest, detector="cv")
    assert calls.count == len(result.instances)
    assert sum(item["quantity"] for item in result.inventory) == len(result.instances)
```

- [ ] **Step 2: Run the focused tests and verify RED**

Run: `cd /Users/emily/lego-cv && .venv/bin/python -m pytest tests/test_multiview.py tests/test_session_cli.py -q`

Expected: failures because mosaic, scan result, and CLI do not exist.

- [ ] **Step 3: Implement object-aware composition and session scan**

Normalize each selected view to the shared neutral background. Exclude every observed object box (with padding) from background feather weights, blend only table pixels using distance-to-valid-edge weights, then insert each best observation as one exposure-normalized patch with a narrow outer feather. Build inventory from one Brickognize call per fused instance and render labels from fused instance boxes; never call `detect()` on the mosaic.

- [ ] **Step 4: Implement CLI and documentation**

`session_cli.py SESSION_OR_MANIFEST --detector cv` resolves `SESSION/multiview/manifest.json`, runs `scan_manifest`, and writes all four outputs. Document the two commands:

```bash
cd /Users/emily/lego-capture
.venv/bin/python multiview.py sessions/<timestamp>
cd /Users/emily/lego-cv
.venv/bin/python session_cli.py /Users/emily/lego-capture/sessions/<timestamp> --detector cv
```

- [ ] **Step 5: Run focused and full tests and verify GREEN**

Run: `cd /Users/emily/lego-cv && .venv/bin/python -m pytest tests/test_multiview.py tests/test_session_cli.py -q && .venv/bin/python -m pytest -q`

Expected: all tests pass.

- [ ] **Step 6: Commit session pipeline**

```bash
git -C /Users/emily/lego-cv add pipeline/multiview.py session_cli.py tests/test_multiview.py tests/test_session_cli.py README.md
git -C /Users/emily/lego-cv commit -m "feat: scan multiview capture sessions"
```

### Task 4: Real-session acceptance and live-test handoff

**Files:**
- Verify generated files under `/Users/emily/lego-capture/sessions/20260716-234326/`
- Verify generated files under `/Users/emily/lego-capture/sessions/20260716-221544/`
- Verify generated files under `/Users/emily/lego-capture/sessions/20260716-212422/`

**Interfaces:**
- Consumes: the capture exporter and session CLI from Tasks 1–3.
- Produces: verified counts and human-inspected mosaics/debug overlays.

- [ ] **Step 1: Export and scan all recorded acceptance sessions**

Run both CLIs for all three sessions with `--detector cv`.

Expected fused counts: `234326=8`, `221544=8`, `212422=7`; every result has zero legacy clusters.

- [ ] **Step 2: Add a regression test before each threshold correction**

If a real-session failure requires changing selection or association behavior, first add the smallest synthetic failing test reproducing that specific false merge, duplicate, or boundary case; verify it fails, then make the minimal correction.

- [ ] **Step 3: Inspect all generated mosaics and debug overlays**

Confirm no piece is clipped, no piece is duplicated, no source seam is boxed, and unobserved areas are visibly neutral rather than mistaken for source imagery.

- [ ] **Step 4: Run fresh final verification**

Run: `cd /Users/emily/lego-capture && .venv/bin/python -m pytest -q`

Run: `cd /Users/emily/lego-cv && .venv/bin/python -m pytest -q`

Expected: both suites pass with no failures.

- [ ] **Step 5: Keep feature branches for the physical test**

Do not merge or push. Report exact commands for a new live session only after recorded-session acceptance and final test verification succeed.
