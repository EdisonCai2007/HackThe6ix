# Documentation Packet

This documentation packet captures the current technical architecture direction for the LEGO generation project.

It is written for future development context, not as a user-facing pitch.

## Files

- `00_PROJECT_CONTEXT.md` - product idea, team split, MVP boundaries
- `01_SYSTEM_WORKFLOW.md` - end-to-end pipeline and local architecture
- `02_INVENTORY_CONTRACT.md` - CV-to-generator handoff format
- `03_GENERATION_ARCHITECTURE.md` - hybrid AI/builder/validator approach
- `04_AI_AGENT_ROLES.md` - structured AI call responsibilities
- `05_VALIDATION_RULES.md` - deterministic buildability and inventory checks
- `06_LDRAW_MODEL_FORMAT.md` - internal JSON and LDraw export direction
- `07_THREEJS_PREVIEW.md` - 3D preview role and scope
- `08_MVP_SCOPE_AND_STRETCH.md` - MVP requirements, non-goals, stretch goals
- `09_EXAMPLE_DUCK_FLOW.md` - illustrative end-to-end duck example
- `10_OPEN_QUESTIONS.md` - unresolved decisions to revisit later

## Current Architecture Decision

Use a hybrid AI-driven generation system:

```text
confirmed inventory + unrestricted prompt
  -> prompt interpretation
  -> AI design plan
  -> constrained builder
  -> deterministic validator
  -> bounded repair loop
  -> model JSON
  -> LDraw export
  -> Three.js preview
```

The key guarantee is that the generated model must only use pieces from the user's confirmed inventory.

