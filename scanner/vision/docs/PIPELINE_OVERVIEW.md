# The LEGO Scanner CV Pipeline — How It Actually Works

*Written 2026-07-18, from the source code and PROGRESS.md of `lego-capture` and
`lego-cv` on branch `lego-scanner-capture-vision`. Every number below comes
from an actual session result or an actual test run, not a hypothetical.*

## Why this document exists

This is a two-person hackathon project: one person scans a pile of LEGO
pieces with a LiDAR iPhone; the other's software turns that inventory into a
buildable 3D model. This document covers the first half — turning a phone
scan into an accurate `inventory.json`. It looks like it should be a
weekend's work: "run a detector, look up each box, count them." It is not.
Nearly every stage below exists because a simpler, more obvious approach was
tried first and produced a *specific, reproducible* wrong answer. The
codebase is currently **~2,100 lines** in `lego-capture` (capture, geometry,
view export) and **~6,300 lines** in `lego-cv` (detection, fusion,
identification, color, review tooling), covered by **90 + 326 = 416
automated tests**. This walkthrough follows one phone scan through every
stage, explaining what each stage replaced and why.

---

## 1. Capture

**What it does.** `lego-capture/capture.py` connects to the Record3D app on
a LiDAR iPhone over USB and, on each frame, saves four things: the full-res
RGB image, the low-res LiDAR depth map, the camera's intrinsics (focal
length, principal point), and its 6-DOF pose (position + orientation). All
four are snapshotted **inside the stream callback, at one instant**, before
being handed off — the comment in the code is blunt about why: *"pose and
pixels must match exactly."* If you instead called `get_rgb_frame()` and
`get_pose()` a few milliseconds apart, a moving phone would silently desync
the two, and every downstream geometric calculation (table fitting, mask
projection, footprint measurement) would be built on a lie.

**Why depth is a supporting actor, not the star.** LiDAR depth from an
iPhone is coarse — good enough to find a table plane, useless for resolving
individual LEGO studs. The pipeline treats it that way explicitly: depth is
used only for plane-fitting and workspace geometry, never for detecting or
measuring pieces. (One documented design constraint the team enforces:
*"treating coarse Record3D depth as piece-level geometry"* is a rejected
idea, not a limitation someone forgot to fix.)

**The single-client trap.** Record3D streams to exactly one USB client at a
time. A second client (e.g., two terminal windows running capture scripts)
connects successfully, lists the device, and then receives **zero frames,
forever, with no error**. This was diagnosed the hard way: instrumenting the
callback showed it genuinely never fired, even with code that mirrored a
known-working demo byte-for-byte — the bug was external process state, not
logic. The fix isn't a retry loop (there's nothing to retry); it's a
watchdog that, after 5 seconds of connected-but-silent, prints the two real
causes (stale competing client, or the phone app not actively streaming)
instead of hanging silently.

**Table plane and the workspace/coverage split.** `plane.py` pools point
clouds from a dozen frames, downsamples them, and runs RANSAC plane
segmentation (via Open3D) to find the table and build a table-local
coordinate frame (table surface = z=0). `coverage.py` then tracks, per
3mm grid cell, how many frames observed it and from which directions. This
module actually maintains **three different notions of "the table area,"**
which is easy to conflate and was a real, fixed bug:

- `hull_mask` — the convex hull of everything ever observed. Too greedy: a
  stray glance at the floor or a laptop drags the hull out to include it,
  which is why an early version of this pipeline permanently boxed
  background clutter as "unknown brick."
- `workspace_mask` — the densely, repeatedly observed core (cells seen in
  ≥80% of the frames that saw the *most*-seen cell). Good for a human-facing
  coverage percentage, bad as a detector boundary: if the camera lingers over
  the center of the table, this mask can *shrink away from real edge
  pieces* just because they were seen less often.
- `admissible_workspace_mask` — the newest of the three, and the one that
  actually gates detection. It has **no density threshold** — any
  repeatedly-observed patch of table counts, so a piece near the edge isn't
  penalized for getting fewer camera passes than the center. Concretely, on
  session `20260717-233252`, switching the detector's search region to this
  mask grew the usable export canvas from 340×430 to 961×868 pixels (from
  roughly 13×17 cm to 48×43 cm of usable table) — the earlier, denser mask
  was silently throwing away a third of the real table.

**View selection: coverage first, then deliberate disagreement.**
`lego-capture/multiview.py` doesn't hand every recorded frame to the
detector — a typical session has 100–400 frames, and running detection on
all of them would be slow and would multiply fusion work for no benefit.
Instead it does a two-resolution trick: candidate views are scored for
usable coverage at a *cheap* 250 px/m, and only the small selected set (≤5
frames) gets rectified at the *expensive* final 2000 px/m. Selection is a
greedy set-cover over the table's valid-pixel union — but with a twist that
only makes sense once you know what breaks without it: once coverage
crosses 95%, the algorithm **deliberately reserves up to 2 of its final
slots for a view from a different camera bearing**, even if that view adds
almost no new pixel coverage. The reasoning, spelled out in the code: pixel
coverage tells you the table was *photographed*, not that a false
detection can be *contradicted* by an independent angle. On session
`233252`, this produced a 3-coverage + 2-confirmation view set with camera
rays separated by 38°–78°, and the manifest **honestly reports when it
can't hit its own coverage target** — that session tops out at 97.5% of the
hard workspace within a 5-view budget (99.5% would need 9 views), and the
exported manifest says `coverage_complete: false` with a stated reason
rather than quietly claiming success.

**Known limitation:** small or oddly-shaped tables produce weak plane fits
(observed inlier fractions as low as 0.587–0.705, versus ~0.94–1.00 on
normal tables), and everything downstream — workspace shape, view
selection, fusion — inherits that weakness. This is a capture-quality
problem, not something later stages can fully compensate for.

---

## 2. Detection: from "smarter heuristics" to a trained model

**What was tried first, and why it failed.** The original detector was
classical OpenCV: background-subtraction contours, later augmented with a
color-aware watershed splitter (`pipeline/instance_split.py`, still present
as a fallback path). It worked for well-separated, differently-colored
pieces. It could not solve — and *no amount of threshold tuning* was ever
going to solve — two pieces of the **same color touching each other**,
because a contour detector reasons about connected blobs of contrasting
pixels, not physical objects. The project's canonical failure case, session
`20260717-005145`, has two white plates touching; classical detection saw
one blob, one piece, forever. Separately, running the classical detector on
raw full frames without a workspace mask over-detected background as pieces
(14–26 boxes against 7–8 real ones) — cables, table edges, and clothing all
read as "unknown brick."

**The actual fix: a trained instance-segmentation model, scoped narrowly.**
`pipeline/segdetect.py` runs a `yolo11n-seg` model, but with a deliberately
small job: **one class, `lego_piece`.** The model's only question is "is
this pixel region one physical LEGO piece, separate from its neighbors and
from the table?" It does *not* try to guess which piece, or what color —
that division of labor matters: identity is a much harder open-vocabulary
problem, and it's already solved (see §4). Making the trained model's job
this narrow is why a genuinely small dataset was enough to fix a hard
geometric problem instead of needing a huge labeled catalog.

**Dataset construction, and the leak everyone gets wrong.** Training frames
were pulled from 19 usable capture sessions (a 20th, `20260717-153911`,
recorded zero frames — the single-client bug bit during data collection,
too). Frame selection deliberately picked *diverse, sharp, non-duplicate*
frames rather than every frame of a sweep, because adjacent frames from one
physical layout are near-duplicates of each other. That distinction drives
the split: **train/val/held-out boundaries are drawn at the whole-session
level**, never the frame level. If you split by frame instead, a training
frame and a validation frame from the *same physical arrangement of the
same 15 pieces* can end up on opposite sides of the split — validation
accuracy then measures memorization, not generalization, and looks great
right up until a real new scan. The final reviewed set: **71 frames, 1,157
hand-verified instance polygons**, split 48 train / 15 validation / 8
held-out. The held-out set is a physically different table (a white round
table, versus the wood/gray surfaces everything else was captured on) —
genuinely unseen conditions, not just an unseen photo.

**A real bug worth naming:** Labelme (the annotation tool) legitimately
emits a boundary point at exactly `x = image_width` or `y = image_height`
when a polygon vertex sits on the visible edge of the image. The import
validator initially treated any coordinate ≥ width−1 as malformed and
rejected 9 vertices across 4 files. The fix distinguishes a true overshoot
(a real bug) from an inclusive boundary value (legitimate), clamping the
latter — with tests for both cases. Small, but exactly the kind of bug that
silently corrupts a dataset if it isn't caught.

**Training and metrics.** `yolo11n-seg` trained locally on Apple MPS,
1 class, 100 epochs, in 597 seconds (~10 minutes). Frame-level mask
mAP50-95: **0.847 train-seen, 0.837 validation, 0.877 held-out**. It's
worth being explicit about what this number is *not*: it measures how well
predicted pixel masks overlap ground-truth masks on individual frames — it
is a segmentation-quality metric, not an inventory-accuracy metric. A
session can have excellent mask overlap and still miscount pieces if
fusion or identification goes wrong downstream, which is why the project
tracks a separate, harder number:

**End-to-end product counts** (fused piece count vs. a manually verified
reference, after the *entire* pipeline including fusion and identification
gating): train-seen sessions 7/7, 8/8, 8/8, 8/8 (the touching-white case,
`005145`, now separates correctly). Five untouched validation sessions:
14/14, 7/7, 23/23 (one identification-unknown, not a miss), 8/8, 15/15. The
held-out white-round table: 11/11 and 17/19 — the shortfall there is
explicitly attributed to weak table-plane geometry (low RANSAC inlier
fraction) compounding with fusion instability, not a segmentation failure —
individual views in that session actually contained 24, 19, and 18 accepted
masks; only fusion across unstable projections lost two real pieces. The
project's own log is explicit that this result was **not retuned after
being observed**, specifically so it stays meaningful as held-out evidence.

**Gating, not just detection.** The model never sees a raw full-resolution
frame. `segdetect.py` projects the hard admissible workspace polygon (§1)
into each original frame via that view's homography, crops a padded
region-of-interest, and runs inference only inside it — cheaper, and it
structurally prevents desk/background clutter outside the table from ever
reaching the model. Every returned mask then passes `gate_instance()`: a
confidence floor (0.20), a workspace-overlap floor (50%, with an 80%
"strong overlap" exception for masks whose centroid falls outside due to
partial framing), and boundary-zone handling — a mask touching the ROI or
workspace edge needs either high confidence or strong overlap to survive,
rather than either a blanket size cutoff (which would also delete real
small/edge pieces) or blind acceptance (which would let table-edge clutter
through). A same-view duplicate suppressor separately catches the case
where the model fires two near-identical masks on one piece in one photo
(mask IoU ≥ 0.65, containment ≥ 0.85) — it doesn't delete the loser, it
tags it `duplicate_suppressed` and keeps it in the audit trail. On one
session this consolidated 8 duplicate pairs and correctly merged a white
Plate 1×6 that had been double-counted as two separate components.

**Known limitation:** the training set is dominated by wood-table sessions
(51 of 71 images); transparent, highly reflective, stacked, or heavily
occluded pieces are not validated at all.

---

## 3. Geometry: table-coordinate fusion, and why the mosaic isn't the truth

**Three abandoned approaches, and what each one taught.** Before landing on
the current design, the project tried and rejected three ways of combining
multiple camera views into one image for detection:

1. **A stitched mosaic of every frame.** Overlapping regions of nearly
   identical content, warped by slightly different pose/plane estimates,
   created ghost double-layers and seam artifacts — and the detector read
   those artifacts as extra unknown pieces.
2. **One single "best" frame** (sharpest, most top-down). No seams, no
   ghosts — but one photo can crop a real piece off the edge of the frame,
   and an incomplete inventory was judged strictly worse than an imperfect
   image. This was explicitly reversed once that tradeoff was made
   concrete.
3. **A cleaner, object-aware, feathered mosaic.** Blending smoothed the
   visible seams but couldn't fix the underlying problem: the homography
   that rectifies a mosaic is exact **only for the table plane** (z=0).
   LEGO pieces sit a centimeter or more above it, so parallax shifts their
   pixels differently in every source view. Concretely, an orange
   `Brick 1×8` came out visually elongated enough in the blended image that
   Brickognize confidently read it as a `Brick 1×10` — not a classifier
   mistake, a pixel-geometry mistake baked in before classification ever
   ran.

**The conclusion that stuck:** detect and identify from *original,
undistorted camera frames* — never from anything stitched or warped — and
use the table-plane homography only to know *where* a detection sits in
shared coordinates. The mosaic still exists (`compose_object_aware_mosaic`)
but is explicitly a human-facing coverage preview; no inventory number is
ever computed from it.

**Fusing observations into physical pieces.** `fuse_observations()` is a
union-find over per-frame detections: two observations merge only if
they're color-family compatible **and** geometrically close in shared table
coordinates (a combined score of box IoU and normalized centroid distance).
One hard invariant guards against double-counting at the source: **two
observations from the same source frame can never fuse** — if a piece
photographed once produced two detections, that's either two real objects
or a segmentation duplicate (handled separately, §2), never something
color/geometry heuristics should quietly merge away.

Color is treated as *supporting* evidence, not identity, on purpose: a
`strong_geometric_match` escape hatch (very high box overlap, very small
centroid distance) lets two observations fuse **even when their color votes
disagree**, because a piece's apparent color is genuinely lighting- and
angle-dependent while its physical position isn't. This fixed a real bug —
a large gray plate that white-balance shifts had split into a "blue" group
and a "gray" group in one earlier run.

**A subtler fusion bug, and its repair.** Adding those deliberately
oblique "confirmation" views (§1) for angle diversity introduced a new
failure mode: parallax from a raised piece can project two *genuinely
different, unrelated* pieces onto overlapping table-space positions when
seen only from oblique angles, causing them to wrongly fuse. Session
`233252` initially produced a **false 14th component** this way — an
oblique blue detection and an oblique white detection cross-matched.
The fix, `reassign_confirmation_only_instances()`, looks specifically for
fusion groups made *entirely* of confirmation-view observations (no
grounding coverage-view anchor), and tries to reassign each observation to
its correct, coverage-anchored group — but only when there's one clearly
best match with a real margin over the next-best candidate. If the
geometry is ambiguous, it leaves the group alone rather than guessing.
After this repair, `233252` produces exactly 13 components, matching a
manual frame-by-frame count.

The mirror-image problem — not over-merging, but not silently accepting a
stray single-view blob as a real piece — is handled by
`filter_unconfirmed_instances()`: with ≥3 independent views, a mask seen in
exactly one view, at a boundary, or below a confidence floor, is dropped
**unless** fewer than two other clean views actually had a line of sight to
that table location and still didn't see anything there. A genuinely
single-view piece (one hidden from other angles by, say, an occluding
neighbor) survives; a shadow or table-edge artifact caught once does not.

**Known limitation:** table-coordinate fusion is only as good as the plane
fit underneath it — the held-out round-table sessions (§2) show this
directly, where weak geometry (not weak detection) cost two real pieces.

---

## 4. Identification: Brickognize plus an evidence stack that argues with it

**The bridge: identify from the original frame, never the warped one.**
Once a fused instance's best-supporting observation is chosen, its
identification crop is cut from that view's **original** camera frame, not
the rectified canvas — via the inverse of the same homography used to
place it in table coordinates (map the canvas box's 4 corners into original
pixels, take the bounding box). The crop is padded, and specifically
extended in the direction a point 1cm above the table would visually
displace in that view (`raise_uv_per_cm`, computed from the actual camera
pose) — a naive plane-only projection systematically under-covers the top
of a piece in oblique views, since the piece isn't actually on the plane.
The crop is then masked to the piece's own segmentation footprint, so a
neighboring piece caught inside the padded box never accidentally rides
along to the identification API. This one fix — pixel geometry, not
smarter classification — is what turned the mosaic-distorted "1×10" back
into a correct `Brick 1×8`.

**Choosing which view to send.** Not simply "highest confidence" — a
combined score of local sharpness (Laplacian variance measured *inside* an
eroded mask, so the mask's own edge can't fake a high-focus score), crop
size, view tilt, segmentation confidence, and original-frame fit.

**Second-chance retry across alternate views.** If the top-ranked crop
scores below Brickognize's 0.70 acceptance threshold, up to three
*alternate* observations of the same fused piece are tried too — and the
single best-scoring result across all of them wins, not the first one that
clears the bar. That "best, not first" detail was a real bug fix: an
earlier version accepted the first alternate that cleared 0.70, and a
canvas-clipped view's confidently-wrong `Wedge` (0.74) beat a clean,
correct `Brick 1×8` (0.84) sitting in a different alternate view. This
mechanism alone recovered a misidentified orange beam on a regression
session.

**Independent evidence layers, each typed and bounded, none of them "the"
answer.** This is the part of the system that looks most like traditional
software engineering discipline applied to a CV problem — every check
below is deliberately scoped to what it can and can't prove:

- **Stud counting** (`pipeline/studs.py`) — HoughCircles on the isolated
  crop, run through *two calibrated preprocessing paths*, because the
  original bright-piece threshold literally couldn't see a black `2×12`
  plate's stud grid (it counted 4 studs where 24 were visible to the eye);
  a dark-luma-triggered CLAHE + gamma variant fixed that specific failure
  mode without breaking bright pieces. Every count carries a reliability
  tier and can be marked unreliable and simply ignored — it never overrides
  anything by itself.
- **Metric footprint** (`pipeline/footprint.py` + `dimensions.py`) — fits a
  minimum-area rotated rectangle to a piece's *unclipped* segmentation
  polygon, in real table-plane millimeters, across every usable view, with
  outlier rejection and a low/medium/high reliability tier based on
  cross-view agreement. `dimensions.py` then parses regular `Brick N×M` /
  `Plate N×M` names into their real expected footprint (stud pitch ≈8mm,
  so an N-stud side ≈ N×8−0.2mm) and vetoes or re-ranks Brickognize
  candidates whose modeled footprint doesn't match the measured one within
  tolerance (`max(8mm, 35% of nominal)`). This is the layer that catches a
  featureless black `Plate 2×12` reading as visually-similar wrong sizes,
  and that flags a side-lying piece as `possible_non_canonical_pose`
  instead of confidently reporting a wrong identity.
- **Depth-height evidence** (`pipeline/depth_height.py`) — confidence-
  filtered, table-relative height from LiDAR depth. Explicitly labeled
  `shadow_only`: it is recorded in provenance for future validation and
  **cannot currently change an identity at all**. Historical sessions
  captured before per-pixel confidence sidecars existed correctly report
  "unavailable" rather than silently fabricating a number — an honest
  placeholder, not a hidden gap.
- **A calibrated multi-view cuboid-fitting diagnostic**
  (`pipeline/model_fit.py`) — the most geometrically sophisticated piece of
  the stack, and deliberately **not wired into production**. It correctly
  ranked the right candidate over the wrong one in every test case it was
  tried against, but the team's own promotion gate requires a real oblique
  confirmation view above 30° tilt on the sessions being used to validate
  it, and the available historical sessions only reach 0.6–11.4°. Rather
  than promote a diagnostic that "worked" without meeting its own bar, it
  stays opt-in (`--analysis-dir`) and advisory-only. This is one of the
  clearest examples in the codebase of the team's evidence discipline
  overriding a result that looked good.
- **Arbitration** (`pipeline/evidence.py`) — the layer that actually
  decides what any of the above is allowed to *do*. A stud-driven proposal
  can only change a confirmed identity if it's independently corroborated
  by a second evidence category (e.g., multi-view appearance agreement),
  and high-reliability metric evidence can veto a stud proposal outright
  regardless of stud confidence. Rescuing a piece that's `unknown` in
  *every* view requires all three: a unique weak-appearance leader across
  ≥2 frames, compatible high-reliability metric evidence, and stud support
  — a bar high enough that a black piece was only rescued from "unknown" to
  `Brick 2×4` once all three genuinely agreed, and every other unresolved
  unknown was correctly left alone rather than force-guessed.

**Known limitation:** a piece whose only informative side (studs, printed
detail) never faces a camera cannot be identified by any of this — that's
a capture-technique limit, not a software one.

---

## 5. Color

**Where color sits in the stack.** Color is sampled independently of part
identity, from the same isolated segmentation mask, and voted across every
retained observation of a fused piece.

**What was actually broken, found by building a benchmark first.** Before
touching a single threshold, the team recorded full per-view color evidence
(raw and corrected RGB, Lab, top-3 palette matches with delta-E margins,
luminance stats, diagnostic flags) into provenance, generated a labeling
worksheet, had a human fill in ground truth for one real session, and built
a scoring script — an explicit rule going in was *"do not tune against
inventory ordering; ground truth first."* That discipline paid off:
root-cause analysis showed **all five** of the failing session's confident
color errors (black misread as blue/dark-gray, yellow as lime, green as
teal, a blue/gray confusion, and a side-facing blue reading as light blue)
traced back to *one* step — a legacy white-patch illumination correction
that forcibly mapped the table reference toward pure white, over-amplifying
blue and clipping bright channels. The palette-matching math and CIEDE2000
distances, which looked like the obvious suspects, were only minor
secondary contributors.

**The fix.** Illumination correction was replaced with a **brightness-
preserving, session-level gray-world correction** — it maps the neutral
reference to *its own mean*, not to white, and only engages when the
putative-neutral table reference itself passes reliability checks (bright
enough, low enough chroma, consistent across multiple views); otherwise it
falls back to raw, uncorrected samples rather than risk a bad correction.
Per-observation safeguards additionally refuse to apply the correction if
it would amplify an already near-neutral sample's chroma, shift hue too
far, or "correct" a color that was already strongly saturated to begin
with.

**Chroma-gated, hue-first decisions.** Color matching now branches on
measured Lab chroma before comparing to the palette: below a fixed gate,
candidates are restricted to the five neutral names (white / light gray /
gray / dark gray / black) only; above it, neutrals are excluded entirely
and the ranking score leads with hue distance (lightness and chroma are
minor secondary terms). This directly targets the "black read as blue"
failure — a near-zero-chroma black sample, scored on raw CIEDE2000 alone,
can land numerically close to a dark saturated blue; once chroma decides
*which palette subset is even eligible*, that confusion becomes
structurally impossible in either direction.

**Ambiguity instead of confident wrongness.** When the best and second-best
aggregate scores are close (margin < 4.0), or the pair is a known
shade-boundary case (dark green/green, blue/dark blue, red/dark red,
brown/dark brown) with dark-exposure overlap risk, the output is literally
the string `ambiguous(colorA/colorB)`, flagged in provenance for routing to
human confirmation — rather than picking one and being wrong with false
confidence.

**Quality-weighted voting.** Per-view color votes are now weighted, not
counted equally: shadow/specular flags cut a view's weight to 55%,
boundary-crop views to 65%, oblique tilt ≥30° to 60% (≥45° to 35%), and low
segmentation confidence scales weight down further. The earlier design
counted every view's vote equally regardless of how trustworthy the sample
actually was.

**Honest result, stated honestly.** On the one session with human-labeled
ground truth (`20260717-233252`, 13 pieces): exact color accuracy rose from
8/13 (61.5%) to 9/13 (69.2%); "acceptable" results (exact **or** an
ambiguity flag that contains the true color) rose from 8/13 to **13/13
(100%)**; confidently-wrong colors fell from **five to zero**. This is
genuinely the primary claim worth making about color right now — not that
it's solved, but that it stopped being confidently wrong. The project log
is explicit that this is evidence from *one* labeled session, not proof
across lighting conditions in general, and that a cross-session
no-new-confusions claim remains unmeasured until more sessions get human
color labels.

---

## 6. Inventory output

`pipeline/inventory.py`'s `build_inventory()` groups identified pieces by
`(part_id, color_id, color_name)` into quantity-counted rows:

```json
{"part_id": "3001", "name": "Brick 2 x 4", "color": "red",
 "color_id": 4, "quantity": 3}
```

sorted by descending quantity, then name, then color. `merge_inventories()`
lets several scanning sessions (a batch too large for one capture) combine
at the application layer, since the runtime segments and fuses within one
session but doesn't attempt cross-session 3D reconstruction.

`inventory.json` is the terse, consumer-facing file — it's the actual
contract handed to the teammate's prompt-to-build/generation half. The much
richer `multiview_result.json`, alongside it, is the full audit trail: for
every fused instance, its box, weighted color-vote provenance, the source
frame and crop used for identification (with raw and second-chance
Brickognize candidates), the metric-silhouette measurements and their
aggregate dimension decision, stud evidence, shadow-only depth-height
evidence, and any flags (`ambiguous`, `dimension_mismatch`,
`possible_non_canonical_pose`, `insufficient_view_diversity`, and others).
Nothing in `inventory.json` is a black box — every value there can be
traced back through `multiview_result.json` to the specific evidence that
produced it.

**Beyond raw output:** a human-review workflow now exists
(`inventory_review_app.py`, a small local FastAPI verifier with candidate
renders, an editable part/color picker, and an explicit include/exclude
decision per component) plus a BrickLink Studio `.mpd`/`.csv` exporter, so
corrections can happen in an actual LEGO CAD tool. Worth stating honestly:
across 12 physically-counted verification batches (780 real pieces), the
scanner's draft output totaled 810 components — that gap is presented as
*workload for human reconciliation*, not as an accuracy claim. It's outside
the narrow "CV pipeline" scope of this document, but it reflects the same
discipline as everything above: the system is honest about where its own
output needs a human.

---

## 7. Testing and validation discipline

**Why every split is drawn by session, never by frame.** Frames from one
physical layout are near-duplicates of each other — same table, same
pieces, same lighting, camera moved a few centimeters. A frame-level
random split would place near-identical images on both sides of
train/validation, and validation accuracy would measure memorization of
that specific layout, not generalization to a new one. Every split in this
project — YOLO training, footprint calibration's "acceptance session,"
color ground truth — is drawn at the whole-session level.

**Three tiers, reported separately, never blended.** *Train-seen* results
are explicitly labeled as regression checks only — passing there proves
nothing broke, not that anything generalizes. *Validation* sessions are
untouched whole sessions from environments the model has seen the general
style of. *Held-out* sessions are a genuinely different physical
environment (a white round table vs. the wood/gray tables used for
everything else). These are never averaged into one headline accuracy
number; they're reported as three separate numbers because they answer
three different questions.

**"It worked on the session I'm looking at" is explicitly not accepted as
proof**, and the project's own history has a clean example of holding that
line under real pressure: the calibrated multi-view cuboid-fitting
diagnostic (§4) correctly ranked the right identity over the wrong one on
every test case it was run against — a genuinely good result — but it was
still **not promoted to production**, because the team's own pre-agreed
reliability gate (a real oblique view above 30° tilt) wasn't met on the
sessions used to check it. Likewise, the held-out white-round table's 17/19
result was deliberately left un-retuned after being observed, specifically
so it stays usable as real held-out evidence the next time the model
changes, instead of quietly becoming a fifth validation session.

**Current state:** `lego-capture` has **90** passing tests; `lego-cv` has
**326** passing tests (one pre-existing, unrelated `Starlette`/`httpx`
deprecation warning). Both suites are run before any change lands, and
growth here has tracked the growth of the evidence stack itself — the
project started with a couple hundred tests around basic detection and
fusion and now covers stud calibration, metric footprint math, dimension
consistency, evidence arbitration, shadow-mode depth height, three phases
of color correction, and the review/export tooling on top.

---

## The honest one-paragraph summary

Nothing in this pipeline is one clever trick. It's a sequence of narrowly
scoped fixes, each one built in response to a specific, reproducible
failure that was root-caused before being patched, each one bounded so it
can't silently override the layers around it, and each one validated
against a split designed to catch the exact way that kind of fix tends to
lie to you (session leakage, single-session overfitting, tuning against
the case you already know about). The two touching white plates that
motivated the trained segmenter now separate correctly. The orange beam
that a stitched mosaic warped into the wrong part number now identifies
correctly from an unwarped crop. The black plate that appearance-only
matching couldn't see now gets caught by metric geometry. None of that is
one model being smart — it's the discipline of admitting, in writing, what
each check can't yet prove.
