# Open Questions

## Detection And Inventory

- Which exact color ID system should the app use internally?
- How confident does detection need to be before a piece becomes generator-usable?
- Will users be allowed to edit/correct the detected inventory before generation?
- How many supported part types can Emily's detector reliably identify during the hackathon?

## Generation

- Should the builder be mostly AI placement output or mostly algorithmic placement from an AI design plan?
- How many candidates should be generated per prompt?
- Should invalid candidates be repaired by AI, deterministic logic, or both?
- What fallback should appear if all repair attempts fail?

## Validation

- What exact coordinate system should internal placement JSON use?
- How strict should the support rule be for overhangs?
- Should one-stud connections be allowed or warned?
- Should weak support be a warning or a hard failure?

## LDraw

- Should internal color IDs match LDraw directly or map from Rebrickable?
- Where should LDraw part files come from during local development?
- Should generated LDraw be stored as a file, string, or blob for the frontend?
- How should rotations be represented internally before export?

## Three.js Preview

- Should the app render directly from LDraw text or from a temporary `.ldr` file?
- What camera angle should be the default for generated models?
- Should the preview show a grid/floor, or only the model?
- Should inventory usage be shown next to the model?

## Hackathon Demo

- What prompts should be used in the live demo?
- Should there be a manual test inventory in case live detection is unreliable?
- Should the demo include a known "safe" inventory that can produce a reliable duck/car/flower?
- How much should the app reveal about the repair/validation loop during judging?

