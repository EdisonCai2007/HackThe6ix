# Example Duck Flow

## Purpose

This file gives future agents a concrete example of how the system should behave end to end.

The example is illustrative. It is not a final algorithm or exact LDraw export.

## User Prompt

```text
build me a small duck
```

## Confirmed Inventory

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

## Prompt Interpretation

```json
{
  "primary_object": "duck",
  "style": "small",
  "key_features": ["body", "head", "beak"],
  "optional_features": ["eyes", "tail"],
  "preferred_colors": ["yellow", "orange", "black"],
  "color_flexibility": "medium",
  "multi_object_prompt": false
}
```

## High-Level Design Plan

```json
{
  "model_name": "Small Duck",
  "target_piece_count": 12,
  "features": [
    {
      "name": "body",
      "priority": "required",
      "description": "low rectangular yellow body"
    },
    {
      "name": "head",
      "priority": "required",
      "description": "small raised yellow block at the front"
    },
    {
      "name": "beak",
      "priority": "required",
      "description": "orange protrusion on front of head"
    },
    {
      "name": "eyes",
      "priority": "optional",
      "description": "black side markers near head"
    }
  ]
}
```

## Example Model JSON

This is intentionally simple and approximate.

```json
{
  "model_name": "Small Duck",
  "prompt": "build me a small duck",
  "piece_count": 7,
  "bricks": [
    {
      "id": "body-plate-1",
      "part_id": "3020",
      "ldraw_id": "3020.dat",
      "label": "2x4 plate",
      "color_id": "14",
      "color_name": "yellow",
      "position": { "x": 0, "y": 0, "z": 0 },
      "rotation": 0,
      "feature": "body",
      "step": 1
    },
    {
      "id": "body-brick-1",
      "part_id": "3001",
      "ldraw_id": "3001.dat",
      "label": "2x4 brick",
      "color_id": "14",
      "color_name": "yellow",
      "position": { "x": 0, "y": 0, "z": 1 },
      "rotation": 0,
      "feature": "body",
      "step": 2
    },
    {
      "id": "body-brick-2",
      "part_id": "3003",
      "ldraw_id": "3003.dat",
      "label": "2x2 brick",
      "color_id": "14",
      "color_name": "yellow",
      "position": { "x": 1, "y": 4, "z": 1 },
      "rotation": 0,
      "feature": "body-rear",
      "step": 2
    },
    {
      "id": "head-1",
      "part_id": "3003",
      "ldraw_id": "3003.dat",
      "label": "2x2 brick",
      "color_id": "14",
      "color_name": "yellow",
      "position": { "x": 1, "y": -1, "z": 2 },
      "rotation": 0,
      "feature": "head",
      "step": 3
    },
    {
      "id": "beak-1",
      "part_id": "3004",
      "ldraw_id": "3004.dat",
      "label": "1x2 brick",
      "color_id": "25",
      "color_name": "orange",
      "position": { "x": 1, "y": -3, "z": 2 },
      "rotation": 0,
      "feature": "beak",
      "step": 4
    },
    {
      "id": "eye-left",
      "part_id": "3005",
      "ldraw_id": "3005.dat",
      "label": "1x1 brick",
      "color_id": "0",
      "color_name": "black",
      "position": { "x": 0, "y": -1, "z": 3 },
      "rotation": 0,
      "feature": "eye",
      "step": 5
    },
    {
      "id": "eye-right",
      "part_id": "3005",
      "ldraw_id": "3005.dat",
      "label": "1x1 brick",
      "color_id": "0",
      "color_name": "black",
      "position": { "x": 2, "y": -1, "z": 3 },
      "rotation": 0,
      "feature": "eye",
      "step": 5
    }
  ],
  "notes": [
    "Prioritized body, raised head, beak, and eyes.",
    "Used fewer than all available pieces.",
    "Free-standing one-object build."
  ]
}
```

## Example Validation Result

```json
{
  "valid": true,
  "errors": [],
  "warnings": [
    {
      "type": "simplified_geometry",
      "message": "The duck is blocky and abstract, but includes body, head, beak, and eye markers."
    }
  ],
  "inventory_usage": [
    { "part_id": "3020", "color_id": "14", "available": 3, "used": 1 },
    { "part_id": "3001", "color_id": "14", "available": 4, "used": 1 },
    { "part_id": "3003", "color_id": "14", "available": 6, "used": 2 },
    { "part_id": "3004", "color_id": "25", "available": 2, "used": 1 },
    { "part_id": "3005", "color_id": "0", "available": 2, "used": 2 }
  ]
}
```

## Example User-Facing Summary

```text
I made a small duck using your pieces. I focused on the body, raised head, orange beak, and eye details. It uses 7 pieces and stays within your detected inventory.
```
