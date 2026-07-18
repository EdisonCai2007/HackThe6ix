# Deterministic Inventory Cleanup Repair Design

## Context

The generation service already validates AI-produced LEGO models with deterministic rules before rendering. It also has a validation repair stage that sends failed models back to the placement model. The repair behavior should stay grounded in the failed model, but it should not freeze bricks just because they were not directly named in a validator error.

Inventory violations are different from buildability and appearance issues. If a brick uses a part/color combination that is not in the confirmed inventory, uses an unsupported part id, or exceeds available quantity, that is an objective legality problem. The app should clean those illegal bricks deterministically before asking the AI to repair the remaining design.

## Goals

- Remove illegal inventory/part usage in code before the AI repair call.
- Track exactly which bricks were removed and why.
- Render the first schema-valid placement draft before repair finishes, even when deterministic validation fails.
- Revalidate the pruned model before AI repair so the AI receives current validator errors.
- Send the AI enough context to repair the damaged model intelligently:
  - original failed model,
  - pruned model,
  - removed brick report,
  - current validation errors,
  - user prompt,
  - structure plan,
  - supported inventory summary.
- Allow the AI to modify any remaining brick when necessary.
- Tell the AI to repair the existing model, not rebuild from scratch.
- Keep deterministic schema and model validation as the final authority.

## Non-Goals

- No full regeneration path for this change.
- No AI call just to decide whether inventory-invalid bricks are legal.
- No new validator rule set.
- No visual scoring or critic pass.
- No fallback fixture when repair fails.
- No rendering of malformed JSON or models that fail the `GeneratedModel` shape check.

## Chosen Approach

Use a two-step repair path:

1. Deterministic inventory cleanup.
2. AI buildability and design repair.

The cleanup step handles objective legality. The AI step handles the creative consequences of that cleanup: lost features, floating pieces, disconnected assemblies, overlaps, and silhouette repair.

This keeps the AI focused on the part of the problem where it is useful. The validator remains the source of truth.

## Interim Draft Preview

After placement JSON parses and passes the `GeneratedModel` shape check, the app should emit or return that model as an interim draft even if `validateModel()` reports hard errors. The preview should render it with a draft/repairing state so the user sees that generation is producing a model.

This draft render is not accepted output. It can have floating pieces, overlaps, disconnected components, or illegal inventory. It exists to show progress while the deterministic cleanup and AI repair stages continue.

The preview should reconstruct the Three.js scene when the repaired model arrives. If repair succeeds, the repaired valid model replaces the draft. If repair fails, the UI can keep showing the last renderable draft while clearly showing the validation failure.

Malformed placement text and objects that fail `GeneratedModel` shape validation still cannot render, because there is no reliable model to export or load.

## Deterministic Cleanup

Add a helper that takes the failed `GeneratedModel`, inventory, and supported part catalog, and returns:

```js
{
  model: prunedModel,
  removedBricks: [
    {
      id: "eye-2",
      feature: "eye",
      part_id: "9999",
      color_id: "0",
      reason: "unsupported_part",
      message: "eye-2 uses unsupported part 9999."
    }
  ]
}
```

The helper removes:

- bricks with unsupported part ids,
- bricks with part/color combinations absent from confirmed supported inventory,
- excess bricks beyond available quantity for a part/color pair.

For overused inventory, the helper should keep the first allowed bricks in model order and remove later excess bricks. This is predictable, easy to test, and avoids inventing a hidden scoring system.

After cleanup, update `piece_count` to match the pruned brick list. Preserve the original model metadata, dimensions, notes, feature labels, and steps unless the implementation has a narrow reason to normalize them.

## AI Repair Contract

The validation repair prompt should receive both the original failed model and the pruned model. The prompt should say:

- The pruned model is the starting point.
- Do not rebuild from scratch.
- Preserve the requested object, major features, and recognizable silhouette.
- Prefer the smallest set of changes that can pass validation.
- You may modify any remaining brick if needed.
- You may add legal supported inventory pieces if available.
- Do not re-add removed illegal bricks.
- Use only supported parts and part/color combinations present in inventory.
- Return one full `GeneratedModel` JSON object.

The removed brick report should be included so the AI knows what visual features were damaged by cleanup. For example, if an invalid eye brick was removed, the AI can recreate an eye using an available legal part or simplify the face.

## Flow

```text
Placement model JSON
  -> schema validation
  -> emit/render schema-valid draft placement
  -> deterministic model validation
  -> if valid: return success
  -> deterministic inventory cleanup
  -> validate pruned model
  -> if cleanup removed no bricks and remaining errors are not repairable: return failure
  -> AI repair with pruned model + removed brick report + current errors
  -> schema validation
  -> deterministic model validation
  -> if valid: return success
  -> if AI repair fails but pruned model is valid: return pruned model with cleanup metadata
  -> otherwise: return validation failure with original, pruned, and final validation context
```

If cleanup removes all bricks, the AI repair stage can still run with an empty pruned model and the removed brick report, but the prompt must still say to reconstruct from the damaged draft rather than restart freely.

If cleanup removes illegal bricks and the pruned model already validates, the AI repair stage should still run once. The reason is visual: removed bricks may have represented eyes, accents, wheels, or other requested features. The AI gets one chance to restore those features with legal inventory pieces. If that AI attempt fails, the valid pruned model is still usable as a fallback because it has already passed deterministic validation.

If the raw draft cannot be rendered because unsupported or illegal parts break the preview/export path, the app should render the pruned model after cleanup instead. This is a best-effort fallback for visibility, not a change to validation rules.

## Error Handling

If cleanup cannot produce a structurally valid model, that is expected. The AI repair stage receives the pruned validation errors.

If the AI repair returns malformed JSON, keep the existing `validation_repair_parse` failure behavior.

If the AI repair returns a malformed `GeneratedModel`, keep the existing `validation_repair_shape` failure behavior.

If the AI repair returns a well-formed but invalid model, return a validation failure with:

- final repaired model,
- final validation errors,
- pruned model,
- pruned validation errors,
- original validation errors,
- removed brick report.

The failure response should include the latest renderable draft model when available so the preview can continue showing something instead of going blank.

## Testing

Use `node --test`.

Add focused tests for:

- cleanup removes unsupported part ids before AI repair,
- cleanup removes part/color combinations absent from inventory,
- cleanup removes excess overused pieces deterministically by model order,
- generation emits or returns a schema-valid invalid placement as a draft before repair,
- the preview-facing result can distinguish draft rendering from accepted valid output,
- repair prompt includes the original failed model, pruned model, removed brick report, and current validation errors,
- repair prompt allows modifying any remaining brick while forbidding full rebuild,
- successful AI repair can change a previously non-error brick and still pass final validation,
- if cleanup alone makes the model valid, AI still gets one repair attempt when bricks were removed,
- if AI repair fails after cleanup produced a valid pruned model, generation can fall back to the valid pruned model.

Existing service tests around malformed JSON repair, progress timeline states, and final validation should continue to pass.

## Success Criteria

- Inventory legality is enforced without an AI decision.
- The AI repair stage understands what cleanup removed.
- The user sees an interim draft model while validation repair continues.
- The AI can modify any remaining brick when needed.
- The repair flow stays grounded in the failed/pruned model and does not become full regeneration.
- Final output only succeeds after deterministic schema and model validation pass.
