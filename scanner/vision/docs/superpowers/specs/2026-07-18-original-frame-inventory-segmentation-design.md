# Original-Frame Inventory Segmentation Review Design

## Goal

Replace the stitched inventory-review mosaics with untouched Record3D RGB
frames so Emily corrects segmentation on the same kind of imagery used to
train the YOLO instance-segmentation model.

## Review images

For each of the 12 inventory sessions, choose the smallest set of already
selected source frames whose accepted observations collectively cover every
currently fused component. Prefer a sharper frame when two frames add the same
coverage. Copy each selected `frames/*.rgb.jpg` byte-for-byte into a new
run-scoped LabelMe bundle. Do not rectify, warp, average, blend, sharpen, or
otherwise rewrite pixels.

Run YOLO proposals in original-image coordinates and optionally refine their
boundaries with the existing SAM2 box-prompt gate. Each selected source image
must contain editable `lego_piece` polygons for all accepted detections visible
in that image. Emily may delete duplicates/false positives, split bad merges,
and add missed pieces.

## Counts and fusion

The physical batch counts are hard session-level acceptance gates:

| Session | Required pieces |
|---|---:|
| 20260718-161438 | 48 |
| 20260718-161851 | 74 |
| 20260718-162215 | 83 |
| 20260718-162458 | 64 |
| 20260718-162834 | 88 |
| 20260718-163214 | 85 |
| 20260718-163451 | 63 |
| 20260718-163723 | 67 |
| 20260718-164119 | 86 |
| 20260718-164730 | 57 |
| 20260718-165118 | 39 |
| 20260718-165402 | 26 |

An individual source frame is not expected to contain the session's full
count. Once all selected frames are reviewed, their corrected masks will be
mapped through the stored homographies and fused. The importer must reject a
session unless its fused reviewed instance count equals the required count.
Matching the count is necessary but not sufficient: every visible source image
must still be marked reviewed and contain one polygon per visible physical
piece.

## Safety and outputs

Write a new output directory and preserve all historical session artifacts and
the existing mosaic bundles. Record the source image path, frame ID, session
ID, expected physical count, source SHA-256, and selection coverage in the
bundle manifest. This phase does not change color or part identification.

## Verification

Unit tests must prove minimum-cover selection, sharpness tie-breaking,
original-coordinate polygons, byte-identical image copying, and persistence of
the 12 required counts. The generated bundle must contain no image whose bytes
differ from its recorded source. The full `lego-cv` test suite must remain
green.
