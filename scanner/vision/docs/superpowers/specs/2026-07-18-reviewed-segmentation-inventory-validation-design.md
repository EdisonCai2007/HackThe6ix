# Reviewed-Segmentation Inventory Validation Design

## Goal

Turn Emily's completed 25-image LabelMe review into a run-scoped color and
brick-type confirmation workspace without counting repeated camera views as
additional pieces.

## Immutable inputs

The original-frame LabelMe bundle is human-authored evidence and must never be
rewritten. Import requires all 25 JSON files to be marked `reviewed`, contain
only valid `lego_piece` polygons, match their recorded image dimensions and
source hashes, and retain the twelve approved physical counts totaling 780.

## Association strategy

The production inventory components remain identity anchors because they
already contain Brickognize part candidates and cross-view tracking evidence.
Each reviewed polygon is projected into the common table canvas with its
stored frame homography. Within each source frame, deterministic one-to-one
geometric assignment associates reviewed polygons to production anchors. This
prevents one reviewed polygon from validating multiple components in the same
frame and prevents a component from consuming two stacked polygons from one
frame.

An anchor with reviewed matches receives corrected masks and sharp crops. An
anchor with no reviewed match is retained but explicitly flagged for review;
it is never silently removed. Reviewed polygons that cannot be assigned are
clustered across frames and appended as `human-unmatched` candidate components,
never silently discarded. Remaining nested/high-overlap pairs are recorded as
segmentation conflicts for the confirmation UI.

## Color and identity confirmation

The new review document pre-fills each component with the current production
part ID/name/candidates and inventory-profile color. Corrected human masks are
used for the displayed real-image crops. The reviewer can confirm, change, or
exclude a component and mark residual duplicates. No Brickognize API calls are
made while building this workspace.

## Count gate

Every session retains its recorded count. The UI may not lock a batch until
all candidates are confirmed, residual duplicates are excluded, and accounted
physical pieces exactly equal the expected session count. Count equality is
necessary but the generated conflict provenance and real crops remain visible
so an offsetting duplicate and miss cannot be hidden.

## Output and verification

Write only beneath new `analysis-runs/inventory-validation-v2` directories and
create a new workspace manifest. Unit tests cover bundle validation,
one-to-one assignment, unmatched preservation, and conflict provenance. The
generated workspace must contain all twelve sessions, preserve total 780, and
pass the full test suite before launch.
