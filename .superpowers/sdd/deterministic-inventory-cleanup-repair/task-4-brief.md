### Task 4: Stream And Render Interim Drafts

**Files:**
- Modify: `server/generationServer.js`
- Modify: `src/preview/main.js`
- Modify: `test/server/generationServerEvents.test.js`
- Test manually with `npm test`

**Interfaces:**
- Consumes: `onProgress` events from Task 2.
- Produces:
  - SSE event `draft` with payload `{ type: "draft", stage, model, validation?, removedBricks? }`
  - Preview draft rendering state: `validationStatus.textContent = "Repairing draft"` for invalid drafts.

- [ ] **Step 1: Add SSE draft formatting test**

Append to `test/server/generationServerEvents.test.js`:

```js
it("formats draft SSE events with model payloads", () => {
  const event = formatSseEvent("draft", {
    type: "draft",
    stage: "placement_draft",
    model: { model_name: "Draft Duck" },
  });

  assert.equal(
    event,
    'event: draft\ndata: {"type":"draft","stage":"placement_draft","model":{"model_name":"Draft Duck"}}\n\n',
  );
});
```

- [ ] **Step 2: Run server event tests**

Run: `node --test test/server/generationServerEvents.test.js`

Expected: PASS. This confirms the existing formatter supports the new event type.

- [ ] **Step 3: Forward draft events separately from progress events**

In `server/generationServer.js`, update the `createGenerationResult(body, onProgress)` callback in `handleGenerateStream()`:

```js
const result = await createGenerationResult(body, (event) => {
  if (event.type === "draft") {
    response.write(formatSseEvent("draft", event));
    return;
  }

  response.write(formatSseEvent("progress", event));
});
```

- [ ] **Step 4: Add draft handling helpers in preview**

In `src/preview/main.js`, replace `showModel(model, validation)` with:

```js
function showModel(model, validation, options = {}) {
  modelName.textContent = model.model_name;
  pieceCount.textContent = String(model.piece_count);
  validationStatus.textContent =
    options.statusText ?? (validation.valid ? "Valid" : "Invalid");
  setNotes(model.notes);

  if (validation.valid || options.hideErrors) {
    hideErrors();
  } else {
    showErrors(validation.errors);
  }

  renderModel(model);
}
```

Add a draft handler near `handleSseBlock()`:

```js
function handleDraftEvent(payload) {
  if (!payload.model) {
    return;
  }

  const validation = payload.validation ?? {
    valid: false,
    errors: [],
    warnings: [],
    inventory_usage: [],
  };

  showModel(payload.model, validation, {
    statusText: payload.stage === "pruned_draft" ? "Repairing pruned draft" : "Repairing draft",
    hideErrors: payload.stage === "placement_draft",
  });
}
```

- [ ] **Step 5: Wire draft SSE event handling**

In `handleSseBlock(block)`, add this branch before the `result` branch:

```js
if (event.eventName === "draft") {
  handleDraftEvent(event.payload);
  return undefined;
}
```

- [ ] **Step 6: Keep failed final result from blanking a rendered draft**

In the `catch` block of the submit handler in `src/preview/main.js`, replace:

```js
modelName.textContent = "Generation failed";
pieceCount.textContent = "-";
setNotes([]);
```

with:

```js
if (!currentModelGroup) {
  modelName.textContent = "Generation failed";
  pieceCount.textContent = "-";
  setNotes([]);
}
```

Keep:

```js
validationStatus.textContent = "Failed";
markTimelineFailureFromResult(error.stage);
showErrors(error.errors ?? [error.message ?? "Unknown generation error"]);
```

- [ ] **Step 7: Run full automated tests**

Run: `npm test`

Expected: PASS for all `node --test` suites.

- [ ] **Step 8: Manual stream verification**

Run the generation service and Vite in two terminals:

```bash
npm run serve:generation
npm run dev:preview
```

Expected:
- The generation service starts at `http://127.0.0.1:8787`.
- The Vite preview starts and serves the app.
- Submitting a prompt shows a draft model before final repair completes when the placement is schema-valid.
- If repair succeeds, the final valid model replaces the draft.
- If repair fails after a draft renders, the model remains visible and the error panel shows the final errors.

- [ ] **Step 9: Commit Task 4**

Run:

```bash
git add server/generationServer.js src/preview/main.js test/server/generationServerEvents.test.js
git commit -m "Render draft models during validation repair"
```

Expected: commit succeeds. If `git status` reports this checkout is not a repository, record `commit blocked: not a git repository` and continue.

---

## Final Verification

- [ ] Run all tests:

```bash
npm test
```

Expected: every `node --test` suite passes.

- [ ] Confirm the plan-aligned spec remains in place:

```bash
test -f docs/superpowers/specs/2026-07-16-deterministic-inventory-cleanup-repair-design.md
```

Expected: command exits with status 0.
