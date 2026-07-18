# Backboard Tool Removal Design

## Goal

Reduce hidden provider calls by removing Backboard tool calling from the LEGO generation path. Every Backboard stage will receive the complete supported inventory summary in its initial prompt and should complete in one model turn under normal operation.

## Scope

- Remove the `get_inventory_summary` Backboard tool.
- Remove the `validate_generated_model` Backboard tool.
- Remove the Backboard `REQUIRES_ACTION` tool-output continuation loop.
- Stop replacing prompt inventory data with an inventory-session lookup instruction.
- Keep the existing JSON parsing, schema checks, deterministic inventory cleanup, LEGO buildability validation, and repair stages in `src/generation/service.js` unchanged.
- Keep inventory sessions for the browser-to-server request path; only the Backboard-facing tool lookup is removed.

## Request Flow

The server will continue resolving an inventory session before generation. The generation prompt builders already produce a supported inventory summary containing every available part/color combination and its count. The Backboard adapter will send that original prompt content unchanged, along with the system prompt and response schema instructions.

The Backboard message body will not include a `tools` field. A successful stage must return `COMPLETED` from the initial `/threads/messages` request. Any other terminal status remains an explicit Backboard generation error.

The resulting normal flow is:

1. Resolve the selected inventory locally.
2. Build a structure, placement, suggestion, or repair prompt containing the full supported inventory summary.
3. Send one Backboard message for that stage.
4. Parse and validate the returned JSON locally.
5. Run the existing deterministic cleanup or AI repair stage only when local validation requires it.

## Validation Authority

Local application code remains the source of truth:

- `validateGeneratedModelShape()` checks the GeneratedModel contract.
- `validateModel()` checks inventory legality, grid placement, collisions, support, grounding, and connectedness.
- `cleanupIllegalInventoryUsage()` removes objectively illegal inventory usage before repair.
- Existing repair prompts receive the validation errors when a returned placement needs correction.

Removing `validate_generated_model` does not remove validation. It eliminates the duplicate pre-return validation conversation inside Backboard while preserving the application's final checks.

## Error Handling

- A non-`COMPLETED` Backboard response fails with the existing status and provider detail.
- Malformed JSON continues through the existing one-shot JSON-repair path.
- Invalid placements continue through deterministic cleanup and the existing validation-repair path.
- No tool-output endpoint will be called, and no tool-round limit is needed.

## Testing

Update the Backboard client tests first to require that:

- the outgoing message contains inventory items and counts;
- the outgoing message contains the response schema instructions;
- the outgoing message omits Backboard tools;
- a completed stage uses exactly one HTTP request;
- non-`COMPLETED` responses still produce clear errors.

Then run the focused Backboard and generation-service tests followed by the full test suite. No browser or live provider call is required for this adapter-level change.

## Acceptance Criteria

- Backboard receives the full supported inventory summary in every generation-stage prompt.
- Neither `get_inventory_summary` nor `validate_generated_model` is registered or referenced by the Backboard client.
- The Backboard client has no `REQUIRES_ACTION` continuation loop.
- A normal suggestion, structure, placement, or repair stage maps to one provider model turn.
- Existing local validation and repair behavior remains intact.
