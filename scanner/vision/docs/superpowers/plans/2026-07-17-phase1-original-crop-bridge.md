# Phase 1 — The Bridge: identify from ORIGINAL unwarped crops

**Goal:** rectified views keep doing localization + fusion; Brickognize sees
only crops cut from the original full-res RGB frames, so raised pieces are no
longer perspective-distorted (orange 1x8 misread as 1x10; unknowns).

**Root gap found:** the multiview manifest (v1) carries no geometry linking a
rectified canvas back to its source frame. lego-cv cannot map a fused box into
an original image today. The Bridge is therefore a manifest upgrade (capture
side) plus a crop-mapping module (cv side).

## Changes — lego-capture (branch codex/option-a-color-detection)

1. **Padding bug (commit properly):** replace `WORKSPACE_CROP_PAD_X_M = 0.025`
   / `WORKSPACE_CROP_PAD_Y_M = 0.005` with one symmetric
   `WORKSPACE_CROP_PAD_M = 0.025` (topdown.py; multiview.py imports it).
   This reproduces the validated 25 mm-vertical diagnostic.
2. **Manifest v2** (multiview.py): each view entry additionally carries
   - `homography`: the exact 3x3 `plane_homography(K, pose, W2T, px_per_m,
     origin_xy)` used to rectify that view — maps canvas px -> original px
     (this is the "inverse homography" direction the Bridge needs);
   - `rgb`: session-relative path to the original frame JPEG; `rgb_size`;
   - `raise_uv_per_cm`: image-space displacement (px) of a point raised 1 cm
     above the plane, computed at canvas center — the geometrically correct
     "pad toward the camera" bias direction (avoids re-deriving pose in cv).
   `version: 2`. Tests: stored homography equals plane_homography; on a
   synthetic oblique view, a physically raised point's projection displaces
   along `raise_uv_per_cm`.

## Changes — lego-cv (branch codex/option-a-color-detection)

3. **pipeline/original_crop.py** (pure, unit-tested):
   `original_box(box_canvas, H, rgb_size, raise_uv_per_cm, pad_frac=0.2,
   raise_cm=1.5) -> Box` — map 4 corners through H, AABB, pad `pad_frac` of
   box size all around, extend additionally by `raise_uv_per_cm * raise_cm`
   on the side the piece top displaces toward, clamp to image.
4. **multiview.py:** `load_views` accepts manifest v1+v2 (v2 fields optional
   per view); `scan_manifest` cuts the identification crop from the ORIGINAL
   frame of the fused instance's best observation (falls back to the
   rectified crop for v1 manifests). Best-observation ranking is unchanged —
   its `quality` already encodes obliquity² × sharpness, plus completeness
   and boundary clearance. Watch the world-vs-table trap: canvas px -> table
   xy -> H is the only conversion; no world coords involved.
5. **Provenance:** each instance in `multiview_result.json` gains
   `id_crop: {frame_id, rgb, box_original, brickognize: {part_id, name,
   score}}`.
6. **Debug overhaul (session_cli.py):** stop drawing boxes on the mosaic.
   New `debug/` outputs per session: `crop_gallery.jpg` (best original crop
   per fused piece + Brickognize label/score) and per-selected-frame
   `frame_<id>_overlay.jpg` (fused boxes projected via that view's H onto the
   original frame). `topdown.jpg` mosaic remains box-free coverage preview.

## GATE (stop for Emily's approval)

Regenerate manifests + rerun session_cli on all 4 real sessions
(212422 / 221544 / 234326 / 005145). Success: counts 7/8/8/7 (005145 keeps
the known white-merge), orange 1x8 identified as 1x8 again, unknown rate
drops. Deliverable: before/after table (snapshot current inventory.json +
multiview_result.json first).

Out of scope: stud counting (Phase 2), trained separator (Phase 3), seam
blending, mosaic redetection, detector threshold changes.
