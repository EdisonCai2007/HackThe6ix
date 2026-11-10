# Multi-view Inventory Fusion and Object-aware Mosaic Design

## Goal

Produce a complete, accurate LEGO inventory from a moving-camera Record3D
session without losing pieces outside one camera view or inventing pieces at
stitched-image boundaries. Also produce one comprehensive top-down image for
human inspection, but do not make inventory correctness depend on redetecting
that blended image.

## Evidence and failure model

Session `20260716-234326` contains eight visible pieces. Its sharpest,
most-top-down frame covers only 63.6% of the bounded workspace, while the
union of all valid RGB footprints covers 85.0%. Median-filling the remainder
hides missing observations and clips pieces at the selected frame boundary.

The former winner-take-all composite covers the multi-frame union but creates
hard source transitions. On this session it produced eleven detections, six
intersecting a source seam. Four-frame feathering removed hard transitions but
produced ten detections through parallax ghosting; blending all frames produced
twelve. Exposure compensation, graph-cut seam selection, and multi-band
blending produced a visually clean image but still produced ten detections
because seams divided raised LEGO pieces.

The root constraint is therefore: background pixels may be blended across
views, but one physical LEGO piece must be selected from one intact source
observation. No seam may cross a detected foreground object.

## Architecture

### 1. Coverage-aware frame selection

`lego-capture` will score every recorded frame using:

- usable RGB footprint on the bounded table workspace;
- incremental coverage not already supplied by selected frames;
- top-down angle;
- sharpness;
- distance to the table.

A greedy set-cover selector will choose a small set of high-quality frames,
normally three to five, until no frame materially increases usable coverage.
The valid mask of every rectified frame will be eroded by a configurable safety
margin so interpolation fringes and camera-frame borders are never treated as
valid object pixels.

The exported metadata will report usable RGB coverage and the selected frame
IDs. Coverage below the configured target will be explicit rather than hidden
by table-color filling.

### 2. Per-view rectification and detection

Each selected frame will be rectified independently into the existing table
coordinate system. `lego-cv` will run the current color-aware OpenCV detector
on every rectified image without blending views first.

Each observation will contain:

- its source frame ID;
- table-coordinate box and center;
- image-space crop and foreground mask;
- dominant LEGO color;
- sharpness and top-down quality;
- distance from the valid-footprint boundary;
- an `incomplete` flag when its mask or padded box approaches that boundary.

An incomplete observation is evidence that a piece exists, but it cannot be
the preferred identification crop when a complete observation of the same
piece exists.

### 3. Table-coordinate instance fusion

Observations will be associated in the common table plane. Two observations
may represent the same physical piece only when their projected centers,
footprints, dimensions, and colors are compatible. Association will be
implemented as a deterministic graph/cluster operation rather than depending
on processing order.

For each fused instance, the best complete observation will be selected using
boundary clearance, sharpness, top-down angle, visible area, and color
confidence. Brickognize and final color classification will run once on that
best crop. If every observation is incomplete, the instance remains in the
inventory but is marked uncertain/partial in diagnostics rather than silently
dropped or double-counted.

The primary inventory count comes from these fused instances. It never comes
from rerunning detection on the final mosaic.

### 4. Object-aware comprehensive mosaic

The top-down visualization will use the selected frames, not all recorded
frames:

1. Match table/background exposure between frames.
2. Remove the eroded invalid borders.
3. Protect the union of per-view LEGO foreground masks from seam placement.
4. Use graph-cut seam selection through unprotected table pixels.
5. Use a narrow multi-band blend around the selected background seams.
6. Insert every fused LEGO instance from its selected best source as one intact
   masked region, with a small feather only outside the object boundary.
7. Fill genuinely unobserved canvas areas with a clearly documented neutral
   background and mark them invalid in metadata.

The result remains suitable for a human-facing `topdown.jpg` and debug overlay,
while `inventory.json` remains tied to fused multi-view instances.

## Interfaces and repository boundary

`lego-capture` owns frame selection, rectification, valid masks, coverage
metadata, and comprehensive mosaic rendering. It will export a multi-view
manifest alongside the selected rectified images.

`lego-cv` owns per-view detection, table-coordinate association, best-crop
selection, identification, inventory generation, and the final overlay labels.
The existing one-image CLI remains supported; a new session/manifest input is
the accurate multi-view path.

The manifest schema will be versioned and contain table mapping, dimensions,
selected frame IDs, quality metrics, rectified image paths, valid-mask paths,
and usable RGB coverage.

## Error handling

- No recorded frames: fail with the existing clear session error.
- Insufficient RGB union coverage: continue with explicit coverage and partial
  diagnostics; do not claim comprehensive output.
- A piece seen only at a footprint boundary: count one uncertain instance and
  surface it in the overlay.
- Conflicting colors or incompatible sizes at one location: keep observations
  separate unless spatial evidence strongly establishes a duplicate.
- Mosaic seam optimization failure: fall back to a background-only feathered
  visualization; fused inventory remains valid because it is independent.
- Brickognize failure: retain the fused instance as `unknown brick`, using the
  existing cache/retry behavior.

## Acceptance criteria

### Real sessions

- `20260716-234326`: exactly eight fused instances; no clipped-piece duplicate,
  no seam-generated instance, all eight visible in the comprehensive mosaic.
- `20260716-221544`: exactly eight fused instances including the gray plate;
  central red/yellow/white pieces remain separate.
- `20260716-212422`: exactly seven fused instances and no bottom-edge artifact.

### Automated tests

- Frame selection reaches the same coverage as the usable union when a minimal
  subset can do so and favors sharper equivalent frames.
- Valid-mask erosion excludes synthetic warp borders.
- One piece observed in three views fuses to one instance.
- Nearby different-color pieces remain separate.
- Same-color pieces at distinct table positions remain separate.
- A partial boundary observation fuses with a complete observation and never
  becomes a second inventory item.
- Mosaic seams cannot cross protected synthetic object masks.
- Mosaic failure does not change fused inventory results.

## Larger batches and future YOLO segmentation

The selected-frame cap keeps inference bounded as session length grows. Larger
tables are handled by additional spatially complementary frames rather than by
requiring one fixed camera view. A future YOLO instance-segmentation backend
will replace the per-view foreground masks and boxes while preserving frame
selection, table-coordinate fusion, best-observation selection, and
object-aware mosaic composition.

## Out of scope

- Training YOLO instance segmentation in this implementation.
- Dense 3D reconstruction of every brick from coarse LiDAR depth.
- Generative filling of genuinely unobserved workspace.
- Changing Brickognize identification behavior beyond selecting a better crop.
