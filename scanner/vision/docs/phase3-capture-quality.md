# Phase 3 capture quality and operating guidance

This guidance is tied to the July 17 audit, human label review, and product
evaluation. It is not a universal camera specification. The current runtime
uses original RGB frames for instance segmentation, Record3D depth only for
table/workspace geometry, and table-coordinate projection only for cross-view
fusion.

## What the evidence says

- The audit listed 20 Phase 3 sessions: 19 were usable and
  `20260717-153911` contained zero frames. A foregrounded Record3D stream and
  nonzero frame counter remain the first capture gate.
- Two wood validation bursts were only 3.9–4.0 seconds long. They still reached
  their 7/7 and 14/14 reference counts, but they offer little redundancy. The
  exporter now retains at least three time-diverse views whenever three frames
  exist, even if a single view already covers the dense canvas.
- Raw Laplacian sharpness is surface-dependent. The gray captures had median
  values around 131, while wood and white-table sessions were much lower; this
  does not mean gray is intrinsically a better capture environment. Use
  within-session sharpness ranking, visible stud edges, and motion-blur checks.
  Do not impose one raw sharpness cutoff across environments.
- The held-out round white table was the weakest geometry group. Plane inlier
  fractions were 0.587 (`153942`) and 0.705 (`155228`), versus roughly
  0.94–1.00 for the other audited surfaces. Product results were 11/11 and
  17/19 respectively. The latter failure is classified as weak geometry plus
  fusion/count mismatch: individual views contained 24, 19, and 18 accepted
  masks, but unstable table projection and edge-only observations produced 17
  fused records. The test set was not retuned after this result.
- The train-seen touching-white target `005145` now returns eight separate
  pieces, including both white pieces. This demonstrates the intended fix but
  is not generalization evidence. Five untouched whole-session validation
  layouts were all exact on the available human-frame count references.
- All 71 selected training images and 1,157 instance polygons were manually
  reviewed. Dense touching layouts were intentionally prioritized, but the
  set does not establish robustness for every LEGO geometry, severe stacking,
  transparent pieces, or arbitrary household clutter.

## Observed issues and their responsible stage

| Evidence | Primary stage | What to do |
|---|---|---|
| `153911` connected but saved zero frames. | Capture | Wait for an increasing frame counter. Keep Record3D foregrounded, run one client, and relaunch/toggle streaming if it remains zero. |
| `150212` and `150350` lasted 4.0 and 3.9 seconds. | Capture/multiview | Continue long enough for an overview and meaningfully different positions; the runtime can retain diverse views only if they were recorded. |
| White-round plane inliers were 0.587 and 0.705. | Geometry/fusion | Begin with visible bare tabletop around the batch and make a slow perimeter pass before close views. |
| Several wood sessions had within-session median sharpness near 17–23, while clean alternatives still existed. | Capture/identification | Slow down and briefly dwell over dense groups; training cannot recover detail absent from every frame. |
| Same-color contacts were the original `005145` failure. | Segmentation | Do not separate pieces for the demo; provide sharp overlapping views from more than one direction. |
| A cable, clothing, chair/table edges, and a laptop generated model proposals. | Geometry gate/multiview | Keep loose objects off the active tabletop. Outside clutter can be gated or contradicted, but in-workspace clutter is inherently harder. |
| Small real edge pieces and small false masks coexist. | Gate/fusion | Include a closer overlapping pass; do not solve this with one global small-box or confidence cutoff. |

## Recommended capture pass

1. Put Record3D in the foreground, start USB streaming, and confirm the frame
   count increases. Only one Record3D client can receive frames at a time.
2. Spread pieces in one layer. Touching is allowed, including same-color
   contact, but avoid one piece fully hiding another. Stacked or flipped pieces
   were not validated as a complete inventory case.
3. Leave visible table around the batch, especially near the table edge. Depth
   needs repeated bare-plane observations to estimate a stable physical
   workspace. A circular edge, chair, clothing, cable, or laptop immediately
   beyond the surface increases the cost of a weak plane fit.
4. Sweep smoothly rather than holding one fixed view. Keep each piece fully in
   frame in at least two views and preferably three. The audited wood/gray
   sessions commonly reached about 0.14–0.39 m camera height; the weak white
   sessions dipped to 0.06–0.29 m. These ranges are observations, not hard
   limits. In practice, stay high enough to preserve context and low enough for
   clear studs, with mostly top-down views plus modest angle variation.
5. Move slowly enough that stud edges remain crisp. Avoid harsh glare on white,
   black, and glossy pieces and avoid phone shadows crossing the batch. The
   selector can discard poorer views only when cleaner alternatives exist.
6. Sweep the perimeter after the center. A real piece seen only at an image or
   workspace boundary is intentionally treated as weak evidence unless other
   views confirm it. This is how the runtime rejects cropped clothing, cables,
   and table-edge clutter without globally deleting low-confidence real LEGO.
7. End only after every piece has at least one clean, fully visible view and
   the batch has repeated coverage. Coverage percentage describes the observed
   table canvas; it does not prove that an occluded piece was visible.

## Larger batches and multiple environments

The runtime no longer chooses one best photograph. It segments up to five
selected original frames independently and fuses observations in table
coordinates, so a batch may extend beyond one fixed camera view. For a larger
layout, sweep overlapping regions with stable table visibility; ensure pieces
near each transition appear in multiple frames. If the full layout cannot be
covered while preserving clear studs and repeated geometry, use multiple
capture sessions and combine their inventories at the application level.

Different surfaces are supported by evidence from wood, gray, and a held-out
white round table, but only the first white session was count-exact. For a new
surface or lighting setup, inspect the generated `debug/frame_*_seg_gate.jpg`
files before trusting a large batch. Cyan is the physical workspace, magenta is
the inference crop, green is accepted segmentation, and red is rejected
evidence with its reason.

## Best next training captures

The current selected set is dominated by wood (51 of 71 images), with 8 gray
and 8 held-out white-round images. The highest-value next data is:

1. Several genuinely new surfaces and lighting conditions, each with multiple
   independent layouts rather than many adjacent frames of one layout.
2. Same-color touching pairs/triples with edge, corner, and partial overlap;
   every physical piece must retain its own verified polygon.
3. Dense scenes containing small, upright, flipped, partially occluded, and
   unusual non-rectangular parts, recorded with overview and oblique evidence.
4. Negative tabletop clutter—pens, hands, cables, tools—left unlabeled as LEGO.
   Diverse negative objects matter more than repeats of one cable.
5. More round/small-table sessions with strong bare-plane visibility, reserved
   as a new validation group so geometry improvements can be separated from
   segmentation improvements.

The current white-round test has now been evaluated. If those exact images are
used for future training, their existing numbers must remain labeled as the
old held-out result; they cannot be presented as unseen-environment evidence
for the retrained model.

## Known limits and next data

- `155228` remains two pieces short and has one unidentified piece. Add a new
  round-table capture to a future validation set; do not train on the held-out
  failure and then continue calling it held-out evidence.
- `152458` is count-exact at 23 but one item remains `unknown brick`; this is an
  identification failure, not a segmentation miss.
- Bare-table zero-LEGO behavior and severe clutter inside the valid table
  polygon need explicit negative product tests. The current geometry gate is
  strongest for clutter outside the physical workspace.
- Transparent, highly reflective, stacked, mostly occluded, and unusual
  non-rectangular parts need targeted captures and verified masks before any
  robustness claim.
- Color is sampled inside the predicted mask and voted across views, but no
  per-piece color ground-truth benchmark was collected. Inspect color output in
  new lighting rather than treating the current count benchmark as color
  accuracy evidence.
