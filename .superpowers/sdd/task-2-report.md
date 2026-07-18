# Task 2: OpenRouter Prompt Builders Report

## What Was Implemented

- Added `src/generation/openRouterPrompts.js`.
- Added `DEFAULT_OPENROUTER_MODEL` with the value `openai/gpt-4.1-mini`.
- Added `summarizeSupportedInventory(inventory)`, which keeps only supported catalog parts and emits the model-relevant dimensions, heights, colors, quantities, and identifiers.
- Added `buildStructurePrompt(...)` for high-level structure planning with JSON-only output rules, inventory restrictions, and target/MVP piece caps.
- Added `buildPlacementPrompt(...)` for exact `GeneratedModel` JSON placement planning with LDraw/mesh exclusions, inventory limits, stud-grid coordinates, layer heights, rotations, and connectivity/stability constraints.

## Tests and Results

- Focused command: `node --test test/generation/openRouterPrompts.test.js`
- Focused result: 3 passed, 0 failed.
- Full command: `node --test`
- Full result: 30 passed, 0 failed.

## TDD Evidence

1. Added `test/generation/openRouterPrompts.test.js` before the implementation.
2. Ran the focused test and observed the expected `ERR_MODULE_NOT_FOUND` for `src/generation/openRouterPrompts.js`.
3. Added the minimal implementation from the task brief.
4. Re-ran focused tests and the full suite; all tests passed.

## Files Changed

- `src/generation/openRouterPrompts.js`
- `test/generation/openRouterPrompts.test.js`
- `.superpowers/sdd/task-2-report.md` (this required report)

## Self-Review Findings

- Prompt builders do not make network calls and do not add server or UI code.
- Inventory output is limited to supported parts present in `SUPPORTED_PARTS`.
- Both request builders return OpenRouter-compatible `response_format: { type: "json_object" }`.
- Target counts are clamped to the existing `MAX_MODEL_PIECES` limit.
- Placement prompt explicitly requests `GeneratedModel` JSON and excludes raw LDraw and meshes.
- No unrelated files were modified.

## Concerns

- Commits are blocked because this workspace is not a git checkout. `git status --short` returned `fatal: not a git repository (or any of the parent directories): .git`. No destructive git commands were run.

## Review Fix

- Updated `buildPlacementPrompt(...)` so the `GeneratedModel` placement template uses numeric values for `piece_count`, `rotation`, and `step`.
- Added explicit prompt constraints requiring a non-negative integer `piece_count`, positive integer `step`, and numeric `rotation` constrained to `0`, `90`, `180`, or `270`.
- Added a focused regression test that parses the placement template and asserts these numeric, integer, positive, and enum constraints.

## Fix Verification

- Focused command: `node --test test/generation/openRouterPrompts.test.js`
- Focused result: 4 passed, 0 failed.
- Full command: `npm test`
- Full result: 31 passed, 0 failed.
