# LDraw Model Format

## Why LDraw

LDraw is a LEGO-native model format. It is text-based and represents models using part files, colors, transforms, and coordinates.

LDraw is useful for this project because:

- it avoids inventing a custom LEGO 3D format
- it maps naturally to real LEGO part identifiers
- it can represent brick placements
- it supports step markers for future instructions
- Three.js has an LDrawLoader for rendering

Relevant references:

- https://www.ldraw.org/article/218.html
- https://threejs.org/docs/#examples/en/loaders/LDrawLoader

## Internal JSON First

The generator should not ask AI to produce raw LDraw text as the primary internal output.

Recommended flow:

```text
AI/builder output
  -> structured model JSON
  -> deterministic validation
  -> LDraw export
```

This makes validation and repair easier.

## Internal Placement Shape

```json
{
  "id": "body-1",
  "part_id": "3001",
  "ldraw_id": "3001.dat",
  "label": "2x4 brick",
  "color_id": "14",
  "color_name": "yellow",
  "position": {
    "x": 0,
    "y": 0,
    "z": 0
  },
  "rotation": 0,
  "feature": "body",
  "step": 1
}
```

## LDraw Export Concept

Each placed brick should export to an LDraw part line.

Conceptually:

```text
1 <color> <x> <y> <z> <transform matrix> <part file>
```

A future implementation should centralize coordinate conversion so the rest of the app can reason in simple stud/plate units while LDraw receives its expected coordinate system.

## Step Markers

Build instructions are not MVP, but the model JSON should keep a `step` or ordering field.

This allows future features:

- interactive build playback
- manual generation
- brick-by-brick animation
- grouped construction steps

LDraw can represent build steps using `0 STEP` markers.

## Color IDs

The team needs to choose one canonical color system.

Options:

- use LDraw color IDs internally
- use Rebrickable color IDs internally and map to LDraw at export
- define internal normalized color names and map both systems

Recommendation:

Use whatever Emily's detection pipeline can produce most reliably, then maintain an explicit mapping layer for LDraw export.

## Model Metadata

Generated models should include metadata separate from brick placements:

```json
{
  "model_name": "Tiny Duck",
  "source_prompt": "build me a small duck",
  "piece_count": 14,
  "created_from_inventory_id": "duck-demo",
  "generator_version": "mvp-docs",
  "notes": [
    "Free-standing one-object model.",
    "Instructions are not generated in MVP."
  ]
}
```

## Risks

LDraw is powerful, but the team should watch for:

- coordinate system confusion
- rotation matrix complexity
- part file availability
- color ID mismatches
- browser loader setup details

The docs intentionally recommend an internal JSON model first to isolate those risks.

