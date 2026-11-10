# Source-frame waypoint inventory review design

## Goal

Make batch inventory review trustworthy and quick. Each review item must point to
one visible LEGO piece in one untouched source camera frame. The reviewer confirms
the model's proposed block type and color, removes false or duplicate detections,
and adds pieces the primary frame missed.

The redesign must preserve Emily's completed first-batch work wherever it can be
mapped unambiguously. It must not overwrite the existing review workspace or any
historical session artifact.

## Why the current model is unsafe

The existing review workspace is built from fused multi-frame components. In batch
`20260718-161851`, `piece-008` contains reviewed shapes from frames 2 and 200 that
show different physical objects. The association also records several nested-mask
overlap conflicts. Therefore an alternate thumbnail is not reliable evidence that
it depicts the same LEGO piece.

Batch `20260718-161438` currently contains 50 candidates and 49 confirmed included
items for an expected 48 pieces, while the physical review found four pieces absent.
The candidate count therefore includes false or duplicate identities and cannot be
used as proof of complete inventory coverage.

## Considered approaches

### 1. Keep fused components and select a better thumbnail

This is the smallest code change, but it preserves the incorrect identity link.
A sharper thumbnail can still show the wrong physical object. Rejected.

### 2. Use a generated mosaic as the only review image

This gives one overview and one numbering system, but warped boundaries and partial
coverage can cut off or omit pieces. It also makes it harder to trace a crop back to
the exact RGB evidence used by the detector. Rejected.

### 3. Use source-frame waypoints with explicit missed-piece addition

This keeps every item traceable. A primary untouched frame supplies the initial
numbered detector waypoints. Additional untouched frames are available only through
an explicit missed-piece flow; they are never attached automatically as alternate
views. This is the selected approach.

## Review experience

The page retains the current two-column layout and batch selector.

- The left side displays one complete, untouched RGB camera frame with numbered
  detector waypoints. It is not a mosaic, a rectified table crop, or an overlay of
  several frames.
- Selecting a waypoint highlights it and shows a clear crop made from that exact
  frame on the right. The crop has enough padding to show the whole detected piece.
- The right side shows the model's proposed block type and color. Part ID remains
  optional. The reviewer may edit the type or color and select **Confirm + next**.
- **Delete detection** excludes a false or duplicated waypoint without destroying
  its provenance. It can be restored.
- **Add missed piece** opens the batch's other untouched source frames. The reviewer
  selects a detector waypoint that was absent from the primary review set. If no
  detector waypoint exists, the reviewer may click the piece and create a manual
  review item with a padded local crop.
- Added items remain tied to their chosen source frame. They do not acquire automatic
  alternate thumbnails or fused observations.
- The header reports expected physical count, active review-item count, confirmed
  included count, excluded count, and unresolved count. Count agreement is a review
  aid, not automatic proof that identities are correct.

## Primary frame and waypoint generation

For each batch, choose the original source frame that maximizes useful detector
coverage, local sharpness, and distance from frame boundaries. Do not choose a frame
based on the expected inventory ordering.

Run or reuse the object detector on that source frame. Each retained detection gets
a stable key containing the session ID, source frame ID, and detector instance ID.
The initial page contains one review item per retained primary-frame detection.

Conservative same-frame suppression may remove a strictly nested duplicate only
when containment, centroid distance, and mask/box agreement all satisfy tested
criteria. Ambiguous overlaps stay visible and reviewable. There is no automatic
cross-frame identity fusion in this review workspace.

## Prediction provenance

The proposed type and color must be derived from the exact waypoint crop or copied
from an existing result only when that result has an unambiguous link to the same
source frame and detector instance. A prediction from a fused component may not be
copied merely because its table-space location is nearby.

When no trustworthy exact prediction exists, display the type as `unknown brick`
and populate color only if the same-crop color evidence is available. The reviewer
can still confirm without entering a part ID.

## First-batch preservation

Create a new run-scoped waypoint review workspace. Leave
`inventory-validation-v2/review.json` unchanged.

For batch `20260718-161438`, migrate a confirmed type, color, inclusion decision, and
optional part ID only when the old component resolves to exactly one new waypoint
through a shared source-frame detection or reviewed-shape key. Ambiguous old
components remain unresolved in the new workspace. Produce a migration report with
the number migrated, skipped as ambiguous, and not found.

The four physically observed missing pieces must be added through the explicit
missed-piece flow. The system must not assume that 49 existing confirmations plus
four missing pieces equals 53 valid pieces; false or duplicate old candidates must
still be excluded until the active inventory equals the physical count of 48.

## Data model

Each review item records:

- stable waypoint ID;
- session ID and source frame ID;
- detector instance ID, box, optional mask, confidence, and provenance;
- full source-frame asset path and exact padded crop path;
- proposed and reviewer-confirmed type, color, and optional part ID;
- inclusion, confirmation, and exclusion state;
- whether it originated in the primary frame, another frame, or a manual click;
- any same-frame duplicate-suppression or migration audit notes.

The workspace points to new run-scoped review files and assets. Existing session
outputs and LabelMe annotations remain read-only inputs.

## Error handling

- Missing source images, invalid boxes, or crops outside image bounds fail workspace
  generation with the exact session, frame, and waypoint identified.
- The browser never silently substitutes another frame when an asset is missing.
- Saving an item validates the color and review state but does not require a part ID.
- Duplicate deletion is reversible and does not remove files.
- A batch cannot be locked while unresolved items remain or active included count
  differs from the declared physical count.

## Verification

Automated tests cover:

1. one waypoint always references exactly one source frame;
2. the UI never exposes cross-frame alternate thumbnails;
3. primary images retain their original dimensions and full frame extent;
4. padded crops are clipped safely and contain the selected detector box;
5. conservative same-frame duplicate suppression keeps adjacent pieces;
6. missed-piece additions from another frame create new independent items;
7. blank part IDs can be confirmed;
8. deletion/restoration and header counts remain consistent;
9. first-batch migration copies only exact unambiguous matches;
10. the old workspace and historical analysis artifacts remain byte-for-byte
    unchanged.

The generated workspace will also be manually checked on Batch 1 and on Batch 2
`piece-008`: Batch 1 must show a complete original frame, and no Batch 2 item may
show the two reported screenshots as alternate views of one piece.
