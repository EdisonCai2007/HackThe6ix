# Generation Architecture

## Chosen Approach

Use a hybrid AI-driven generator with deterministic validation and bounded repair.

The AI should provide creativity and prompt understanding. Deterministic code should enforce inventory and geometry rules.

## Why Not Direct AI-Only Generation

Direct AI-to-coordinate generation is attractive because it is fast to prototype. However, it is risky:

- AI may hallucinate parts.
- AI may exceed available counts.
- AI may produce overlapping bricks.
- AI may produce floating or disconnected components.
- AI may generate output that looks plausible as JSON but is not buildable.

The generator needs hard validation after every AI output.

## Why Not Pure Templates

Template-driven generation is reliable but less exciting:

- "duck", "car", and "flower" can work well.
- unusual prompts collapse into generic forms.
- supporting many object types requires many handcrafted templates.
- judges may see less AI-driven creativity.

Templates may still be useful inside the builder, but they should not be the whole product.

## Recommended Pipeline

```text
User prompt
  + supported inventory
  -> Prompt Interpreter
  -> Designer Agent
  -> Constrained Builder
  -> Validator
  -> Repair Loop
  -> Critic/Scorer
  -> Model JSON
  -> LDraw Export
```

## Component Responsibilities

### Prompt Interpreter

Extracts build intent from unrestricted text.

Example input:

```text
build me a tiny yellow duck with a cute beak
```

Example output:

```json
{
  "primary_object": "duck",
  "style": "cute",
  "size": "tiny",
  "key_features": ["body", "head", "beak"],
  "preferred_colors": ["yellow", "orange"],
  "color_flexibility": "medium"
}
```

### Designer Agent

Creates a high-level object plan from the interpreted prompt and inventory summary.

Example output:

```json
{
  "model_name": "Tiny Duck",
  "target_piece_count": 18,
  "parts_to_suggest": [
    { "feature": "body", "shape": "low rectangular oval", "priority": "required" },
    { "feature": "head", "shape": "small cube above front", "priority": "required" },
    { "feature": "beak", "shape": "small orange protrusion", "priority": "required" },
    { "feature": "eyes", "shape": "black side markers", "priority": "optional" }
  ]
}
```

### Constrained Builder

Turns the high-level design into brick placements.

It should understand:

- available part dimensions
- LEGO grid units
- inventory counts
- simple support rules
- one connected object requirement

The builder may be partly algorithmic and partly AI-guided.

### Validator

Checks the proposed model against deterministic rules.

The validator should be the source of truth for:

- inventory usage
- max piece count
- no overlaps
- grid alignment
- support/connection plausibility
- one connected object

### Repair Loop

If validation fails, return structured error messages to the repair step.

Example:

```json
{
  "valid": false,
  "errors": [
    {
      "type": "inventory_exceeded",
      "part_id": "3001",
      "color_id": "14",
      "available": 4,
      "used": 5
    },
    {
      "type": "floating_brick",
      "brick_instance_id": "head-2"
    }
  ]
}
```

The repair loop should be capped at 2-3 attempts for demo reliability.

### Critic/Scorer

Evaluates whether the valid model still resembles the prompt.

The critic should not override validation. It can only help select between valid candidates or request another attempt if time allows.

Suggested scoring categories:

- recognizable silhouette
- key feature coverage
- piece efficiency
- color match
- compactness

## Output Model JSON

The internal model should stay structured and validation-friendly before LDraw export.

```json
{
  "model_name": "Tiny Duck",
  "prompt": "build me a small duck",
  "piece_count": 14,
  "dimensions": {
    "width_studs": 4,
    "depth_studs": 6,
    "height_bricks": 3
  },
  "bricks": [
    {
      "id": "body-1",
      "part_id": "3001",
      "ldraw_id": "3001.dat",
      "label": "2x4 brick",
      "color_id": "14",
      "color_name": "yellow",
      "position": { "x": 0, "y": 0, "z": 0 },
      "rotation": 0,
      "feature": "body",
      "step": 1
    }
  ],
  "notes": [
    "Generated as a compact free-standing duck.",
    "Prioritized body, head, and beak over exact color matching."
  ]
}
```

## Important Design Rule

The AI can suggest. The validator decides.

