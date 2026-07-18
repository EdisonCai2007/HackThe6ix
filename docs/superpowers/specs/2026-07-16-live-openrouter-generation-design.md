# Live OpenRouter LEGO Generation Design

## Context

The app is a local-first HackThe6ix LEGO generator. The user provides a confirmed inventory of LEGO pieces and a free-form prompt such as "build me a duck". The generator should create a small buildable LEGO model using only the available inventory, validate it, export it to LDraw, and render it in the Three.js preview.

The current repo already has:

- Vite and Three.js preview code.
- Fixture inventories and generated models for known objects.
- `GeneratedModel` and inventory typedefs in `src/generation/types.js`.
- Deterministic validation in `src/generation/validator.js`.
- LDraw export in `src/ldraw/exportLDraw.js`.

This design changes the generation path from fixture-only preview to a live OpenRouter-powered flow.

## Goals

- Let the user enter an unrestricted prompt in the local preview app.
- Let the user choose or provide a supported inventory payload.
- Call OpenRouter twice during generation:
  - once to create a high-level structure plan,
  - once to turn that plan into exact brick placements.
- Keep API keys out of browser code by adding a local Node generation service.
- Validate generated placements before rendering.
- Export valid generated models through the existing LDraw exporter.
- Render valid generated models in the existing Three.js viewer.
- Reconcile the documented MVP maximum piece count with code by setting the hard cap to 50 pieces.

## Non-Goals

- No repair loop in this pass.
- No mocked OpenRouter path as the main generation flow. Test doubles are still allowed in automated tests.
- No CV or camera integration.
- No arbitrary mesh output.
- No raw LDraw generated directly by AI.
- No build instruction mode.
- No public deployment.
- No broad support for specialty LEGO parts beyond the existing supported catalog.

Existing fixture models can stay in the repo for tests and manual development, but the main generation action should use live OpenRouter calls.

## Architecture

```text
Vite preview UI
  -> local Node generation service
  -> OpenRouter call 1: structure planner
  -> OpenRouter call 2: placement planner
  -> response parsing and schema checks
  -> deterministic validator
  -> generated model response
  -> LDraw export
  -> Three.js preview
```

The AI owns creative interpretation and placement. Deterministic code owns API-key isolation, prompt construction, JSON parsing, schema checks, validation, and LDraw export.

## Frontend Flow

The preview should stop being hardwired to a single fixture. It should provide:

- Prompt input.
- Inventory selector using the existing demo inventories.
- Generate button.
- Loading and error states.
- Model name, piece count, validation status, and generation notes.
- A validation error display when generation fails.
- The existing orbitable Three.js render for valid models.

The frontend sends the selected prompt and inventory to the local generation service. It should not import OpenRouter keys or call OpenRouter directly.

## Local Generation Service

Add a small Node service owned by the repo, separate from the Vite browser bundle.

Responsibilities:

- Read `OPENROUTER_API_KEY` from the local environment.
- Accept a generation request containing user prompt, inventory, and optional target piece count.
- Build and send the structure-planner OpenRouter request.
- Parse the structure plan JSON.
- Build and send the placement-planner OpenRouter request using the structure plan and inventory.
- Parse the placement model JSON.
- Run the existing validator.
- Return a success response with the valid `GeneratedModel`, structure plan, validation result, and notes.
- Return a failure response with parse or validation errors when generation fails.

The service should not silently replace failed AI output with a fixture model. Clear failure is better for this first live implementation because it exposes prompt/schema/validator problems directly.

## OpenRouter Call 1: Structure Planner

The first call converts the prompt and inventory into a high-level LEGO design plan. It should output JSON only.

Inputs:

- User prompt.
- Supported inventory summary.
- MVP constraints.
- Optional target piece count.

The structure plan should include:

- `model_name`
- `primary_object`
- `target_piece_count`
- `overall_shape`
- `required_features`
- `part_usage_plan`
- `build_strategy`
- `fallback_priorities`
- `user_facing_summary`

The system message should make these rules explicit:

- Do not output exact coordinates.
- Do not output LDraw.
- Do not output meshes or arbitrary geometry.
- Do not invent parts, colors, or quantities outside the inventory.
- Prefer 10-40 pieces.
- Never exceed the requested target count or the 50-piece MVP cap.
- Generate one connected object, not a scene.
- Prioritize recognizable silhouette and required object features.

## OpenRouter Call 2: Placement Planner

The second call turns the structure plan into exact brick placements in the repo's internal `GeneratedModel` format. It should output JSON only.

Inputs:

- Original user prompt.
- Supported inventory summary.
- Structure plan from call 1.
- Supported part dimensions from `partCatalog.js`.
- Internal model format requirements.
- MVP validation rules.

The placement response should include:

- `model_name`
- `prompt`
- `piece_count`
- `dimensions`
- `created_from_inventory_id`
- `generator_version`
- `bricks`
- `notes`

Each brick must include:

- `id`
- `part_id`
- `ldraw_id`
- `label`
- `color_id`
- `color_name`
- `position`
- `rotation`
- `feature`
- `step`

The placement prompt should explicitly forbid:

- Raw LDraw.
- Meshes.
- Unsupported parts.
- Colors not present in the inventory.
- Quantities above inventory counts.
- Floating bricks.
- Overlapping bricks.
- Disconnected components.
- Models above 50 pieces.

The placement planner should use the same grid semantics as the validator: `x` and `y` are stud-grid positions, and `z` is layer height where plates are 1 layer tall and bricks are 3 layers tall.

## Validation And Failure Handling

The existing validator remains the authority for buildability.

Hard checks include:

- Supported parts only.
- Inventory availability.
- No inventory overuse.
- No overlapping bricks.
- No unsupported floating bricks.
- One connected object.
- Ground contact.
- Maximum piece count.

If validation fails, this first version returns a failed generation response with the validator errors. It does not call a repair loop. Repair can be added later by feeding validator errors into another OpenRouter call.

## Module Plan

Add or update these modules:

- `src/generation/designPlan.js`
  - Structure-plan typedefs and lightweight schema checks.
- `src/generation/openRouterPrompts.js`
  - Prompt builders for both OpenRouter calls.
- `src/generation/generatedModelSchema.js`
  - Lightweight checks for required `GeneratedModel` fields before running the validator.
- `src/generation/openRouterClient.js`
  - Small fetch wrapper for OpenRouter requests.
- `src/generation/service.js`
  - Generation orchestration used by the local Node service.
- `server/generationServer.js`
  - Local HTTP API for the Vite app.
- `src/preview/main.js`
  - UI wiring, generation request, render refresh, and error display.
- `index.html` and `src/preview/styles.css`
  - Prompt, inventory selector, status, and validation UI.
- `src/generation/partCatalog.js`
  - Set `MAX_MODEL_PIECES` to 50.

Names can be adjusted during implementation if the repo pattern suggests a better location, but the boundaries should stay intact.

## Testing

Use `node --test`.

Tests should cover:

- Structure prompt builder includes the user prompt, supported inventory, JSON-only rule, and 50-piece cap.
- Placement prompt builder requests internal `GeneratedModel` JSON and forbids raw LDraw/meshes.
- Structure-plan schema rejects malformed or incomplete JSON.
- Generated-model schema rejects missing required fields before validation.
- Service orchestration works with injected test-double OpenRouter responses and does not hit the network.
- Validator catches invalid AI placement output.
- A valid fake service response can be exported to LDraw.

Manual verification should include:

- Start the local generation service with `OPENROUTER_API_KEY`.
- Start Vite.
- Generate a model from a demo inventory.
- Confirm invalid AI output shows errors instead of rendering.
- Confirm valid AI output renders in Three.js and shows model metadata.

## Open Questions Deferred

- Repair loop strategy and attempt count.
- Whether to add a backend fallback fixture for demo resilience.
- Whether to stream generation status to the frontend.
- Whether to create a stricter JSON Schema dependency or keep lightweight hand-rolled checks.
- How to support user-edited inventory payloads after the demo inventory selector.
