# Reliability-Gated Identification Evidence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add reproducible instance acceptance, dark-aware stud evidence, metric silhouette measurement, angle-diverse capture selection, and conservative dimension consistency without changing color behavior.

**Architecture:** Keep YOLO segmentation, table-space fusion, original-frame Brickognize crops, and inventory grouping intact. Add independent evidence components which return serializable dataclasses; integrate their decision chain around the existing Brickognize result, with reliability gates preventing weak geometric or stud evidence from changing identity.

**Tech Stack:** Python 3, NumPy, OpenCV, pytest, JSON, existing Record3D/table-plane and YOLO/Brickognize pipeline.

## Global Constraints

- Work in `codex/option-a-color-detection` in both repositories; do not create, merge, push, or delete branches.
- Do not modify color classification, illumination normalization, palette values, inventory grouping, or the teammate-facing `inventory.json` schema.
- Preserve `/Users/emily/lego-cv/IMG_4841.jpg` and all user-owned session data.
- Keep manifest version 3; new view-geometry fields are optional and old version-3 manifests must load.
- Never use the stitched top-down mosaic as detector or identifier input.
- Never add a global confidence or size cutoff that removes edge, small, or large pieces.
- Raw Brickognize candidates and the raw top result must remain in provenance even when evidence changes the final result.
- Only `Brick N x M` and `Plate N x M` use dimension consistency; unsupported names bypass it.
- Low/unavailable metric or stud evidence cannot alter an identification.
- Dimension evidence runs before stud evidence; color runs unchanged afterward.
- Do not use held-out data to tune thresholds. Label every evaluation row `train_seen`, `validation`, or `test_environment`.

## File Map

- `training/acceptance.py`: acceptance schema, one-to-one anchor matching, worksheet generation, and verified-only scoring.
- `training/acceptance/20260717-202103.json`: unverified review worksheet for the new session.
- `pipeline/studs.py`: structured dark/bright stud evidence and reliability-gated advisory.
- `pipeline/footprint.py`: per-view polygon measurement and robust metric silhouette aggregation.
- `pipeline/dimensions.py`: regular-name parsing, measurement compatibility, reranking, and ambiguity flags.
- `pipeline/multiview.py`: carries view geometry and orchestrates raw ID → metric decision → stud decision.
- `session_cli.py`: serializes stage timings and the evidence chain.
- `/Users/emily/lego-capture/multiview.py`: computes camera geometry and selects confirmation views by bearing.
- Tests mirror each focused module and retain existing bridge/CLI contracts.

---

### Task 1: Acceptance Record and Timed Baseline

**Files:**
- Create: `training/acceptance.py`
- Create: `training/acceptance/20260717-202103.json`
- Create: `tests/training/test_acceptance.py`
- Modify: `pipeline/multiview.py`
- Modify: `session_cli.py`
- Modify: `tests/test_session_cli.py`

**Interfaces:**
- Produces: `AcceptancePiece`, `load_acceptance(path: str | Path) -> list[AcceptancePiece]`, `match_acceptance(expected: list[AcceptancePiece], predicted: list[dict], max_distance_m: float = 0.03) -> AcceptanceMatches`, `acceptance_report(expected: list[AcceptancePiece], predicted: list[dict], max_distance_m: float = 0.03) -> dict`, and `worksheet_from_result(session_id: str, result) -> dict`.
- Produces: `MultiViewScanResult.timings_s: dict[str, float]` with `load`, `detect`, `fuse`, `identify`, `evidence`, `color_inventory`, and `total` keys.
- Acceptance scoring consumes only entries whose `user_verified` is `true`; unverified entries are emitted under `review_required` and excluded from accuracy denominators.

- [ ] **Step 1: Write failing acceptance tests**

```python
def test_anchor_matching_is_one_to_one_and_distance_guarded():
    expected = [piece("a", (0.10, 0.10)), piece("b", (0.12, 0.10))]
    predicted = [prediction("p", (0.101, 0.10)), prediction("far", (0.80, 0.80))]
    matches = match_acceptance(expected, predicted, max_distance_m=0.03)
    assert [(m.expected_id, m.predicted_id) for m in matches.matches] == [("a", "p")]
    assert matches.unmatched_expected == ["b"]
    assert matches.unmatched_predicted == ["far"]

def test_unverified_entries_are_never_scored_as_ground_truth():
    report = acceptance_report(
        [piece("review", (0.1, 0.1), user_verified=False)],
        [prediction("p", (0.1, 0.1))],
    )
    assert report["verified_piece_count"] == 0
    assert report["accuracy"] is None
    assert report["review_required"] == ["review"]
```

- [ ] **Step 2: Run the focused tests and verify failure**

Run: `pytest -q tests/training/test_acceptance.py`

Expected: collection fails because `training.acceptance` does not exist.

- [ ] **Step 3: Implement the acceptance schema and matcher**

```python
@dataclass(frozen=True)
class AcceptancePiece:
    instance_id: str
    anchor_table_xy_m: tuple[float, float]
    expected_part_id: str | None
    expected_name: str | None
    expected_color: str | None
    pose: Literal["studs_up", "side", "upright", "unknown"]
    user_verified: bool
    note: str = ""

def match_acceptance(expected, predicted, max_distance_m=0.03):
    pairs = sorted(
        (distance(piece.anchor_table_xy_m, item["anchor_table_xy_m"]), piece, item)
        for piece in expected for item in predicted
    )
    used_expected, used_predicted, matches = set(), set(), []
    for separation, piece, item in pairs:
        if separation > max_distance_m:
            break
        if piece.instance_id in used_expected or item["instance_id"] in used_predicted:
            continue
        matches.append(AcceptanceMatch(piece.instance_id, item["instance_id"], separation))
        used_expected.add(piece.instance_id)
        used_predicted.add(item["instance_id"])
    return AcceptanceMatches(
        matches,
        [p.instance_id for p in expected if p.instance_id not in used_expected],
        [p["instance_id"] for p in predicted if p["instance_id"] not in used_predicted],
    )
```

Validate required fields and pose values on load. Serialize anchors as two finite numbers. Build worksheets from fused-instance table-box centers, preserving current `id_crop` evidence but setting every generated row to `user_verified: false`.

- [ ] **Step 4: Add stage timings without changing outputs**

Instrument `scan_manifest` with `time.perf_counter()` around load, detection/observation construction, fusion, identification/second chance, evidence, and color/inventory. Store durations on `MultiViewScanResult.timings_s`; add the dictionary to `multiview_result.json` but not `inventory.json`.

- [ ] **Step 5: Generate the session worksheet and add CLI serialization tests**

Run the existing cached segmentation scan for `/Users/emily/lego-capture/sessions/20260717-202103/multiview/manifest.json`, generate 29 anchored worksheet rows, and assert in the fixture-based CLI test that `timings_s.total >= max(timings_s.values() excluding total)`.

- [ ] **Step 6: Verify and commit**

Run: `pytest -q tests/training/test_acceptance.py tests/test_session_cli.py tests/test_multiview.py tests/test_multiview_bridge.py`

Expected: all pass.

Commit: `git commit -m "feat: add instance acceptance baseline"`

---

### Task 2: Dark-Aware Structured Stud Evidence

**Files:**
- Modify: `pipeline/studs.py`
- Modify: `pipeline/multiview.py`
- Modify: `tests/test_studs.py`
- Modify: `tests/test_multiview_bridge.py`

**Interfaces:**
- Produces `StudVariant(name, count, centers_xy, gamma, hough_param2)` and `StudEvidence(count, reliability, visibility, is_dark, median_luma, variants, reason)` with `to_dict()`.
- Produces `analyze_studs(crop_bgr, radius_px, mask=None) -> StudEvidence`.
- Changes `advise(ident, evidence: StudEvidence | int) -> tuple[Identification, str]`; integer support remains for compatibility with callers/tests.
- The chosen identification crop's local instance mask is reconstructed from the observation matching `frame_id` and `source_instance_id` in `id_crops`, including second-chance crops.

- [ ] **Step 1: Write failing detector and decision tests**

```python
def test_dark_2x12_grid_uses_enhanced_variants():
    image, mask = synthetic_dark_grid(rows=2, cols=12, radius=11)
    evidence = analyze_studs(image, radius_px=11, mask=mask)
    assert evidence.is_dark
    assert 18 <= evidence.count <= 30
    assert evidence.visibility == "stud_face"
    assert evidence.reliability in {"high", "medium"}
    assert {v.name for v in evidence.variants} >= {"clahe", "gamma_clahe"}

def test_low_reliability_undercount_cannot_demote():
    evidence = StudEvidence(4, "low", "partial", True, 34.0, (), "variants disagree")
    out, action = advise(ident("2445", "Plate 2 x 12", 0.89), evidence)
    assert out.part_id == "2445"
    assert action == "unreliable"
```

Also test: dark 2×2 does not hallucinate a large grid; side/blank view is low or unavailable; high-reliability overcount and undercount still contradict; the existing bright synthetic and real fixtures stay within their previous assertions.

- [ ] **Step 2: Run focused tests and verify the new assertions fail**

Run: `pytest -q tests/test_studs.py tests/test_multiview_bridge.py`

Expected: failures for missing `StudEvidence` and `analyze_studs`.

- [ ] **Step 3: Implement masked luminance and variant detection**

Use masked median grayscale luminance; activate the dark branch below `DARK_LUMA_THRESHOLD = 50.0`. Preserve the existing CLAHE/Hough path (`param2=22`) for bright crops. For dark crops, run CLAHE and gamma-0.5 luminance + CLAHE with `param2=16`. Test radius factors `0.7` and `1.0`, retain the better scale per variant, and discard circle centers outside the local mask.

Use the rounded median of nonzero variant counts. Rate evidence high only when at least two variants detect a plausible grid and their spread is at most `max(3, 0.25 * median_count)`; medium for a plausible grid with greater but bounded spread; low for fewer than four circles, severe disagreement, implausible spacing, or weak mask support. Record all counts, centers, and thresholds.

- [ ] **Step 4: Gate both positive and negative advisory actions by reliability**

```python
if evidence.reliability not in {"high", "medium"}:
    return ident, "unreliable"
if _contradicts(evidence.count, expected_studs(ident.name)):
    if evidence.reliability != "high":
        return ident, "ambiguous"
    # retain existing candidate correction/demotion logic
```

Keep the `score >= 0.90` protection. Preserve raw identification before calling `advise`; serialize `brickognize_raw`, structured `stud`, and final `brickognize`.

- [ ] **Step 5: Verify exact real-session black crop**

Run the 202103 scan from cache. Locate part `2445` by raw result and assert its stud record is dark, is no longer a four-count high-confidence contradiction, and final part remains `2445`. Inspect the dark-blue 4×12 and dark 2×2 records for compatible/non-hallucinatory evidence.

- [ ] **Step 6: Verify and commit**

Run: `pytest -q tests/test_studs.py tests/test_multiview_bridge.py tests/test_session_cli.py`

Expected: all pass.

Commit: `git commit -m "feat: add reliable dark-piece stud evidence"`

---

### Task 3: Metric Silhouette Evidence in Shadow Mode

**Files:**
- Create: `pipeline/footprint.py`
- Create: `tests/test_footprint.py`
- Modify: `pipeline/multiview.py`
- Modify: `tests/test_multiview_bridge.py`
- Modify: `session_cli.py`

**Interfaces:**
- Produces `SilhouetteMeasurement(frame_id, short_mm, long_mm, usable, reason, confidence, boundary_zone, topdownness)`.
- Produces `MetricSilhouette(short_mm, long_mm, reliability, measurements, used_frame_ids, rejected_frame_ids, spread_mm, reason)` with `to_dict()`.
- Produces `measure_observation(observation, px_per_m, view=None)` and `aggregate_measurements(measurements)`.
- Adds one `metric_silhouette` record to every `id_crop`; this task always sets its action to `shadow_only` and cannot change IDs.

- [ ] **Step 1: Write failing measurement tests**

```python
def test_rotated_unclipped_polygon_converts_to_mm():
    polygon = cv2.boxPoints(((250, 180), (199.6, 39.6), 27))
    observation = obs(polygons_canvas=(polygon,), mask_canvas=np.zeros((20, 20), np.uint8))
    measured = measure_observation(observation, px_per_m=2000.0)
    assert measured.short_mm == pytest.approx(19.8, abs=0.3)
    assert measured.long_mm == pytest.approx(99.8, abs=0.3)

def test_aggregate_rejects_one_distorted_view():
    result = aggregate_measurements([measurement(19, 99), measurement(20, 100), measurement(41, 99)])
    assert result.reliability == "high"
    assert result.short_mm == pytest.approx(19.5)
    assert result.rejected_frame_ids == [3]
```

Test degenerate/no polygons → unavailable, one usable view → low, high spread → low/medium, and classical observations → unavailable without raising.

- [ ] **Step 2: Run focused tests and verify failure**

Run: `pytest -q tests/test_footprint.py`

Expected: collection fails because `pipeline.footprint` does not exist.

- [ ] **Step 3: Implement polygon-only measurement**

Concatenate all finite `polygons_canvas` points, require at least three unique points, call `cv2.minAreaRect`, sort rectangle sides, and convert pixels to millimetres with `1000 / px_per_m`. Record confidence, boundary status, and optional view geometry. Never consult `mask_canvas` or `box_canvas` for dimensions.

- [ ] **Step 4: Implement robust aggregation**

Sort by source frame, reject at most one isolated dimension outlier when two remaining views agree within `max(4 mm, 15%)`, compute median dimensions and MAD spread, and rate: high for two or more agreeing independent views; medium for two useful views with moderate spread; low for a single view or high spread; unavailable for none. Every rejection carries a reason.

- [ ] **Step 5: Integrate shadow serialization**

Measure each fused instance before any advisory, attach `{"action": "shadow_only", "evidence": aggregate.to_dict()}` to `id_crops`, and add a synthetic bridge test proving the record survives `scan_manifest` and `multiview_result.json` without changing the fake Brickognize part.

- [ ] **Step 6: Verify and commit**

Run: `pytest -q tests/test_footprint.py tests/test_multiview_bridge.py tests/test_session_cli.py tests/test_multiview.py`

Expected: all pass.

Commit: `git commit -m "feat: measure metric silhouettes in shadow mode"`

---

### Task 4: Angle-Diverse Confirmation Views and Provenance

**Files:**
- Modify: `/Users/emily/lego-capture/multiview.py`
- Modify: `/Users/emily/lego-capture/tests/test_multiview.py`
- Modify: `pipeline/multiview.py`
- Modify: `tests/test_multiview.py`

**Interfaces:**
- Extends capture `ViewCandidate` with optional `topdownness`, `sharpness_score`, `camera_position_table_xyz`, and `camera_bearing_deg` defaults.
- Adds `circular_separation_deg(a, b)` and `selection_geometry(selected, minimum_diversity_deg=30.0)`.
- Extends CV `RectifiedView` with the same optional fields and loads missing fields as `None`.

- [ ] **Step 1: Write failing capture selector tests**

```python
def test_confirmation_selection_prefers_bearing_after_coverage():
    candidates = [
        candidate(0, 10, full, bearing=5),
        candidate(10, 8, full, bearing=12),
        candidate(20, 8, full, bearing=100),
    ]
    selected = select_covering_views(candidates, max_frames=2, min_frames=2)
    assert [item.frame_id for item in selected] == [0, 20]
```

Also test circular wrap-around (`355°` versus `5°` is `10°`), fallback to time diversity when bearings are absent, and no loss of coverage-first behavior.

- [ ] **Step 2: Run capture tests and verify failure**

Run: `pytest -q tests/test_multiview.py` in `/Users/emily/lego-capture`.

Expected: the new angle test fails because `ViewCandidate` lacks bearing metadata.

- [ ] **Step 3: Compute capture geometry and update selection**

For each frame, compute `topdownness = _topdownness(record, table_frame)`, `sharpness_score = sharpness(record.load_rgb())`, and quality as before. Transform the camera center with `world_to_table @ [pose_mat[:3, 3], 1]`. Compute bearing using `degrees(atan2(camera_y - center_y, camera_x - center_x)) % 360`, where center is the canvas workspace center.

After coverage gain is exhausted, restrict to the existing sufficiently sharp/quality candidates, then maximize minimum circular bearing separation from selected candidates. Use minimum time separation, quality, and lower frame ID as deterministic tiebreakers. If no candidate has usable bearing, retain the old time-diverse path.

- [ ] **Step 4: Serialize optional manifest fields and selection report**

Each view records the four decomposed values. `selection.strategy` becomes `coverage_then_angle_diverse_quality`, and the selection report contains pairwise bearing separations, `minimum_bearing_separation_deg`, `requested_minimum_deg: 30.0`, and `angle_diverse`. Missing recorded diversity yields `angle_diverse: false`, not a fabricated result.

- [ ] **Step 5: Add backward-compatible CV loading**

Load each optional field into `RectifiedView`. Add one test for populated geometry and one legacy version-3 manifest test asserting all four fields are `None` and scanning still succeeds.

- [ ] **Step 6: Verify and commit each repository**

Run in capture: `pytest -q`

Expected: all capture tests pass.

Commit in capture: `git commit -m "feat: select angle-diverse confirmation views"`

Run in CV: `pytest -q tests/test_multiview.py tests/test_multiview_bridge.py`

Expected: all pass.

Commit in CV: `git commit -m "feat: load capture view geometry"`

---

### Task 5: Reliability-Gated Dimension Consistency and Final Evaluation

**Files:**
- Create: `pipeline/dimensions.py`
- Create: `tests/test_dimensions.py`
- Modify: `pipeline/multiview.py`
- Modify: `tests/test_multiview_bridge.py`
- Modify: `session_cli.py`
- Modify: `training/acceptance.py`
- Modify: `training/evaluate_sessions.py`
- Modify: `tests/training/test_evaluate_sessions.py`
- Modify: `PROGRESS.md`

**Interfaces:**
- Produces `RegularDimensions(kind, studs_short, studs_long, short_mm, long_mm)` from `parse_regular_dimensions(name)`.
- Produces `DimensionDecision(identification, action, flag, candidate_scores, proposed_family, reason)` with `to_dict()`.
- Produces `resolve_dimensions(identification, metric: MetricSilhouette) -> DimensionDecision`.
- Initial conservative compatibility tolerance is `max(8.0 mm, 0.35 * expected_dimension_mm)` per dimension; it is recorded in provenance and not represented as LEGO manufacturing tolerance. The wider projection bound was frozen after shadow mode showed a known 4×12 plate at 42.3 mm across its nominal 31.8 mm side, while the side-lying 1×3-versus-2×3 conflict still exceeded the 8 mm small-side allowance.

- [ ] **Step 1: Write failing parser and resolver tests**

```python
def test_parser_accepts_only_regular_brick_and_plate_names():
    assert parse_regular_dimensions("Brick 2 x 3").studs == (2, 3)
    assert parse_regular_dimensions("Plate 12 x 2").studs == (2, 12)
    assert parse_regular_dimensions("Wedge, Plate 2 x 3") is None

def test_all_candidate_mismatch_keeps_raw_and_flags_pose():
    raw = ident("3622", "Brick 1 x 3", 0.77, candidates=(candidate("3622", "Brick 1 x 3", 0.77),))
    metric = silhouette(17.5, 28.5, reliability="high")
    decision = resolve_dimensions(raw, metric)
    assert decision.identification is raw
    assert decision.action == "flagged"
    assert decision.flag in {"dimension_mismatch", "possible_non_canonical_pose"}
    assert decision.proposed_family == "2 x 3"
```

Also test rotation, unsupported-name bypass, low reliability skip, compatible raw retention, a high-reliability clearly better existing candidate rerank, and no Brick-versus-Plate inference from dimensions alone.

- [ ] **Step 2: Run focused tests and verify failure**

Run: `pytest -q tests/test_dimensions.py`

Expected: collection fails because `pipeline.dimensions` does not exist.

- [ ] **Step 3: Implement parsing, errors, and conservative resolver**

Use exact regex `^(Brick|Plate) (\d+) x (\d+)$`; expected millimetres are sorted `(n * 8 - 0.2, m * 8 - 0.2)`. Calculate normalized excess beyond the recorded per-side tolerance. Low/unavailable evidence only records `insufficient_metric_evidence`. Medium evidence can soft-rank/flag but cannot change IDs. High evidence may select an existing candidate with score at least `0.50` only when it fits and the raw candidate exceeds tolerance. If all modeled candidates mismatch, preserve raw and flag. Build the proposed family by retaining each raw stud dimension already inside tolerance and rounding only conflicting dimensions; this produces the inspectable `2 x 3` proposal for the side-lying raw `1 x 3` without inventing a part ID or Brick/Plate kind.

- [ ] **Step 4: Integrate the ordered evidence chain**

In `scan_manifest`, preserve `brickognize_raw` immediately after second chance. Attach metric evidence, call `resolve_dimensions`, serialize its decision, then apply stud evidence to that result. Serialize final `brickognize`. Add `insufficient_view_diversity` to each affected decision when manifest selection explicitly reports `angle_diverse: false`; legacy manifests use `view_diversity_unknown` rather than failing.

- [ ] **Step 5: Extend acceptance/evaluation reporting**

For matched verified pieces report raw/final part correctness, stud action, metric action/flag, selected observation frames, final unchanged color, and ambiguity. Keep unverified 202103 rows out of accuracy. Add new-session metadata to evaluation without calling it validation: `split: acceptance_review`, `environment: current_gray`, `expected_count: 29`, source `current_fused_review_worksheet` until user verification.

- [ ] **Step 6: Run complete suites**

Run in CV: `pytest -q`

Run in capture: `pytest -q`

Expected: both complete suites pass with no regressions.

- [ ] **Step 7: Run real-session gates without tuning on held-out data**

Regenerate/export angle metadata for `20260717-202103`, scan it with the cached segmentation model and Brickognize cache, and generate acceptance evidence. Confirm 29 fused pieces, black `2445` retained, and the blue side-lying piece carries a visible metric conflict if not corrected from an existing candidate.

Run the train-seen `20260717-005145`, at least one wood validation and one gray validation session, then held-out `20260717-155228` for reporting only. Compare before/after raw and final regular-part IDs and record any regression. Do not change thresholds based on held-out output.

- [ ] **Step 8: Document verified facts and residual review work**

Update `PROGRESS.md` with exact commands/counts, threshold provenance, current acceptance verification state, black-plate result, blue-side-piece flag, suite totals, and the explicit exclusions (color, speed, rendering, UI, large-batch expansion).

- [ ] **Step 9: Verify and commit**

Run focused dimension/integration tests once more, inspect `git diff --check` and both worktrees, and commit only scoped files.

Commit in CV: `git commit -m "feat: gate identification with metric dimensions"`

If capture documentation changed after Task 4, commit it separately as `docs: record reliability evidence rollout`.

---

## Completion Gate

- Both repository test suites pass from clean commands.
- `20260717-202103` still produces 29 fused pieces.
- The black Plate 2×12 raw and final IDs remain `2445`; enhanced stud evidence does not demote it.
- The side-lying blue 2×3 is either selected from a supplied compatible candidate or visibly flagged `dimension_mismatch`/`possible_non_canonical_pose`.
- Existing `inventory.json` fields and color behavior are unchanged.
- Old version-3 manifests and classical detector fallback scan without exceptions.
- Acceptance accuracy is `null` until Emily verifies worksheet rows.
- No held-out result influenced a threshold.
