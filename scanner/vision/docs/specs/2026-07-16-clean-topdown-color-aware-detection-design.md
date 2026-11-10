# Clean Top-Down and Color-Aware Detection Design

**Status:** Approved direction; implementation pending written-spec review.

## Goal

Detect every visible LEGO piece once in the current scan workflow, including
large pieces at the workspace boundary and differently colored pieces whose
shadows merge, without treating top-down stitching seams as pieces or telling
the user to separate pieces that are already physically separate.

## Evidence and Root Causes

The acceptance session is `lego-capture/sessions/20260716-221544` and contains
eight visible pieces.

- The dark-gray piece is present in the foreground mask at approximately
  `(0, 158)-(164, 387)`. The current detector deletes it because the component
  touches the cropped image border.
- The central red, yellow, and white pieces produce one connected foreground
  contour at approximately `(234, 149)-(349, 320)`. Morphological cleanup joins
  their shadows. The current size-only cluster rule cannot split that contour.
- Three small right-side detections follow multi-frame composite seams. The
  same CV detector run on a single rectified best frame produces none of those
  seam detections.
- `models/lego_yolo.pt` is absent, so `--detector auto` currently selects the
  OpenCV fallback. Color estimation happens after detection and therefore
  cannot currently help split merged pieces.

## Scope

### In scope for Option A

- Use a clean, single-frame rectification as the detector input.
- Preserve the multi-frame composite as an explicit diagnostic output.
- Retain valid border-touching and large isolated pieces.
- Split merged foreground regions using confident Lab-color seeds.
- Use conservative geometric watershed only when multiple same-color seeds are
  well separated and each resulting region is independently plausible.
- Remove the user-facing `cluster: separate pieces and re-scan` behavior.
- Keep the detector backend contract compatible with a future segmentation
  model, tiled inference, and multi-view merging.

### Out of scope for Option A

- Training YOLO.
- Cross-frame instance association.
- Full top-down mosaic deghosting or graph-cut seam optimization.
- Part identification changes, Brickognize policy changes, or confirmation UI.
- Depth-based rejection of tall non-LEGO objects.

## Architecture

### 1. Detection-safe top-down image

`lego-capture/topdown.py` will make the existing best-frame rectification the
default detector handoff at `topdown.jpg`. The selected frame uses the existing
top-downness and sharpness score, and the existing bounded-workspace crop still
applies.

The multi-frame winner-take-all mosaic remains available as
`topdown_composite.jpg` through an explicit mode/output command. It is useful
for coverage and visual diagnostics but is not sent to the detector because
hard frame transitions create false contours.

This is intentionally a current-workflow solution: scanning guidance requires
all pieces to remain visible throughout the sweep. Larger workspaces that do
not fit in one frame are handled by Task B's tiled/multi-view design below.

### 2. Foreground components

The OpenCV backend keeps its local-background difference mask as the initial
foreground proposal because it already detects white pieces on a light table.
The blanket border rejection is removed. A component is no longer discarded
only because it is large, isolated, or touches the workspace crop.

Minimum pixel area remains a noise guard. Image-scale components may be marked
uncertain, but size is not sufficient evidence to delete a LEGO piece.

### 3. Color-seeded instance splitting

A focused module in `pipeline/` will split one connected foreground component
into zero or more piece masks:

1. Extract the component crop and its foreground mask.
2. Convert pixels to Lab color space.
3. Estimate local table color from a ring immediately outside the component.
4. Remove low-confidence shadow/background bridge pixels from the marker set.
5. Map confident interior pixels to the existing curated LEGO color palette.
6. Form connected seed regions by palette color, discarding tiny highlight or
   stud fragments.
7. Run watershed within the original foreground component so bridge and edge
   pixels are assigned to the nearest valid seed.
8. Convert each validated region to one bounding box.

Different colors are therefore strong evidence for different instances, but
the final inventory color is still computed by the existing crop-level color
stage. Detection-time color labels are seeds, not the inventory truth.

### 4. Same-color fallback

When a component has only one confident color, geometric watershed is allowed
only if the distance transform contains multiple well-separated cores and
every proposed basin exceeds the normal minimum piece area. This avoids
splitting a long brick into one instance per stud or highlight.

If a reliable split is unavailable, the component is retained as one uncertain
detection rather than deleted or presented as an instruction to rescan. A
future confirmation UI can surface that uncertainty without claiming the user
positioned the pieces incorrectly.

### 5. Stable detector contract

`detect(image, method)` continues to return independent piece boxes for the
existing scan, identification, color, and inventory stages. Internally, the
implementation should treat instances as masks plus derived boxes so a future
YOLO segmentation backend can populate the same structure without changing
Brickognize or inventory code.

## Error Handling and Fallbacks

- If best-frame selection cannot find a valid frame, top-down export retains
  the existing explicit error rather than silently using a broken mosaic.
- If no confident color seeds exist, keep the original component as one
  uncertain instance.
- If watershed produces tiny or degenerate regions, reject the split and keep
  the original component.
- The `cv` backend remains usable without model weights or network access.
- `--detector auto` continues to prefer a trained YOLO model once a compatible
  segmentation checkpoint is installed.

## Testing and Acceptance

Automated tests will cover:

- A valid piece touching each image border is retained.
- A large isolated LEGO-shaped component is retained.
- Close red, yellow, and white regions joined by a shadow are split into three
  instances.
- A single long brick is not over-split.
- Two well-separated same-color cores in one connected mask can be split.
- Thin seam/noise fragments remain below the minimum valid instance area.
- Existing synthetic detector, CLI, API, and inventory tests remain green.

Real-session gates:

- `20260716-221544`: exactly eight detections, including the gray piece;
  central red/yellow/white pieces separated; zero seam boxes; no rescan cluster.
- `20260716-212422`: remains exactly seven detections with zero background
  boxes.

## Task B: YOLO Instance Segmentation and Larger Batches

The future model should be a single-class instance-segmentation model
(`lego_piece`), not a part-ID classifier. Each physical piece receives its own
polygon mask even when two pieces share a color or touch. Brickognize and the
existing color stage continue to assign part ID and color after segmentation.

Training entails:

1. Collect representative detector inputs across backgrounds, lighting,
   colors, sizes, border positions, close spacing, genuine contact, partial
   occlusion, and composite artifacts.
2. Draw one polygon mask per physical piece. Roboflow's polygon/SAM-assisted
   tools can speed this up, but every mask needs review.
3. Split train/validation/test by capture session, not random frame. Adjacent
   frames from one scan are near duplicates and would otherwise leak into
   validation.
4. Export YOLO segmentation labels: one row per instance with class ID and
   normalized polygon coordinates.
5. Fine-tune a pretrained Ultralytics segmentation checkpoint. The existing
   `train_yolo.py` is currently a bounding-box detector using `yolov8n.pt` and
   a detection-format export; Task B must change it to a segmentation
   checkpoint and segmentation dataset.
6. Evaluate mask mAP/recall, but also measure the product metric that matters:
   per-image count error and missed/duplicate-piece rate on held-out sessions.

For a single very large, high-resolution top-down image, resizing the whole
image to a fixed model input can make LEGO pieces too small. Use overlapping
tiled inference: process 512- or 640-pixel tiles with roughly 20% overlap, then
merge duplicate masks across tile boundaries. SAHI provides this sliced
inference and mask/box postprocessing pattern.

For a workspace that does not fit in one camera view, run segmentation on
multiple retained camera frames or rectified tiles. Reproject every predicted
mask to table coordinates using the recorded intrinsics and pose, then merge
duplicates by table-space mask overlap and centroid distance. This is the
natural combination of Task B with planned Stage 3 multi-angle reprojection.
It avoids requiring one giant stitched image and lets identification choose the
best crop for each merged physical instance.

Option A preserves this path by keeping detection independent from
identification and by treating masks/boxes as per-image instances. It does not
attempt cross-view counting now.

## Research Sources

- Ultralytics instance segmentation task and training:
  https://docs.ultralytics.com/tasks/segment
- Ultralytics segmentation dataset and polygon format:
  https://docs.ultralytics.com/datasets/segment
- Roboflow polygon and SAM-assisted annotation:
  https://docs.roboflow.com/annotate
- SAHI sliced inference for large images and instance segmentation:
  https://obss.github.io/sahi/
- SAHI quick start and overlapping-tile inference:
  https://obss.github.io/sahi/quick-start/

