# Isometric Generation Refinement Design

## Goal

Improve both valid and invalid generated LEGO models with one final multimodal refinement pass, while enforcing a hard maximum of three AI calls for each submitted build.

## Decisions

- A submitted build may make at most three AI calls: structure planning, initial placement, and refinement.
- Existing build-suggestion generation remains separate and is outside this submitted-build call budget.
- The refinement input includes one fixed isometric image rather than multiple views.
- Refinement is allowed to replace the entire build, not only patch individual bricks.
- Refinement has no `KEEP`/`REBUILD` classification. It always returns one complete `GeneratedModel`.
- When the current build is already the best result, refinement returns the same model contents unchanged.
- There are no AI JSON-repair retries and no second refinement or rebuild call.

## Generation Flow

1. Call the structure model and locally parse and validate the returned structure plan.
2. Call the placement model and locally parse and shape-check the returned `GeneratedModel`.
3. Run deterministic inventory cleanup on the initial model. Preserve the original model, the cleaned model, removed-brick details, and current deterministic validation errors.
4. Stream the cleaned placement draft to the browser.
5. In the browser, render the draft from a fixed isometric camera into a dedicated offscreen canvas. The snapshot uses consistent framing and lighting, contains the entire build, and omits the editor grid, selection state, invalid overlays, and other UI.
6. Send the snapshot and refinement context back to the generation server.
7. Call the refinement model once. It receives:
   - the original user prompt;
   - the structure plan;
   - the full selected inventory;
   - the original placement model;
   - the cleaned current model;
   - removed-brick details;
   - deterministic validation errors;
   - the isometric image.
8. Locally parse, shape-check, and deterministically validate the returned full `GeneratedModel`.
9. Select the final result using the fallback rules below and load it into the editor.

The browser orchestrates steps 1-4 and 6-9 as one Generate action but two local HTTP requests. The first request produces the initial placement context. The second carries the browser-rendered image and makes the third and final AI call. This avoids exposing the Gemini API key in the browser and avoids adding a server-side WebGL runtime.

## Refinement Contract

The refinement model is a combined visual evaluator and model generator. It must return exactly one complete `GeneratedModel` matching the existing schema, with no commentary or decision wrapper.

It may change every brick when a rebuild would improve prompt resemblance, recognizable silhouette, proportions, color placement, or physical validity. It must obey the full inventory and existing LEGO geometry rules. When no change is warranted, it returns the current cleaned model with the same model contents.

The deterministic validator remains authoritative. The refinement model's visual judgment cannot declare a build valid.

## Deterministic Fallback

“Best draft” is not inferred or scored subjectively. Selection follows a fixed order:

1. If the refined model parses, matches the schema, and passes deterministic validation, use it.
2. If the refined model is invalid but the cleaned initial model is valid, use the cleaned initial model.
3. If both are deterministically invalid but the refined model parses and matches the schema, load the refined model as the latest usable draft and display its validation errors.
4. If the refinement output cannot be parsed or fails the schema, load the cleaned initial model and display its validation errors.

An invalid but schema-usable draft remains editable. The UI does not clear it or force-stop after the third AI call.

## Call Budget and Failures

- Structure output that cannot be parsed and validated fails locally after call one.
- Placement output that cannot be parsed or shape-checked fails locally after call two.
- Refinement output that cannot be parsed or shape-checked falls back locally after call three.
- Malformed output never triggers another AI request.
- Deterministic cleanup, rendering, validation, fallback selection, and editor loading do not consume AI calls.

The normal and maximum submitted-build call count is therefore three whenever structure and placement produce usable outputs. The refinement call is always made for a usable initial placement, whether that placement is valid or invalid.

## Components

- The generation service owns structure and placement generation, deterministic cleanup, validation context, and refinement result selection.
- A focused browser-side isometric snapshot renderer owns fixed framing and image capture without changing the user's editor camera.
- A refinement prompt builder owns the multimodal instructions and structured context.
- The Gemini client carries the isometric image as inline image data alongside the refinement prompt.
- The preview orchestration keeps the streamed draft visible while the refinement request is running and then commits the selected final model through the existing model-first editor path.

## Testing

- Service tests assert exactly three generation-client calls for valid, invalid, unchanged, and rebuilt flows.
- Tests assert that malformed structure, placement, and refinement outputs never trigger an AI repair call.
- Prompt tests verify that refinement receives the full inventory, prompt, plan, original and cleaned models, removed bricks, validation errors, and image input.
- Fallback tests cover all four deterministic selection branches.
- Snapshot-renderer tests verify fixed camera/framing configuration and image capture through injected renderer and loader doubles, without requiring browser/WebGL automation.
- Preview tests verify the two-request orchestration, draft persistence, warning display, cancellation, and final model commit.
- Server tests verify refinement request validation and ensure one refinement request maps to one provider call.
- Run focused tests followed by the full test suite. Do not make live Gemini requests or run browser/WebGL automation unless separately approved.

## Acceptance Criteria

- Every usable initial placement receives exactly one isometric refinement call.
- A submitted build never exceeds three AI calls, excluding the separate pre-submission suggestion request.
- The refinement response is always a full `GeneratedModel`; there is no reviewer classification.
- Refinement may return the current model unchanged or rebuild it completely.
- Valid refined models replace the initial candidate.
- Failed refinement never causes a valid initial candidate to be lost.
- When neither candidate is valid, the latest schema-usable draft remains visible and editable with deterministic warnings.
- No AI JSON repair or second rebuild is attempted.
