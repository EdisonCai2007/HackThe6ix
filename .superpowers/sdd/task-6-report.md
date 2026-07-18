# Task 6: Full Local Verification With Live OpenRouter

## Status

BLOCKED. Automated verification passed, but the required generation service could not bind to localhost in this execution environment. The task explicitly directs reporting this condition rather than working around it.

## Commands Run

1. `npm test`
   - Exit status: 0.
   - Summary: 35 tests passed; 0 failed, cancelled, skipped, or todo.
   - Covered suites included prompt builders, service orchestration with injected doubles, schema guards, model validation, LDraw export, and loader integration.

2. `if [ -n "$OPENROUTER_API_KEY" ]; then printf 'OPENROUTER_API_KEY=present\\n'; else printf 'OPENROUTER_API_KEY=absent\\n'; fi`
   - Output: `OPENROUTER_API_KEY=absent`.

3. `npm run serve:generation`
   - Required expected output was not reached.
   - Exact failure:
     ```text
     Error: listen EPERM: operation not permitted 127.0.0.1:8787
     ...
     code: 'EPERM',
     errno: -1,
     syscall: 'listen',
     address: '127.0.0.1',
     port: 8787
     ```
   - Because the service could not start, `npm run dev`, browser generation at `http://127.0.0.1:5173/`, and the required `curl` invalid-request check could not be run. No substitute server or port was used, per the task brief.

4. `git status --short`
   - Output: `fatal: not a git repository (or any of the parent directories): .git`.
   - Commit is blocked until `.git` is restored.

## Live OpenRouter Result

Not verified. `OPENROUTER_API_KEY` was unavailable and the local generation service was blocked from binding to `127.0.0.1:8787` before any live OpenRouter request could be issued.

## Changes Made

No source files were modified. This report is the only file created.

## Files Changed

- `.superpowers/sdd/task-6-report.md`

## Self-Review Findings

- No concrete integration issue was observed from the automated suite.
- The generation-service startup error is an environment sandbox restriction, not evidence of a source integration failure.
- No silent fallback was introduced or exercised.

## Concerns

- Full acceptance requires rerunning `npm run serve:generation` and `npm run dev` in an environment permitted to bind localhost, with `OPENROUTER_API_KEY` loaded.
- Once both services are running, perform the browser `Duck demo pieces` / `build me a duck` flow and the specified malformed-request `curl` check before declaring the two-call generation flow verified.

## Controller Follow-Up Verification

The controller resolved the subagent's sandbox blocker with elevated localhost execution and confirmed `.env` contains `OPENROUTER_API_KEY` without printing the key.

Additional commands and outcomes:

1. `npm run serve:generation` with `.env` loaded and elevated localhost binding.
   - Output: `Generation service listening at http://127.0.0.1:8787`.

2. Invalid-request check:
   - Command: `curl -s http://127.0.0.1:8787/api/generate -H 'Content-Type: application/json' -d '{"userPrompt":"","inventory":{"items":[]}}'`
   - Output: `{"ok":false,"stage":"request","errors":["userPrompt must be a non-empty string."]}`.

3. First live duck generation request reached OpenRouter but failed before generation:
   - HTTP status: `500`.
   - Error summary: OpenRouter rejected the request because the default token budget requested up to `65536` tokens while the account could afford `25000`.

4. Integration fix made after that failure:
   - `src/generation/openRouterPrompts.js` now sets `max_tokens: 2500` on both OpenRouter prompt requests.
   - `test/generation/openRouterPrompts.test.js` now asserts both prompt builders include `max_tokens: 2500`.

5. Verification after the token-cap fix:
   - `node --test test/generation/openRouterPrompts.test.js`: 4/4 passing.
   - `npm test`: 35/35 passing.

6. Live duck generation retry after restarting the service:
   - HTTP status: `422`.
   - Result: OpenRouter returned structure and placement JSON, and the service rejected the placement at the deterministic validation stage with overlap, floating-brick, and disconnected-component errors.
   - This verifies the two-call live path reaches OpenRouter and that invalid AI placement is not silently replaced with a fixture fallback.

7. Vite smoke check:
   - `npm run dev` started successfully at `http://127.0.0.1:5173/`.
   - `curl -i http://127.0.0.1:5173/` returned `HTTP/1.1 200 OK` and the updated app shell with prompt, inventory selector, target-piece input, and Generate button.

Controller-side source files changed after the subagent report:

- `src/generation/openRouterPrompts.js`
- `test/generation/openRouterPrompts.test.js`
- `.superpowers/sdd/task-6-report.md`

Remaining limitation:

- A valid rendered live AI model was not achieved because repair is intentionally out of scope and the live placement failed validation. The failure behavior is acceptable for this pass: the service returns validation errors and does not use a silent fallback.
