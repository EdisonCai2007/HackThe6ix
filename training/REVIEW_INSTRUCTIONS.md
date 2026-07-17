# Phase 3 LEGO Mask Review

## Why this review is mandatory

The files in `training/data/autolabels` are SAM2 proposals, not ground truth.
SAM is useful at tracing visible boundaries, but the batch review found false
masks on studs, table marks, and side clutter. Touching same-color pieces are the
most important cases and must be represented by separate polygons. Training on
an incorrect merge would explicitly teach YOLO the existing counting bug.

The review bundle contains 71 original Record3D RGB images. The filenames start
with a four-digit review order. The first 56 are the highest-priority images
because their proposed masks touch or overlap. Every image still requires
review.

## One-time setup

Labelme is not installed automatically. From this repository, install the
pinned version used by the bundle format:

```bash
cd /Users/emily/lego-cv
.venv/bin/pip install labelme==6.2.0
```

Open the prepared directory:

```bash
cd /Users/emily/lego-cv
.venv/bin/labelme training/data/review-labelme/review \
  --labels training/data/review-labelme/labels.txt
```

The image and its existing JSON annotation have the same stem. Edit the
existing polygons; do not create another class. Labelme v6 auto-saves by
default, but use **Save** before moving on if there is any doubt.

## Checklist for every image

1. There must be exactly one `lego_piece` polygon for every visible physical
   LEGO piece.
2. Split touching pieces into separate polygons, including same-color pieces.
   Shared color is not evidence that two pieces are one instance.
3. Delete proposals around studs, holes, printed details, shadows, glare, table
   marks, cables, furniture, hands, floor, and other non-LEGO objects.
4. Keep small real pieces and real pieces near or clipped by an image boundary.
   Do not apply a blanket small-object or edge-object rule.
5. Trace the visible boundary of each piece. For stacked or partly occluded
   pieces, label each independently visible physical piece, but do not invent
   its hidden outline.
6. Flipped pieces are still LEGO and must be labeled.
7. Zoom in on dense and same-color contacts. A proposal that looks plausible at
   fit-to-window scale may still cross the true seam.
8. When the image is correct, check the image-level **reviewed** flag and save.
   The importer will refuse any unchecked image.

Useful editing controls are shown inside Labelme under **Help → Shortcuts**.
The bundle is ordered rather than randomly shuffled so the high-risk masks are
reviewed first.

## Finish and validate

After all 71 images are corrected, checked as reviewed, and saved, convert them
to verified YOLO instance-segmentation labels:

```bash
cd /Users/emily/lego-cv
.venv/bin/python -m training.labelme_io import \
  --bundle training/data/review-labelme \
  --labels training/data/verified-labels \
  --reviewer Emily \
  --confirm-reviewed
```

`--confirm-reviewed` is a declaration that every mask received human review.
The importer validates every file before creating the output and refuses wrong
classes, non-polygon shapes, malformed/self-intersecting polygons, changed image
dimensions, missing JSON files, or unchecked review flags.

Do not run training directly on `training/data/autolabels`. After the import,
resume Phase 3 so the verified labels can receive a fresh QA render and dataset
build before the MPS smoke test.

