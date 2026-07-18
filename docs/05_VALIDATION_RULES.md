# Validation Rules

## Purpose

Validation prevents the generator from producing fake or impossible LEGO models.

The validator should be deterministic code, not an AI judgment. AI can create and repair candidates, but validation rules decide whether a model is accepted.

## Validation Levels

The MVP targets validation levels A and B:

### A. Basic Grid Validity

- bricks align to LEGO units
- bricks do not overlap
- piece count is within bounds
- all pieces exist in the user's inventory
- all upper bricks have support unless intentionally bridging

### B. Simplified Connection Validity

- bricks must connect through plausible stud/plate contact
- model should be one connected assembly
- unsupported floating clusters are invalid

The MVP does not attempt full physics simulation.

## Hard Rules

### Inventory Rule

Used pieces must be a subset of confirmed inventory.

For each part/color pair:

```text
used_count <= available_count
```

Invalid example:

```text
Inventory has 3 yellow 2x4 bricks.
Model uses 4 yellow 2x4 bricks.
```

### Supported Part Rule

The MVP should only use supported rectangular bricks and plates.

Unsupported detected pieces are ignored unless the generator later adds support for them.

### Piece Count Rule

Preferred range:

```text
10-40 pieces
```

Hard maximum:

```text
50 pieces
```

### Grid Alignment Rule

Every brick must be placed on the LEGO grid.

The internal grid should use stud units horizontally and plate/brick units vertically. The exact coordinate convention can be finalized during implementation, but it must be consistent and exportable to LDraw.

### No Overlap Rule

No two bricks can occupy the same physical volume.

This can be checked by converting each brick placement into occupied grid cells.

### Support Rule

Every brick above the ground layer must have valid support underneath.

For MVP, support can be simplified:

- a brick is supported if at least one stud cell overlaps a brick or plate directly below
- better support if multiple cells overlap
- small overhangs can be allowed if the brick has enough overlap

### Connection Rule

The generated model must be one connected object.

Each brick should connect directly or indirectly to every other brick through stud/plate contact.

Invalid:

- a duck body and a detached eye brick floating next to it
- a car and a separate traffic cone
- decorative loose pieces around the model

### Free-Standing Rule

The model does not require a baseplate.

It should have at least one ground-contact brick and one connected assembly. The generator may create a base-like layer if useful, but it should not force every object onto a rectangular base.

## Soft Rules

Soft rules influence scoring but should not automatically invalidate a model:

- recognizable silhouette
- includes key prompt features
- uses preferred colors when available
- avoids excessive height for small footprints
- avoids awkward single-stud towers
- keeps object compact

## Validation Output Shape

```json
{
  "valid": false,
  "errors": [
    {
      "type": "inventory_exceeded",
      "severity": "hard",
      "message": "Used 5 yellow 2x4 bricks but only 4 are available.",
      "part_id": "3001",
      "color_id": "14",
      "available": 4,
      "used": 5
    },
    {
      "type": "disconnected_component",
      "severity": "hard",
      "message": "Model contains 2 disconnected brick groups."
    }
  ],
  "warnings": [
    {
      "type": "weak_support",
      "severity": "soft",
      "message": "Head is supported by only one stud overlap."
    }
  ]
}
```

## Repair Guidance

Validator errors should be specific enough for repair.

Good repair message:

```text
Brick head-2 is floating at z=3. Move it down or add a supporting brick underneath.
```

Bad repair message:

```text
The model is bad.
```

Structured errors make the repair loop much more likely to succeed.

