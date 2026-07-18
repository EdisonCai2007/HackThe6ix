# Generation Progress Timeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a seven-stage generation timeline to the preview UI using streamed backend progress.

**Architecture:** Extend `generateModel()` with an optional progress callback, add a dependency-free Server-Sent Events route to `server/generationServer.js`, and update the Vite preview to consume the stream and render a fixed seven-row timeline.

**Tech Stack:** JavaScript ES modules, Node `node:test`, local Node HTTP server, browser `fetch` streaming, Vite, Three.js.

## Global Constraints

- Keep `POST /api/generate` working.
- Add `POST /api/generate/stream` for progress streaming.
- Do not expose `OPENROUTER_API_KEY` in browser code.
- Do not add third-party dependencies.
- Show these seven UI stages: structure generation, structure JSON parse, structure JSON repair, placement generation, placement JSON parse, placement JSON repair, validation.
- Run verification with `npm test`.
- Git commit is blocked because this workspace is not currently a git repository.

---

## File Structure

- `src/generation/service.js`: add progress callback support and emit stage events.
- `server/generationServer.js`: add SSE helpers and `/api/generate/stream`.
- `index.html`: add timeline container.
- `src/preview/main.js`: consume streaming generation and update timeline state.
- `src/preview/styles.css`: style timeline rows.
- `test/generation/service.test.js`: add progress-event coverage.
- `test/server/generationServerEvents.test.js`: test SSE event formatting helper.

### Task 1: Generator Progress Events

**Files:**
- Modify: `src/generation/service.js`
- Modify: `test/generation/service.test.js`

**Interfaces:**
- Consumes: existing `generateModel({ userPrompt, inventory, targetPieceCount, openRouterClient, model })`
- Produces: `generateModel({ ..., onProgress })`, where `onProgress(event)` receives `{ type, stage, status, label }`

- [ ] **Step 1: Write failing progress tests**

Add tests asserting that a successful fake generation emits running/complete events for the seven stage ids and skips repair stages when no repair is needed.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/generation/service.test.js`

Expected: FAIL because `onProgress` is ignored.

- [ ] **Step 3: Implement minimal progress events**

Add a small `emitProgress(onProgress, event)` helper and call it around structure generation, structure parsing, structure repair, placement generation, placement parsing, placement repair, and validation.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/generation/service.test.js`

Expected: PASS.

### Task 2: Streaming Server Endpoint

**Files:**
- Modify: `server/generationServer.js`
- Create: `test/server/generationServerEvents.test.js`

**Interfaces:**
- Produces: `formatSseEvent(eventName, payload)`
- Produces: `POST /api/generate/stream`

- [ ] **Step 1: Write failing SSE helper test**

Create a test asserting `formatSseEvent("progress", { stage: "validation" })` returns an SSE block with `event: progress`, one `data:` JSON line, and a blank line terminator.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/server/generationServerEvents.test.js`

Expected: FAIL because the helper is not exported.

- [ ] **Step 3: Implement SSE helper and stream route**

Export `formatSseEvent`. Add `sendSseHeaders()` and a `/api/generate/stream` branch that validates input, emits progress events from `generateModel()`, then emits `result`.

- [ ] **Step 4: Run server tests**

Run: `node --test test/server/generationServerEvents.test.js test/server/cors.test.js`

Expected: PASS.

### Task 3: Timeline UI

**Files:**
- Modify: `index.html`
- Modify: `src/preview/main.js`
- Modify: `src/preview/styles.css`

**Interfaces:**
- Consumes: SSE events named `progress` and `result`
- Produces: fixed seven-row timeline in `#generation-timeline`

- [ ] **Step 1: Add timeline markup**

Add `<ol id="generation-timeline" class="generation-timeline" aria-label="Generation progress"></ol>` inside `.model-card`.

- [ ] **Step 2: Implement frontend timeline state**

Define the seven timeline stages, render them on startup, update each row as events arrive, and use the streaming endpoint from `requestGeneration()`.

- [ ] **Step 3: Style timeline**

Add compact row styling for pending, running, complete, skipped, and failed states without covering the Three.js model.

- [ ] **Step 4: Run full tests**

Run: `npm test`

Expected: PASS.

### Task 4: Manual Verification

**Files:**
- No source edits unless verification exposes a defect.

- [ ] **Step 1: Start dev server**

Run: `npm run dev`

Expected: the generation server and Vite preview start.

- [ ] **Step 2: Generate from the browser**

Open the shown local URL, submit a prompt, and confirm the seven timeline rows advance.

- [ ] **Step 3: Verify failure clarity**

When generation fails, confirm the failed row matches the server result stage and `validation-errors` shows the existing error payload.
