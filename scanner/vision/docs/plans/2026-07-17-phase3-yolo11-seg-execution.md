# Phase 3 YOLO11 Instance Segmentation Implementation Plan

**Goal:** Build a reproducible, session-safe single-class `yolo11n-seg` dataset and runtime separator that detects individual physical LEGO pieces in original Record3D RGB frames, including touching same-color pieces, without losing the existing geometry, fusion, Brickognize, color, stud-advisory, or classical fallback paths.

**Architecture:** Capture exports a manifest-v3 outer admissible workspace derived from repeatedly observed table-plane depth cells; the existing dense core remains a soft/legacy crop only. Training selects a small pose-diverse set of original frames per whole session, preserves provenance, validates instance polygons, and enforces session splits. Runtime YOLO sees a rectangular crop around the projected outer polygon, maps masks back to original and table coordinates, applies a polygon gate, and passes mask-aware observations into existing fusion and identification.

**Tech Stack:** Python 3.11, OpenCV, NumPy, PyYAML, pytest, Ultralytics `yolo11n-seg`, SAM2 only for offline annotation assistance, PyTorch MPS.

## Execution status (2026-07-17)

- Tasks 1–5 are implemented and tested. The capture workspace export is commit
  `7a09cce`; CV catalog/audit, frame selection, and label/dataset safeguards are
  commits `012c841`, `ebdb1d9`, and `4ef04fb`.
- Phase 3C bootstrapped 71 original frames with SAM2 on MPS. All proposals are
  explicitly unverified; QA prioritized 56 touching/overlapping frames.
- A lossless Labelme review bundle and guarded verified-label importer are
  prepared. All 71 images were human-reviewed and imported as 1,157 verified
  instances; the content-addressed dataset is `lego-seg-a751e0b2b456`.
- Task 6 is complete. The MPS smoke and 100-epoch full run succeeded; checkpoint
  `c792bdad...` is installed as `models/lego_seg.pt`. Frame-level mask mAP50-95
  is 0.847 train-seen, 0.837 whole-session validation, and 0.877 on the held-out
  white-table environment. These are not yet product-level inventory results.
- Tasks 7–10 are complete. Runtime inference uses original RGB workspace crops,
  mask-aware table fusion, isolated/context-safe identification crops, and
  inspectable gate overlays. Historical/train-seen counts are 7/7, 8/8, 8/8,
  and 8/8; all five whole-session validation references are exact. Held-out
  `white_round` is reported separately: `153942` is 11/11 and weak-geometry
  `155228` is 17/19 with one unknown. The held-out failure was classified and
  documented without tuning against it.

## Global Constraints

- Runtime segmentation has one semantic class: `lego_piece`.
- Run it on original RGB workspace crops, never the stitched/top-down mosaic.
- Depth supplies table/workspace geometry only; it does not separate adjacent pieces.
- The hard gate is the detector-independent observed plane region, never the old detector/dense-piece hull.
- Preserve manifest-v1/v2 loading, classical fallback, original crops, Brickognize, color, alternate views, stud advisory, and the same-source-frame fusion invariant.
- Split by whole session and mechanically reject session leakage.
- Keep custom/public/synthetic provenance explicit and separate.
- Exclude `20260717-153911` explicitly as a verified zero-frame session.
- Hold out the complete `white_round` environment (`153942`, `155228`) for test; report its weak geometry separately from segmentation quality.
- If `005145` is trained on, label its result `TRAIN-SEEN`.
- No long training or checkpoint integration before touching same-color labels receive human review.
- Use local MPS first; Colab/CUDA is fallback after a measured smoke-test failure.
- Stop before manual mask correction, required ambiguous environment labels, new captures, or a materially different annotation strategy.
- Preserve `/Users/emily/lego-cv/IMG_4841.jpg`.

## File Map

- `lego-capture/coverage.py`, `multiview.py`: physical workspace polygon and manifest v3.
- `lego-cv/training/catalog.py`, `catalog.yaml`, `audit.py`: audited sessions and contact sheets.
- `lego-cv/training/select_frames.py`: original-frame selection and provenance.
- `lego-cv/training/labels.py`, `qa.py`, `build_dataset.py`: label validation, review, leakage prevention, dataset build.
- `lego-cv/training/autolabel_sam.py`: unverified SAM2 proposals.
- `lego-cv/training/train_seg.py`: bounded MPS smoke and full training.
- `lego-cv/pipeline/segdetect.py`, `pipeline/multiview.py`: original-frame segmentation, gating, mapping, fusion, masks.
- `lego-cv/session_cli.py`, `training/evaluate_sessions.py`: diagnostics and product evaluation.
- `lego-cv/docs/phase3-capture-quality.md`: evidence-based scanner guidance.

---

### Task 1: Export a safe outer workspace in manifest v3

**Files:**
- Modify: `/Users/emily/lego-capture/coverage.py`
- Modify: `/Users/emily/lego-capture/multiview.py`
- Test: `/Users/emily/lego-capture/tests/test_coverage.py`
- Test: `/Users/emily/lego-capture/tests/test_multiview.py`

**Interfaces:**
- Produces `CoverageGrid.admissible_workspace_mask(min_seen=2, close_cells=5) -> np.ndarray[bool]`.
- Produces `CoverageGrid.admissible_workspace_contours_xy(...) -> list[list[list[float]]]` in table metres.
- Produces manifest-v3 `workspace_geometry` with hard contours, dense bounds, and table extent.
- Keeps the current dense rectified canvas unchanged for the classical path.

- [ ] **Step 1: Write failing outer-component tests**

```python
def test_admissible_workspace_keeps_outer_repeated_plane_not_only_dense_core():
    grid = CoverageGrid([[0, .10], [0, .10]], cell_m=.01)
    grid.seen_count[1:9, 1:9] = 2
    grid.seen_count[3:7, 3:7] = 10
    assert grid.admissible_workspace_mask().sum() >= 64
    assert grid.workspace_mask().sum() == 16

def test_admissible_contour_is_in_table_metres():
    grid = CoverageGrid([[-.05, .05], [-.05, .05]], cell_m=.01)
    grid.seen_count[2:8, 3:9] = 3
    contours = grid.admissible_workspace_contours_xy(simplify_m=0)
    assert contours
    assert all(-.05 <= value <= .05 for contour in contours
               for point in contour for value in point)
```

- [ ] **Step 2: Run RED**

Run: `.venv/bin/python -m pytest tests/test_coverage.py -k admissible -v`

Expected: `AttributeError` because the methods do not exist.

- [ ] **Step 3: Implement the dominant repeated-plane component and contours**

```python
def admissible_workspace_mask(self, min_seen=2, close_cells=5):
    observed = self.observed_mask(min_seen).astype(np.uint8)
    if not observed.any():
        return observed.astype(bool)
    closed = cv2.morphologyEx(
        observed, cv2.MORPH_CLOSE,
        np.ones((close_cells, close_cells), np.uint8))
    _, labels, stats, _ = cv2.connectedComponentsWithStats(closed)
    main = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
    return labels == main
```

Convert OpenCV contour cell coordinates through grid bounds/cell size; simplify only geometrically, never from detections.

- [ ] **Step 4: Write and run a failing manifest-v3 test**

```python
def test_manifest_v3_carries_physical_and_dense_workspace(session):
    _, manifest = export_multiview(session, max_frames=2)
    assert manifest["version"] == 3
    geometry = manifest["workspace_geometry"]
    assert geometry["hard_source"] == "depth_observed_plane_component"
    assert geometry["hard_contours_table_xy"]
    assert geometry["dense_bounds_table_xy"] is not None
```

Run: `.venv/bin/python -m pytest tests/test_multiview.py::test_manifest_v3_carries_physical_and_dense_workspace -v`

Expected: failure on version 2/missing metadata.

- [ ] **Step 5: Export additive v3 metadata and verify all capture tests**

```python
"workspace_geometry": {
    "hard_source": "depth_observed_plane_component",
    "hard_contours_table_xy": grid.admissible_workspace_contours_xy(),
    "dense_bounds_table_xy": grid.workspace_bounds_xy(2),
    "table_extent_xy": table_frame["extent_xy"],
}
```

Run: `.venv/bin/python -m pytest -q`

Expected: all capture tests pass; rectified images/canvas remain unchanged.

- [ ] **Step 6: Commit**

```bash
git add coverage.py multiview.py tests/test_coverage.py tests/test_multiview.py
git commit -m "feat: export physical workspace geometry"
```

---

### Task 2: Encode the audited catalog and permanent contact sheets

**Files:**
- Create: `/Users/emily/lego-cv/training/__init__.py`
- Create: `/Users/emily/lego-cv/training/catalog.yaml`
- Create: `/Users/emily/lego-cv/training/catalog.py`
- Create: `/Users/emily/lego-cv/training/audit.py`
- Test: `/Users/emily/lego-cv/tests/training/test_catalog.py`
- Test: `/Users/emily/lego-cv/tests/training/test_audit.py`
- Modify: `/Users/emily/lego-cv/requirements.txt`
- Modify: `/Users/emily/lego-cv/.gitignore`

**Interfaces:**
- Produces `load_catalog(path) -> Catalog`; `Catalog.validate()` enforces allowed values and held-out environment integrity.
- Produces audit JSON/Markdown and labeled contact sheets with health/geometry warnings.

- [ ] **Step 1: Write and run failing catalog tests**

```python
def test_catalog_excludes_empty_and_holds_out_white_environment():
    catalog = load_catalog(Path("training/catalog.yaml"))
    catalog.validate()
    assert catalog.sessions["20260717-153911"].reason == "zero_frames"
    white = {sid for sid, x in catalog.sessions.items()
             if x.environment == "white_round"}
    assert white == {"20260717-153942", "20260717-155228"}
    assert {catalog.sessions[sid].split for sid in white} == {"test"}

def test_catalog_rejects_training_member_of_held_out_environment(tmp_path):
    path = write_catalog(tmp_path, environment="white_round", split="train")
    with pytest.raises(ValueError, match="held-out environment"):
        load_catalog(path).validate()
```

Run: `.venv/bin/python -m pytest tests/training/test_catalog.py -v`

Expected: import failure because `training.catalog` does not exist.

- [ ] **Step 2: Implement typed YAML parsing and the exact audited split**

Add `PyYAML>=6.0`. Encode every session with `environment`, `split`, `target_frames`, `provenance`, notes/risk, and an exclusion reason where needed. Validation permits only `train|val|test|exclude` and makes an entire configured held-out environment test-only.

- [ ] **Step 3: Write and run failing audit tests using tiny sessions**

```python
def test_audit_reports_health_metrics(tiny_session, tmp_path):
    report = audit_sessions(catalog_for(tiny_session), tiny_session.parent, tmp_path)
    row = report["sessions"][tiny_session.name]
    assert row["frame_count"] == 3
    assert row["missing_rgb"] == 0
    assert row["duration_s"] == pytest.approx(2.0)
    assert "sharpness" in row

def test_audit_renders_empty_placeholder(tiny_empty_session, tmp_path):
    report = audit_sessions(catalog_for(tiny_empty_session),
                            tiny_empty_session.parent, tmp_path)
    assert report["sessions"][tiny_empty_session.name]["status"] == "empty"
    assert list(tmp_path.glob("session-contact-sheet-*.jpg"))
```

Run: `.venv/bin/python -m pytest tests/training/test_audit.py -v`

Expected: import failure because `training.audit` does not exist.

- [ ] **Step 4: Implement and run the permanent audit**

Report frame/file counts, duration/FPS, sampled within-session sharpness percentiles, plane inliers, table extent, camera-height range, representative early/middle/late frames, and warnings for empty/missing/short/weak-plane captures. Raw sharpness is descriptive, not a universal cross-environment rejection threshold.

Run:

```bash
.venv/bin/python -m training.audit --catalog training/catalog.yaml \
  --capture-root /Users/emily/lego-capture/sessions \
  --output training/artifacts
```

Expected: 20 new sessions, 19 usable, one explicit empty exclusion, three environment groups, two contact sheets.

- [ ] **Step 5: Test and commit**

```bash
.venv/bin/python -m pytest tests/training -q
git add requirements.txt .gitignore training tests/training
git commit -m "feat: catalog and audit segmentation sessions"
```

---

### Task 3: Select non-redundant originals with provenance

**Files:**
- Create: `/Users/emily/lego-cv/training/select_frames.py`
- Test: `/Users/emily/lego-cv/tests/training/test_select_frames.py`

**Interfaces:**
- Produces `select_session_frames(session_dir, target_count) -> list[SelectedFrame]`.
- Produces `training/data/selected/manifest.jsonl` and losslessly copied originals named `<session>__f<id>.jpg`.
- Every row contains absolute source path, session/frame, environment, split, provenance, and `annotation_status: missing`.

- [ ] **Step 1: Write and run failing selection tests**

```python
def test_selection_prefers_quality_and_pose_diversity(moving_session):
    chosen = select_session_frames(moving_session, 3)
    assert len(chosen) == 3
    assert len({x.frame_id for x in chosen}) == 3
    assert max(x.frame_id for x in chosen) - min(x.frame_id for x in chosen) > 2

def test_manifest_inherits_only_whole_session_split(selection_manifest):
    rows = read_jsonl(selection_manifest)
    assert session_split_leaks(rows) == {}
    assert all(row["annotation_status"] == "missing" for row in rows)
```

Run: `.venv/bin/python -m pytest tests/training/test_select_frames.py -v`

Expected: import failure because `training.select_frames` does not exist.

- [ ] **Step 2: Implement deterministic session-relative farthest-pose selection**

Sample candidates uniformly; score session-relative sharpness percentile, top-downness, translation, rotation, and time. Choose the best usable frame, then greedily maximize normalized pose/time diversity subject to a within-session quality floor. Never compare raw Laplacian values between different surface textures.

- [ ] **Step 3: Generate the selected set and verify size/leakage**

Run:

```bash
.venv/bin/python -m training.select_frames --catalog training/catalog.yaml \
  --capture-root /Users/emily/lego-capture/sessions \
  --output training/data/selected
```

Expected: roughly 65–75 original frames, deterministic ordering, no empty-session frames, no session leakage.

- [ ] **Step 4: Test and commit**

```bash
.venv/bin/python -m pytest tests/training -q
git add training/select_frames.py tests/training/test_select_frames.py
git commit -m "feat: select diverse original training frames"
```

---

### Task 4: Validate, visualize, and assemble YOLO instance labels

**Files:**
- Create: `/Users/emily/lego-cv/training/labels.py`
- Create: `/Users/emily/lego-cv/training/qa.py`
- Create: `/Users/emily/lego-cv/training/build_dataset.py`
- Test: `/Users/emily/lego-cv/tests/training/test_labels.py`
- Test: `/Users/emily/lego-cv/tests/training/test_build_dataset.py`

**Interfaces:**
- Produces `parse_yolo_seg_line(line) -> SegInstance` and `validate_label_file(...) -> list[LabelIssue]`.
- Produces `build_dataset(..., require_verified=True) -> Path`.
- Only labels with a sidecar `status: verified` can enter training.

- [ ] **Step 1: Write and run failing polygon tests**

```python
@pytest.mark.parametrize("line", [
    "1 .1 .1 .2 .1 .2 .2",
    "0 .1 .1 1.2 .1 .2 .2",
    "0 .1 .1 .2 .2",
])
def test_invalid_yolo_seg_lines_are_rejected(line):
    with pytest.raises(LabelValidationError):
        parse_yolo_seg_line(line)

def test_self_intersecting_polygon_is_rejected():
    with pytest.raises(LabelValidationError, match="polygon"):
        parse_yolo_seg_line("0 .1 .1 .9 .9 .1 .9 .9 .1")
```

Run: `.venv/bin/python -m pytest tests/training/test_labels.py -v`

Expected: import failure because `training.labels` does not exist.

- [ ] **Step 2: Implement strict single-class label validation**

Validate class 0, finite normalized coordinates, even coordinate count, at least three distinct points, positive simple polygon area, duplicate polygons, and label/image pairing. Emit machine-readable issue codes.

- [ ] **Step 3: Write and run failing dataset safety tests**

```python
def test_builder_refuses_unverified_labels(dataset_fixture):
    with pytest.raises(ValueError, match="unverified"):
        build_dataset(*dataset_fixture, require_verified=True)

def test_builder_refuses_session_leakage(leaking_fixture):
    with pytest.raises(ValueError, match="session leakage"):
        build_dataset(*leaking_fixture)

def test_builder_emits_one_class_yaml(verified_fixture):
    data = yaml.safe_load(build_dataset(*verified_fixture).read_text())
    assert data["names"] == {0: "lego_piece"}
```

Run: `.venv/bin/python -m pytest tests/training/test_build_dataset.py -v`

Expected: import failure because `training.build_dataset` does not exist.

- [ ] **Step 4: Implement verified-only assembly and QA rendering**

Copy into `images|labels/{train,val,test}`, retain a dataset manifest and SHA256 checksum, reject leakage/missing/invalid/unverified labels, and render every polygon with a stable instance color plus source session/frame. Prioritize touching/overlapping masks, count instability, boundary intersections, and all automatic labels.

- [ ] **Step 5: Test and commit**

```bash
.venv/bin/python -m pytest tests/training -q
git add training/labels.py training/qa.py training/build_dataset.py tests/training
git commit -m "feat: validate and assemble YOLO segmentation data"
```

---

### Task 5: Bootstrap SAM2 proposals and stop at review

**Files:**
- Create: `/Users/emily/lego-cv/training/autolabel_sam.py`
- Create: `/Users/emily/lego-cv/training/REVIEW_INSTRUCTIONS.md`
- Test: `/Users/emily/lego-cv/tests/training/test_autolabel_sam.py`

**Interfaces:**
- Produces unverified YOLO-seg proposals plus sidecars containing checkpoint/settings/scores/geometry evidence.
- Uses projected v3 workspace when available; never silently falls back to unrestricted room inference for runtime.

- [ ] **Step 1: Write and run failing conversion/review-state tests**

```python
def test_two_masks_remain_two_yolo_instances():
    masks = np.zeros((2, 100, 100), bool)
    masks[0, 10:30, 10:40] = True
    masks[1, 10:30, 40:70] = True
    assert len(masks_to_yolo_instances(masks, (100, 100))) == 2

def test_autolabel_sidecar_is_never_verified_by_default(tmp_path):
    sidecar = write_review_sidecar(tmp_path / "x.txt", proposals=[])
    assert json.loads(sidecar.read_text())["status"] == "unverified"
```

Run: `.venv/bin/python -m pytest tests/training/test_autolabel_sam.py -v`

Expected: import failure because `training.autolabel_sam` does not exist.

- [ ] **Step 2: Implement dependency-injected SAM proposal conversion**

Keep model loading behind `load_sam_model(checkpoint)` so tests use synthetic masks. Store every proposal score/gate decision; never set review status to verified.

- [ ] **Step 3: Run a two-image SAM2-small feasibility audit**

Use one dense wood frame and one round-table/touching frame. Save raw and filtered overlays. Measure runtime, proposal count, whole-piece count, stud/subpart over-segmentation, and touching-piece merges; a non-crash is not success.

- [ ] **Step 4: Generate proposals only if practically reviewable**

```bash
.venv/bin/python -m training.autolabel_sam \
  --selection training/data/selected/manifest.jsonl \
  --labels training/data/autolabels --checkpoint sam2.1_s.pt --device mps
.venv/bin/python -m training.qa --selection training/data/selected/manifest.jsonl \
  --labels training/data/autolabels --output training/artifacts/label-qa
```

If proposals are not practically correctable, stop before switching annotation strategy.

- [ ] **Step 5: Write the exact human checklist**

Require one mask per visible physical piece; split touching same-color pairs/triples; merge stud/subpart fragments; delete table/clutter/shadow masks; preserve tiny real pieces; inspect ROI-edge, flipped, and occluded pieces; compare counts across views; mark verified only after the overlay is correct.

- [ ] **Step 6: Test, commit tooling, and STOP AT HUMAN GATE**

```bash
.venv/bin/python -m pytest tests/training -q
git add training/autolabel_sam.py training/REVIEW_INSTRUCTIONS.md tests/training/test_autolabel_sam.py
git commit -m "feat: bootstrap reviewable SAM segmentation labels"
```

Report artifact paths, image/mask counts, priority touching subset, measured SAM failure modes, and review command. Do not train until verified.

---

### Task 6: Train the YOLO11n-seg baseline after label approval

**Files:**
- Create: `/Users/emily/lego-cv/training/train_seg.py`
- Test: `/Users/emily/lego-cv/tests/training/test_train_seg.py`
- Modify: `/Users/emily/lego-cv/README.md`

**Interfaces:**
- Produces `models/lego_seg.pt`, checkpoint metadata/hash, reproducible config, logs, plots, and per-split metrics.
- Consumes only a dataset built with `require_verified=True`.

- [ ] **Step 1: Write and run failing bounded-config tests**

```python
def test_smoke_defaults_to_yolo11n_seg_on_mps():
    config = TrainingConfig.smoke(data="data.yaml")
    assert config.model == "yolo11n-seg.pt"
    assert config.device == "mps"
    assert config.epochs <= 3
    assert config.fraction <= .25
```

Run: `.venv/bin/python -m pytest tests/training/test_train_seg.py -v`

Expected: import failure because `training.train_seg` does not exist.

- [ ] **Step 2: Implement config/CLI and verified-dataset preflight**

Record package, Torch/MPS versions, seed, augmentations, image/batch size, split membership, dataset checksum, and checkpoint hash. Require explicit `--smoke` or `--full`.

- [ ] **Step 3: Run and inspect a short MPS smoke test**

Run: `.venv/bin/python -m training.train_seg --data training/data/yolo/data.yaml --smoke`

Require actual MPS use, finite/non-pathological losses, acceptable memory/epoch time, validation completion, and successful checkpoint reload/inference.

- [ ] **Step 4: Run full training only if smoke evidence is healthy**

Run: `.venv/bin/python -m training.train_seg --data training/data/yolo/data.yaml --full`

Report train-seen, unseen-arrangement validation, and `white_round` held-out environment separately; never tune against test.

- [ ] **Step 5: Test and commit tooling**

```bash
.venv/bin/python -m pytest tests/training -q
git add training/train_seg.py tests/training/test_train_seg.py README.md
git commit -m "feat: train reproducible YOLO11 segmenter"
```

---

### Task 7: Segment original frames and apply geometry gating

**Files:**
- Create: `/Users/emily/lego-cv/pipeline/segdetect.py`
- Test: `/Users/emily/lego-cv/tests/test_segdetect.py`
- Modify: `/Users/emily/lego-cv/pipeline/multiview.py`

**Interfaces:**
- Produces `SegmentationDetection` with source ID, confidence, original mask/box, canvas polygon/box, overlap/centroid/outside evidence, and gate reason.
- Produces `detect_original_instances(manifest, views, model, gate_config) -> list[Observation]`.
- Preserves `observations_from_views(..., detector="cv")` unchanged.

- [ ] **Step 1: Write and run failing pure-geometry tests**

```python
def test_projected_workspace_roi_clips_to_original_bounds():
    roi = projected_workspace_roi(contours_table, origin_xy, px_per_m,
                                  H, image_wh=(1600, 1200))
    assert 0 <= roi.x0 < roi.x1 <= 1600
    assert 0 <= roi.y0 < roi.y1 <= 1200

def test_mask_maps_from_original_to_canvas():
    detection = map_instance(mask_original, np.diag([2., 2., 1.]))
    assert detection.box_canvas == pytest.approx((25, 20, 75, 60), abs=1)

def test_boundary_piece_with_substantial_overlap_is_not_blanket_deleted():
    assert gate_instance(mask, workspace_mask, confidence=.9).accepted
```

Run: `.venv/bin/python -m pytest tests/test_segdetect.py -v`

Expected: import failure because `pipeline.segdetect` does not exist.

- [ ] **Step 2: Implement projection, crop, mask mapping, and recorded gate evidence**

Convert table metres through manifest origin/scale to canvas pixels, project with each view homography, clip a padded rectangle to the original, restore crop masks to original coordinates, rasterize the polygon, and record overlap, centroid-inside, outside fraction, boundary-zone, and decision reason. Keep thresholds in a typed config and validate them visually before finalizing.

- [ ] **Step 3: Add an injected model adapter and legacy behavior tests**

Ultralytics lives behind `YoloSegModel.predict(image_crop)`; unit tests inject deterministic masks. Manifest v1/v2 stays classical. Explicit `seg` on a manifest without v3 geometry fails with an actionable message rather than scanning arbitrary room content.

- [ ] **Step 4: Run all CV tests and commit**

```bash
.venv/bin/python -m pytest -q
git add pipeline/segdetect.py pipeline/multiview.py tests/test_segdetect.py tests/test_multiview.py
git commit -m "feat: segment original frames inside projected workspace"
```

---

### Task 8: Preserve instances through fusion and use mask-shaped crops

**Files:**
- Modify: `/Users/emily/lego-cv/pipeline/multiview.py`
- Modify: `/Users/emily/lego-cv/pipeline/original_crop.py`
- Modify: `/Users/emily/lego-cv/pipeline/color.py`
- Test: `/Users/emily/lego-cv/tests/test_multiview.py`
- Test: `/Users/emily/lego-cv/tests/test_original_crop.py`
- Test: `/Users/emily/lego-cv/tests/test_color.py`

**Interfaces:**
- Extends `Observation` with optional original mask/confidence/source-instance/gate provenance.
- Uses reliable original masks to isolate Brickognize/color pixels; current Phase-1 quad remains fallback.

- [ ] **Step 1: Write and run failing fusion/crop tests**

```python
def test_bridge_view_cannot_merge_two_instances_from_same_source_frame():
    fused = fuse_observations([left_frame_1, right_frame_1, bridge_frame_2])
    assert len(fused) == 2
    assert all(len({o.frame_id for o in item.observations}) ==
               len(item.observations) for item in fused)

def test_mask_crop_excludes_neighbor_and_retains_padding():
    crop, provenance = masked_instance_crop(original, mask, pad_fraction=.20)
    assert provenance["source"] == "yolo_instance_mask"
    assert target_visible(crop) and not neighbor_visible(crop)
```

Run: `.venv/bin/python -m pytest tests/test_multiview.py tests/test_original_crop.py tests/test_color.py -v`

Expected: mask/provenance tests fail before implementation.

- [ ] **Step 2: Implement mask-aware observation, crop, and color paths**

Retain original masks through fusion, select best complete/sharp observation as before, isolate the instance with neutral context padding, restrict color sampling to reliable mask pixels, and fall back whenever a mask is absent/unreliable.

- [ ] **Step 3: Run all CV tests and commit**

```bash
.venv/bin/python -m pytest -q
git add pipeline tests
git commit -m "feat: preserve segmentation masks through inventory"
```

---

### Task 9: Add CLI diagnostics and product-level evaluation

**Files:**
- Modify: `/Users/emily/lego-cv/session_cli.py`
- Modify: `/Users/emily/lego-cv/README.md`
- Create: `/Users/emily/lego-cv/training/evaluate_sessions.py`
- Test: `/Users/emily/lego-cv/tests/test_session_cli.py`
- Test: `/Users/emily/lego-cv/tests/training/test_evaluate_sessions.py`

**Interfaces:**
- Supports `--detector cv|seg|auto`; auto uses a verified installed segmentation checkpoint, otherwise CV.
- Produces source polygon/crop overlays, accepted/rejected masks, source IDs, table projections, fused IDs, and crop provenance.
- Reports train-seen, validation, and held-out environment separately.

- [ ] **Step 1: Write and run failing CLI/report tests**

```python
def test_auto_falls_back_to_cv_without_segmentation_weights(tmp_path):
    assert resolve_detector("auto", model_path=tmp_path / "missing.pt") == "cv"

def test_seg_debug_writes_workspace_and_gate_overlays(seg_session, tmp_path):
    result = run_session(seg_session, detector="seg", output_dir=tmp_path)
    assert result.workspace_overlay.exists()
    assert result.gate_overlay.exists()

def test_report_never_combines_test_with_train_seen(sample_evaluations):
    report = summarize_by_split(sample_evaluations)
    assert set(report) == {"train_seen", "validation", "test_environment"}
```

Run: `.venv/bin/python -m pytest tests/test_session_cli.py tests/training/test_evaluate_sessions.py -v`

Expected: failures because segmented modes/reports do not exist.

- [ ] **Step 2: Implement modes, diagnostics, and split-aware reports**

Render all required provenance and rejection reasons. Keep the existing box-free mosaic as visualization only.

- [ ] **Step 3: Run historical product regressions**

Evaluate `212422`, `221544`, `234326`, and `005145` with classical and segmentation paths. Require `005145` to show two white instances and total 8 before calling the target bug fixed; label it train-seen if applicable. Verify no regression in physical count, Brickognize crops, color, alternate views, or stud advisory on the other sessions.

- [ ] **Step 4: Evaluate untouched whole sessions and commit**

Run validation and `white_round` test once. Report segmentation and inventory separately and classify failures as segmentation, geometry, fusion, identification, or color.

```bash
.venv/bin/python -m pytest -q
git add session_cli.py training/evaluate_sessions.py README.md tests
git commit -m "feat: evaluate segmented multiview inventory"
```

---

### Task 10: Capture guidance and final verification

**Files:**
- Create: `/Users/emily/lego-cv/docs/phase3-capture-quality.md`
- Modify: `/Users/emily/lego-capture/PROGRESS.md`

**Interfaces:**
- Produces guidance tied to actual audit, geometry, label-QA, and inventory evidence.

- [ ] **Step 1: Write the measured capture-quality report**

Cover within-session blur, height/incidence, repeated views, same-color boundary visibility, glare/darkness, flipped/stacked/occluded pieces, clutter inside/outside the workspace, plane visibility, circular-table edge risk, pose quality, ROI clipping, and bare table. Cite the empty session, four-second bursts, weak-plane white-table captures, dense touching scenes, and sharp gray captures. Do not invent a universal raw-sharpness threshold.

- [ ] **Step 2: Run fresh completion verification**

```bash
cd /Users/emily/lego-capture && .venv/bin/python -m pytest -q
cd /Users/emily/lego-cv && .venv/bin/python -m pytest -q
git -C /Users/emily/lego-capture status --short
git -C /Users/emily/lego-cv status --short
```

Expected: both suites pass; only intentional work plus preserved `IMG_4841.jpg` appears.

- [ ] **Step 3: Record honest gates/results and commit**

Record completed stages, train-seen sessions, held-out results, remaining failure categories, checkpoint hash, and exact next command. Do not claim robustness/generalization beyond held-out evidence.

---

## Initial Audited Split

| Split | Environment | Sessions | Rationale |
|---|---|---|---|
| Train | wood | `145941`, `151014`, `151357`, `151611`, `152048`, `152202`, `152340`, `152721`, `153020`, `153313`, `153423` | Broad layouts/densities; includes densest touching scenes. |
| Train | gray | `154428` | Adds a second surface and the sharpest long capture. |
| Train-seen target | historical | `005145` | Explicit touching-white bug; never generalization evidence. |
| Validation | wood | `150212`, `150350`, `152458`, `153200` | Whole unseen arrangements from sparse to medium/dense. |
| Validation | gray | `154929` | Same environment family, unseen arrangement. |
| Test | white_round | `153942`, `155228` | Entire environment held out; table-edge/clutter and weak-geometry stress. |
| Exclude | unknown | `153911` | Verified zero frames/zero bytes; environment cannot be inferred and is not needed. |

The held-out environment is also the weakest geometry group, so segmentation generalization and full-pipeline geometry performance must be reported separately.

## Self-Review

- Spec coverage: audit/contact sheets, session split/provenance/leakage, annotation QA/human gate, MPS training, original-frame ROI, geometry gating, fusion invariant, mask crops/color, diagnostics, regressions, held-out reporting, and capture guidance are each mapped to a task.
- Placeholder scan: no deferred implementation decisions or unspecified error-handling steps remain; angle-bracket notation is used only to describe generated filename fields or function signatures.
- Type consistency: hard contours are table-metre polygons; runtime converts them through manifest origin/scale and view homography. Selection owns split/provenance. Only verified sidecars enter training. Original masks and canvas boxes remain linked through fusion.
