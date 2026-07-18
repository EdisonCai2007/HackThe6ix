# Task 2 Report: Wire Cleanup Into Validation Repair

## Status

DONE

## Changes

- Added `placement_draft` progress emission after placement schema validation.
- Replaced the AI inventory-repair branch with `cleanupIllegalInventoryUsage(model, inventory)`.
- Emits `pruned_draft` with the pruned model, validation result, and removed-brick metadata.
- Preserves cleanup context on validation failures.
- Passes `original_failed_generated_model`, `pruned_generated_model`, and `removed_bricks` through the buildability repair request payload.
- Falls back to a valid pruned model when the subsequent AI buildability repair cannot be parsed, reporting `repaired: false`.
- Adds service regressions for draft emission, deterministic cleanup before buildability repair, and valid-pruned fallback.
- Updated the former inventory-repair test to expect deterministic cleanup and a single buildability AI call.

## TDD Evidence

1. Added the requested service regressions before implementation.
2. Ran `node --test test/generation/service.test.js` and observed four expected failures for missing draft events, cleanup metadata, and pruned fallback.
3. Implemented the scoped service wiring and prompt payload pass-through.
4. Corrected the task brief's non-existent Node assertion API from `assert.doesNotDeepEqual` to `assert.notDeepEqual`.

## Verification

- `node --test test/generation/service.test.js test/generation/generationPrompts.test.js`: 23 passing, 0 failing.
- `node --test test/generation/inventoryCleanup.test.js`: 4 passing, 0 failing.
- `node --check src/generation/service.js`: passed.
- `node --check src/generation/generationPrompts.js`: passed.

## Commit

Commit blocked: this checkout is not a git repository (`fatal: not a git repository`). No repository was initialized.

## Concerns

None. Prompt changes are restricted to the three requested payload fields; Task 3 remains responsible for expanding repair wording and prompt-specific coverage.
