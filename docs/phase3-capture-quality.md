# Phase 3 Capture Quality + User Guidance

Status: preliminary report after capture/session audit and SAM-assisted label
bootstrap. It must be updated after the first trained YOLO model is evaluated.

## Evidence inspected

- 20 listed new sessions: 19 usable and one zero-frame capture
  (`20260717-153911`).
- 71 selected original RGB frames: 48 train, 15 validation, and 8 test.
- Whole-session split with no session leakage.
- Three new surfaces: wood, gray, and white round table. Both white-table
  sessions are held out as an environment test.
- SAM2 annotation bootstrap: 1,299 raw proposals, 1,173 filtered proposals;
  all remain unverified. QA found no malformed polygon files and prioritized 56
  of 71 images because proposed instances touch or overlap.

Sharpness values below are only meaningful within a session or surface. The
gray surface has far more high-frequency texture, so its absolute Laplacian
scores cannot be compared directly with the wood/white scores.

## Observed capture issues and actions

| Observation | Stage at risk | Training likely to help? | Capture likely to help? | User action |
|---|---|---:|---:|---|
| `153911` connected but saved zero frames. | Capture | No | Yes | Wait for the live frame counter to increase before beginning the sweep. Keep Record3D foregrounded and run only one client. If it stays at zero, toggle/relaunch Record3D before scanning. |
| `150212` and `150350` last only 4.04 s and 3.88 s. Their camera-height ranges are only 2.2 cm and 2.1 cm. | Capture / multiview | Only partly | Yes | Continue long enough to obtain an overview plus meaningfully different angles. A stationary burst is not multiview evidence. |
| White-round sessions have weak plane inlier fractions: 0.587 and 0.705, versus at least 0.943 for the usable wood/gray sessions. The tabletop edge and background are prominent. | Geometry / workspace ROI | No, if the ROI is wrong | Yes | Begin with a slow overview that shows bare tabletop around the entire LEGO region. Keep the round tabletop visible from several positions before moving close. Avoid filling the frame with pieces/background before the plane is established. |
| Several longer wood sessions have low within-session median sharpness (about 17–23), although sharp frames were still recoverable. | Capture / segmentation / identification | Some robustness, not lost detail | Yes | Move more slowly, especially when changing direction or height. Briefly dwell over dense groups so at least one sharp view exists. |
| Most selected frames are near top-down: median topdownness 0.995; the selected set still includes some oblique views down to 0.869. | Identification / multiview | No substitute for visibility | Yes | Keep the top-down sweep, then add a moderate oblique pass. Oblique views reveal sides, separation seams, and details needed by Brickognize. Do not make every view steeply oblique. |
| Dense same-color contacts remain the core instance-separation risk. SAM proposals can merge pieces or isolate studs instead of pieces. | Model/data separation | Yes, after correct instance labels | Yes | Include at least one sharp close-enough view of each dense group and sweep it from two directions. Do not physically separate pieces during the demo; provide complementary views instead. |
| Pieces clipped by a frame or visible only in a single view weaken inventory evidence. | Capture / fusion | Limited | Yes | Make the first overview contain every piece, then use overlapping passes. When moving close, overlap the previous region and return to any edge piece. |
| Cables, floor, chair/table edges, and marks outside the table produced proposal false positives; clutter can also exist on the active tabletop. | Workspace gate / model | Yes for general LEGO-vs-clutter objectness | Yes | Keep the scan area clear when possible. Outside clutter will be geometry-gated, but remove pens, hands, and cables lying inside the LEGO workspace because geometry cannot distinguish them from in-workspace objects. |
| Very small/partial real pieces and real edge pieces coexist with small false proposals. | Segmentation / workspace gate | Yes | Yes | Do not rely on distance alone. Include one closer overlapping pass while keeping an overview. The runtime must retain small/edge candidates and seek multiview support instead of globally suppressing them. |

## A. Best demo scanning protocol

1. Confirm the live frame counter is increasing before moving the phone.
2. Start high enough for one slow near-top-down overview containing every piece
   plus a visible border of bare tabletop around the group.
3. Make a slow overlapping top-down sweep. Pause briefly above dense,
   same-color, small, or edge groups; avoid abrupt direction changes.
4. Make one moderate oblique sweep from a different side, keeping all regions
   overlapped with the overview. This supplies side/detail evidence without
   replacing the geometrically strongest top-down views.
5. Make a closer overlapping pass only over difficult/dense regions. Never let
   the closer pass be the only view of an edge piece.
6. End only after every physical piece has appeared sharply in an overview and
   from at least one complementary angle. Keep hands and loose objects out of
   the active tabletop during the scan.

## B. Best future training-capture protocol

The present dataset is dominated by wood (51 of 71 selected images), contains
8 gray images, and reserves 8 white-round images for an honest environment
test. The next captures with the highest expected value are:

1. Multiple genuinely new surfaces and lighting conditions, each with several
   independent arrangements—not more near-duplicate frames of one arrangement.
2. Same-color touching pairs and triples with varied edge, corner, and partial
   overlaps. Preserve separate physical instances in every manual mask.
3. Dense scenes containing small, flipped, upright, and partially occluded
   pieces, with both sharp overviews and complementary oblique views.
4. General negative clutter on the tabletop (different cables, pens, hands),
   deliberately left unlabeled as LEGO. Diversity matters more than repeated
   examples of one cable.
5. More round/small-table captures with strong plane visibility to separate
   geometry failure from segmentation domain shift.

Do not fold the current white-round test sessions into training until their
held-out evaluation has been recorded. If they are later used for training,
they no longer provide unseen-environment evidence.

