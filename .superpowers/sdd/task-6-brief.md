### Task 6: Full Local Verification With Live OpenRouter

**Files:**
- Modify only if earlier tasks expose an integration issue:
  - `server/generationServer.js`
  - `src/generation/openRouterPrompts.js`
  - `src/preview/main.js`

**Interfaces:**
- Consumes: `OPENROUTER_API_KEY`
- Consumes: `npm run serve:generation`
- Consumes: `npm run dev`
- Produces: verified local two-call generation flow

- [ ] **Step 1: Run automated tests**

Run: `npm test`

Expected: PASS.

- [ ] **Step 2: Start generation service with environment key**

Run: `npm run serve:generation`

Expected: console prints `Generation service listening at http://127.0.0.1:8787`.

If the shell does not already have `OPENROUTER_API_KEY`, run the approved environment-loading workflow used by the user or export it manually in that shell before starting the service:

```bash
export OPENROUTER_API_KEY="your-local-key"
npm run serve:generation
```

- [ ] **Step 3: Start Vite**

Run: `npm run dev`

Expected: Vite starts on `http://127.0.0.1:5173/`.

- [ ] **Step 4: Verify successful generation in browser**

Open `http://127.0.0.1:5173/`, keep inventory as `Duck demo pieces`, keep prompt `build me a duck`, and click Generate.

Expected: UI shows `Generating`, then either:

- `Valid`, a generated model name, piece count, notes, and a refreshed 3D render, or
- `Failed` with validation errors from the service.

For this first pass, a validation failure is acceptable if OpenRouter returns mechanically invalid placements; the important requirement is that the error is visible and no fixture silently replaces it.

- [ ] **Step 5: Verify service rejects invalid requests**

Run:

```bash
curl -s http://127.0.0.1:8787/api/generate \
  -H 'Content-Type: application/json' \
  -d '{"userPrompt":"","inventory":{"items":[]}}'
```

Expected response includes:

```json
{"ok":false,"stage":"request"}
```

- [ ] **Step 6: Stop both dev servers**

Press `Ctrl-C` in the Vite terminal and the generation-service terminal.

Expected: both processes exit cleanly.

- [ ] **Step 7: Record blocked commit**

Run: `git status --short`

Expected: FAIL with `fatal: not a git repository`. Record that commit is blocked until `.git` is restored.

---

## Plan Self-Review

- Spec coverage: Tasks cover the two OpenRouter calls, API-key isolation, schema checks, validator authority, no repair loop, no silent fallback, preview UI, `MAX_MODEL_PIECES = 50`, and tests with injected test doubles.
- Placeholder scan: No `TBD`, `TODO`, or unspecified "add validation" steps remain. Deferred questions stay in the approved design spec, not in implementation steps.
- Type consistency: Prompt builders, service orchestration, schema guards, and preview code consistently use `userPrompt`, `targetPieceCount`, `inventory`, `structurePlan`, `GeneratedModel`, and `validation`.
- Git caveat: Commit steps are replaced with explicit blocked-commit checks because the workspace currently has no `.git` directory.
