# Reliability-Gated Identification Evidence Design

**Date:** 2026-07-17

**Repositories:** `/Users/emily/lego-capture`, `/Users/emily/lego-cv`

**Branch:** `lego-scanner-capture-vision` in both repositories

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

### The black 2 x 12 needs a dark-specific stud detector, not an API retry

In `20260717-202103`, Brickognize returned `Plate 2 x 12` at approximately
`0.8905`. The stud advisory counted four circles, treated that count as
reliable, and demoted the correct result because four is less than one third of
the expected 24 studs.

The selected crop's masked piece pixels have median luminance around 34/255.
The current CLAHE preprocessing followed by the fixed Hough accumulator
threshold (`param2=22`) finds only four circles. On the same saved crop, a
dark-case threshold finds about 22 circles, while a gamma-lifted CLAHE variant
finds about 25. Across the three selected views, the dark variants find about
17–26 rather than 1–13. The same dark-case threshold raises a dark-blue crop
currently identified as Plate 4 x 12 from 44 to a candidate-compatible 48 in
its chosen view.

The immediate cause is therefore a Hough threshold calibrated for stronger
bright-piece edges, not an absence of stud structure. Dark pieces require
their own enhanced detection branch. A Brickognize enhancement retry remains
out of scope because Brickognize itself was correct in this case.

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

### 2. Dark-aware, reliability-gated stud evidence

Stud counting remains a bidirectional advisory, including undercount evidence,
but a count must carry an explicit reliability assessment before it can alter
an identification.

Dark-case activation uses median luminance from the instance mask, not the
predicted LEGO color. This matters because the current black plate is itself
classified as dark gray. The luminance boundary is calibrated on verified
crops and recorded in provenance rather than hidden as an unexplained magic
number.

For a dark instance, the detector evaluates at least two luminance variants:

1. the current grayscale CLAHE path; and
2. a gamma-lifted luminance image followed by CLAHE.

The dark branch uses a separately calibrated Hough accumulator threshold.
Detected circle centers must fall inside the local instance mask, and the
detector preserves each variant's circle positions and count. It also records
whether the circles have plausible radius, spacing, and grid regularity for a
stud face.

The advisory consumes a structured stud-evidence record rather than a bare
integer:

- `count`: the robust count selected from the preprocessing variants;
- `reliability`: `high`, `medium`, `low`, or `unavailable`;
- `visibility`: `stud_face`, `partial`, or `not_visible`;
- per-variant counts and parameters; and
- the reason the evidence received its reliability level.

A plausible reliable count can support or rerank a candidate. A substantial
overcount or undercount can contradict a candidate only when reliability is
high. Low or unavailable evidence is recorded but cannot demote or correct an
identification. This keeps undercount evidence valid when the enhanced detector
actually sees a stud grid while preventing side views, occlusion, or weak masks
from treating missed circles as physical absence. The existing protection for
very high-confidence Brickognize results remains.

The immediate black Plate 2 x 12 gate requires the enhanced branch to recover
non-contradictory, stud-face evidence and retain the correct raw identification.
The earlier gray 6 x 12 merged-crop regression must still be caught by reliable
overcount evidence. No stud action discards the raw Brickognize result from
provenance.

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

The initial implementation freezes a conservative projection tolerance of
`max(8 mm, 35% of the nominal side)`. This is explicitly a silhouette
projection bound, not LEGO manufacturing tolerance. Shadow output required
the wider bound because the known 4 x 12 plate measured about 42.3 mm on its
nominal 31.8 mm side; the side-lying raw 1 x 3 still conflicts on its nominal
7.8 mm side at about 17 mm. Any later tightening requires verified calibration
and cannot use held-out output.

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
5. Apply reliability-gated standard or dark-aware stud evidence.
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

- The exact black 2 x 12 fixture activates the dark branch and recovers a
  non-contradictory count from the visible stud face.
- The dark-blue 4 x 12 fixture preserves or improves its candidate-compatible
  stud count.
- A dark 2 x 2 fixture does not hallucinate an implausible grid.
- A side-view crop with no visible stud face remains low/unavailable and cannot
  demote a candidate.
- A high-reliability undercount or overcount can still contradict an
  incompatible candidate.
- Bright-piece behavior remains unchanged by the dark branch.
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

1. The black Plate 2 x 12's enhanced stud evidence becomes compatible with its
   expected stud grid, and it retains the correct raw identification.
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
2. dark-aware, reliability-gated stud evidence and black-plate regression;
3. shadow-mode metric silhouette measurement and provenance;
4. angle metadata and angle-diverse confirmation selection;
5. calibrated dimension resolver and ambiguity flags.

Each commit must leave both repositories' relevant tests passing. Dimension
decision changes cannot be enabled until the shadow calibration gate is
reviewed. The held-out environment cannot be used to select thresholds.
