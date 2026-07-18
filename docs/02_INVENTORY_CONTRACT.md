# Inventory Contract

## Purpose

This file defines the handoff between the LEGO detection pipeline and the model generation pipeline.

The generator must not consume raw CV detections directly. It should consume a normalized, confirmed inventory payload.

## Source Of Truth

The inventory payload is the source of truth for generation.

The generator may use fewer pieces than the inventory contains, but it must never exceed the count for any part/color combination.

## Recommended Payload Shape

```json
{
  "inventory_id": "local-session-001",
  "source": "camera_scan",
  "items": [
    {
      "label": "2x4 brick",
      "category": "brick",
      "part_id": "3001",
      "ldraw_id": "3001.dat",
      "rebrickable_part_num": "3001",
      "color_name": "yellow",
      "color_id": "14",
      "count": 4,
      "confidence": 0.94,
      "supported": true
    }
  ]
}
```

## Field Definitions

`inventory_id`
: Local identifier for the current scan/session.

`source`
: How the inventory was created. Expected values include `camera_scan`, `photo_upload`, or `manual_test_fixture`.

`label`
: Human-readable simplified label, such as `2x4 brick` or `1x2 plate`.

`category`
: Broad supported type, such as `brick` or `plate`.

`part_id`
: Canonical part identifier used by the app. For MVP, this can match common LDraw/Rebrickable part numbers when possible.

`ldraw_id`
: LDraw part file name, such as `3001.dat`.

`rebrickable_part_num`
: Rebrickable part number if available.

`color_name`
: Human-readable color.

`color_id`
: Canonical color identifier used by the app. The team should decide whether this follows LDraw color IDs or an internal normalized set.

`count`
: Number of confirmed pieces of this exact part/color combination.

`confidence`
: Optional detection confidence. The generator should only consume items already marked as supported/confirmed.

`supported`
: Whether this piece is supported by the MVP generator.

## MVP Supported Inventory

The MVP should focus on rectangular bricks and plates.

Suggested first supported set:

```json
[
  { "label": "1x1 brick", "part_id": "3005", "ldraw_id": "3005.dat" },
  { "label": "1x2 brick", "part_id": "3004", "ldraw_id": "3004.dat" },
  { "label": "1x3 brick", "part_id": "3622", "ldraw_id": "3622.dat" },
  { "label": "1x4 brick", "part_id": "3010", "ldraw_id": "3010.dat" },
  { "label": "1x6 brick", "part_id": "3009", "ldraw_id": "3009.dat" },
  { "label": "1x8 brick", "part_id": "3008", "ldraw_id": "3008.dat" },
  { "label": "2x2 brick", "part_id": "3003", "ldraw_id": "3003.dat" },
  { "label": "2x3 brick", "part_id": "3002", "ldraw_id": "3002.dat" },
  { "label": "2x4 brick", "part_id": "3001", "ldraw_id": "3001.dat" },
  { "label": "1x2 plate", "part_id": "3023", "ldraw_id": "3023.dat" },
  { "label": "1x4 plate", "part_id": "3710", "ldraw_id": "3710.dat" },
  { "label": "1x6 plate", "part_id": "3666", "ldraw_id": "3666.dat" },
  { "label": "2x2 plate", "part_id": "3022", "ldraw_id": "3022.dat" },
  { "label": "2x4 plate", "part_id": "3020", "ldraw_id": "3020.dat" }
]
```

The exact list can be reduced if detection or rendering is easier with fewer pieces.

## Filtering Rule

Before generation, inventory should be filtered to supported pieces:

```text
confirmed inventory
  -> remove unsupported part families
  -> remove low-confidence detections
  -> normalize labels/colors
  -> pass supported inventory to generator
```

Unsupported pieces should not break generation. They should be ignored for MVP.

## Example Inventory

```json
{
  "inventory_id": "duck-demo",
  "source": "manual_test_fixture",
  "items": [
    {
      "label": "2x4 brick",
      "category": "brick",
      "part_id": "3001",
      "ldraw_id": "3001.dat",
      "color_name": "yellow",
      "color_id": "14",
      "count": 4,
      "supported": true
    },
    {
      "label": "2x2 brick",
      "category": "brick",
      "part_id": "3003",
      "ldraw_id": "3003.dat",
      "color_name": "yellow",
      "color_id": "14",
      "count": 6,
      "supported": true
    },
    {
      "label": "1x2 brick",
      "category": "brick",
      "part_id": "3004",
      "ldraw_id": "3004.dat",
      "color_name": "orange",
      "color_id": "25",
      "count": 2,
      "supported": true
    },
    {
      "label": "1x1 brick",
      "category": "brick",
      "part_id": "3005",
      "ldraw_id": "3005.dat",
      "color_name": "black",
      "color_id": "0",
      "count": 2,
      "supported": true
    },
    {
      "label": "2x4 plate",
      "category": "plate",
      "part_id": "3020",
      "ldraw_id": "3020.dat",
      "color_name": "yellow",
      "color_id": "14",
      "count": 3,
      "supported": true
    }
  ]
}
```
