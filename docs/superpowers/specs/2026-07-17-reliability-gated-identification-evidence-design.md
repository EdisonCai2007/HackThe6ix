# Reliability-Gated Identification Evidence Design

**Date:** 2026-07-17

**Repositories:** `/Users/emily/lego-capture`, `/Users/emily/lego-cv`

**Branch:** `codex/option-a-color-detection` in both repositories

## Objective

Improve the current original-frame multiview inventory pipeline through the
dimension-consistency milestone without regressing piece count, existing
correct identifications, or the established train/validation/test split
discipline.

This design covers:

1. an instance-level acceptance record for session `20260717-202103`;
2. a safe repair for the stud advisory that demoted the correct black Plate
   2 x 12 result;
3. physical-scale measurement of projected instance silhouettes in shadow
   mode;
4. angle-diverse confirmation-view selection and per-view geometry
   provenance;
5. conservative, reliability-gated dimension consistency for regular bricks
   and plates.

Color correction, speed optimization, aerial-map rendering, confirmation UI
implementation, large-batch validation, and changes to the teammate-facing
inventory contract are explicitly outside this design. The current color
pipeline remains unchanged except that the acceptance record may preserve its
existing final outputs for future comparison.

## Existing Architecture to Preserve

The approved pipeline remains:

1. Record3D captures RGB, coarse depth, intrinsics, and pose.
2. Coarse depth estimates the table plane and detector-independent physical
   workspace; it is not piece-level geometry.
3. YOLO11n-seg detects separate instances in selected original RGB frames.
4. Original-frame masks are projected into table coordinates and fused across
   views; observations from the same source frame never fuse.
5. Brickognize identifies each fused instance from original, unwarped,
   mask-isolated crops and returns a ranked candidate list.
6. Stud evidence is advisory.
7. Mask-aware color evidence is aggregated across observations.
8. The stitched top-down remains visualization-only and never becomes the
   detector or identifier source.

No global confidence or size cutoff may be introduced that deletes valid edge,
small, or large pieces. The classical detector remains a fallback.

## Evidence That Corrects the Initial Proposal

### The black 2 x 12 is an advisory failure, not an API failure

In `20260717-202103`, Brickognize returned `Plate 2 x 12` at approximately
`0.8905`. The stud advisory counted four circles, treated that count as
reliable, and demoted the correct result because four is less than one third of
the expected 24 studs. The advisory already applies CLAHE before Hough circle
detection. A Brickognize enhancement retry is therefore not the first fix for
this case.

### Table-projected masks are not literal contact footprints

The original-mask homography is exact only at the table plane. Raised and
side-lying pieces project a view-dependent silhouette onto that plane. A
minimum-area rectangle is useful metric evidence, but it is not always the
canonical stud-grid footprint.

A read-only audit of the saved `20260717-202103` polygons found:

- side-lying blue 2 x 3: about 17–19 mm by 28–30 mm;
- black 2 x 12 plate: usually about 19 mm by 99 mm, with one view distorted to
  about 41 mm by 99 mm;
- light-blue 6 x 12 plate: about 54 mm by 106 mm in strong views; and
- orange 1 x 8: short dimension varying from about 14 mm to 43 mm across
  views.

These measurements can strongly prefer a 2-stud width over a 1-stud width in
the blue side-lying case, but they do not support a universal ±1.5 mm or ±2 mm
hard tolerance. The feature is therefore named **metric silhouette evidence**
rather than physical footprint truth.

### Time diversity is not view-angle diversity

The selected frames for the side-lying blue 2 x 3 are far apart in time but
show essentially the same hidden dimension. The current second-chance path
already reviews the selected alternates when the score is moderate. It cannot
recover visual evidence absent from every selected frame.

## System Design

### 1. Acceptance record and reproducible evidence

Add an instance-level acceptance file for `20260717-202103`. Each physical
piece record contains:

- a stable session-local anchor in table coordinates;
- expected part ID and name;
- expected color;
- pose class: `studs_up`, `side`, `upright`, or `unknown`;
- a `user_verified` boolean; and
- an optional note explaining ambiguity.

Predicted instances are matched one-to-one to ground-truth anchors by minimum
table-coordinate distance with a maximum-distance guard. The evaluator must
report unmatched predictions and unmatched ground-truth pieces rather than
forcing a match. Existing aggregate reference counts remain intact.

The acceptance report records, per instance:

- raw Brickognize top candidate and score;
- final identification and score;
- stud evidence and action;
- metric silhouette evidence and action;
- current final color output (recorded only for future comparison; color
  behavior is not changed or evaluated in this scope);
- selected observation frames; and
- any insufficiency or ambiguity flag.

Cold-cache wall time and stage timings are recorded for observation only in
this scope. They are not optimized until the later speed milestone.

Unverified acceptance entries may be generated as a review worksheet, but
they may not be counted as ground truth or used to tune thresholds until Emily
marks them `user_verified: true`.

### 2. Stud-advisory safety repair

Stud evidence becomes explicitly asymmetric:

- A plausible count can support or rerank a candidate.
- A substantial **overcount** can contradict a candidate because the crop
  contains more stud-like structure than that candidate can explain. This
  preserves the earlier protection against merged crops such as the gray
  6 x 12 case.
- A substantial **undercount** is treated as `not_fully_visible`, not as a
  contradiction. Shadows, black plastic, oblique views, masks, and side pose
  all cause missed circles.
- A high-confidence result remains protected by the existing policy.
- No stud action discards the raw Brickognize result from provenance.

The immediate black Plate 2 x 12 case must therefore retain its correct raw
identification. A retry using an enhanced crop is deferred unless a later
verified case shows Brickognize itself returning an unknown or incorrect raw
candidate.

### 3. Metric silhouette evidence in shadow mode

Create one focused measurement component on the CV side. It consumes accepted
segmentation observations and the manifest scale, and produces per-view and
aggregated evidence.

Per-view measurement:

1. Concatenate the observation's unclipped `polygons_canvas` contours.
2. Fit `cv2.minAreaRect` to the polygon points.
3. Sort the rectangle dimensions as `(short_mm, long_mm)` using
   `manifest["px_per_m"]`.
4. Record segmentation confidence, boundary status, source frame, and view
   geometry.
5. Record unusable measurements with a reason instead of silently dropping
   them.

The clipped raster `mask_canvas` and axis-aligned `box_canvas` are not valid
measurement sources. Polygons are required because valid physical-workspace
pieces can extend beyond the dense visualization canvas.

Aggregation:

- Require at least two usable independent observations for high-reliability
  evidence.
- Prefer observations with better top-downness, complete original-frame masks,
  and non-boundary gate evidence.
- Use a robust median and median absolute deviation after rejecting a clearly
  isolated view outlier.
- Preserve every per-view value, the chosen subset, spread, and rejection
  reason in provenance.
- Classify aggregate reliability as `high`, `medium`, `low`, or `unavailable`.

During shadow mode, measurement is serialized and evaluated but cannot alter
the selected candidate. Calibration reports compare measured dimensions with
known regular pieces from `20260717-202103`, `20260717-005145`, and validation
sessions. Tolerances are derived only from user-verified acceptance/calibration
and train-seen pieces rather than copied from the nominal LEGO manufacturing
tolerance. Validation measurements are reported only after thresholds are
frozen and cannot be used to adjust them.

### 4. Angle-diverse confirmation views

The capture exporter retains the existing coverage-first selection, but view
quality is decomposed into separate values:

- `topdownness`;
- source-frame sharpness;
- camera position in table coordinates; and
- camera bearing around the workspace center, computed from the camera center
  after transforming it into the table frame.

The manifest remains version 3 because these are backward-compatible optional
per-view fields. Older version-3 manifests continue to load with the new fields
set to unavailable.

After coverage gain is exhausted, each confirmation choice maximizes its
minimum circular bearing distance from already selected views among
sufficiently sharp candidates. Time separation remains a secondary tiebreaker
and fallback when bearing is unavailable. Coverage cannot be sacrificed to
obtain angle diversity, and the default maximum of five views does not increase
in this milestone.

The manifest selection report includes pairwise circular bearing separation
and whether the requested confirmation diversity was available in the recorded
scan.
Capture guidance requires one mostly top-down pass plus an overlapping pass
from a meaningfully different side. If the recording contains no diverse
view, downstream code must report `insufficient_view_diversity`; it cannot
claim that crop reranking solved the missing evidence.

### 5. Reliability-gated dimension consistency

Dimension matching initially models only names with safe rectangular grammar:

- `Brick N x M`
- `Plate N x M`

The expected sorted planar dimensions are approximately
`(N * 8 - 0.2, M * 8 - 0.2)` millimetres. Names outside the supported grammar
receive `unmodeled_candidate` and are never rejected by this component.

Each modeled Brickognize candidate receives a dimension error against the
metric silhouette consensus. Rotation is naturally allowed because both pairs
are sorted. Candidate resolution proceeds as follows:

1. Preserve all raw Brickognize candidates.
2. If measurement reliability is low or unavailable, do nothing except record
   the reason.
3. In medium reliability, use dimension agreement only as a soft ranking and
   ambiguity signal.
4. In high reliability, permit a hard veto only when a candidate is separated
   from a better-fitting candidate by more than the calibrated uncertainty
   margin.
5. If every candidate is inconsistent, keep the best raw candidate but flag
   `dimension_mismatch` or `possible_non_canonical_pose`; do not convert it to
   a silent unknown.
6. Do not infer `Plate` versus `Brick` from the same 2D dimensions alone.

Metric evidence runs before the stud advisory. The final decision record
contains raw candidate ranking, metric action, stud action, and final choice so
no sequential heuristic erases the reason for a change.

Unknown-size rescue is conservative: high-reliability dimensions may expose a
regular dimension family such as `2 x 12`, but without appearance evidence the
system emits candidates requiring confirmation rather than inventing a final
Plate/Brick identity. This rescue is not needed for the current black 2 x 12,
whose raw Brickognize result was already correct.

## Data Flow

For each fused instance:

1. Collect accepted original-frame observations.
2. Produce raw Brickognize candidate lists from ranked original crops.
3. Produce per-view metric silhouette measurements and an aggregate with
   reliability.
4. Resolve dimension evidence against supported regular candidates.
5. Apply the asymmetric stud advisory as supporting evidence.
6. Preserve the raw and adjusted identification decision chain.
7. Preserve the existing color result without changing color behavior.
8. Serialize all identification evidence and flags before building aggregate
   inventory.

## Backward Compatibility and Failure Handling

- Version-3 manifests without angle metadata continue to scan.
- Classical-detector observations without segmentation polygons receive
  `metric_evidence: unavailable`; the fallback remains operational.
- Missing, degenerate, or single-view polygons never raise during a normal
  scan; they produce inspectable unavailable/low-reliability evidence.
- Unsupported part names bypass dimension consistency.
- Weak table-plane or cross-view geometry lowers measurement reliability and
  disables hard vetoes.
- External Brickognize failure continues to degrade to an unknown without
  corrupting the local evidence report.
- Existing inventory JSON fields and grouping behavior remain unchanged in
  this scope. Detailed evidence stays in `multiview_result.json` and evaluation
  reports.

## Test and Evaluation Strategy

### Unit tests

- Stud undercount preserves a moderate correct candidate.
- Stud overcount can still contradict an implausibly small candidate.
- Unclipped rotated polygons convert to correct millimetre dimensions.
- Clipped raster masks are not used for metric measurement.
- Robust aggregation rejects a single distorted view and reports its reason.
- Single-view and high-spread measurements cannot hard-veto candidates.
- Supported regular names parse; unsupported names bypass safely.
- Dimension scoring handles rotation and distinguishes 1-stud from 2-stud
  candidates when uncertainty permits.
- All-candidate mismatch preserves the raw answer and adds an ambiguity flag.
- Angle selection prefers useful bearing diversity after coverage is met.
- Legacy version-3 manifests load without new view metadata.

### Synthetic/integration tests

- A synthetic manifest with known scale verifies measurement and provenance
  through `scan_manifest`.
- A three-view fixture verifies angular confirmation selection without losing
  coverage.
- `multiview_result.json` contains the raw-to-final decision chain.

### Real-session gates

Run both complete test suites before and after each implementation chunk.
Evaluate:

- `20260717-202103` as the new manually verified acceptance session;
- `20260717-005145` as train-seen regression evidence;
- at least two untouched validation sessions, including one wood and one gray
  environment; and
- existing held-out sessions only as untouched reporting, never threshold
  tuning data.

Required outcomes through this scope:

1. The black Plate 2 x 12 retains its correct raw identification instead of
   being demoted by an undercount.
2. The side-lying blue 2 x 3 is either corrected by reliable dimension evidence
   or explicitly marked ambiguous/non-canonical; it is never silently accepted
   as 1 x 3 without the evidence conflict being visible.
3. Metric shadow reports demonstrate calibrated error and veto eligibility per
   piece; no global ±2 mm claim is made.
4. Previously correct regular parts do not regress.
5. Every evaluation row states train-seen, validation, or held-out status.

## Rollout and Commit Boundaries

Implementation is divided into independently reviewable commits:

1. acceptance schema, worksheet/reporting, and baseline evidence;
2. asymmetric stud advisory and black-plate regression;
3. shadow-mode metric silhouette measurement and provenance;
4. angle metadata and angle-diverse confirmation selection;
5. calibrated dimension resolver and ambiguity flags.

Each commit must leave both repositories' relevant tests passing. Dimension
decision changes cannot be enabled until the shadow calibration gate is
reviewed. The held-out environment cannot be used to select thresholds.
