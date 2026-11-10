# Overcount Pair Cleanup Implementation Plan

**Goal:** Add a persistent, deletion-only A/B review for the 11 suspicious overlap pairs in the two over-counted LEGO batches.

**Architecture:** Pure inventory-review functions calculate stable same-frame overlap pairs and apply explicit decisions. FastAPI exposes those functions, while the existing vanilla JavaScript page renders a modal with a full source frame, A/B labels, live counts, and three user-controlled actions.

**Tech Stack:** Python 3.11, FastAPI, pytest, vanilla JavaScript, HTML, CSS.

## Global Constraints

- Never delete or overwrite source frames or segmentation assets.
- Never infer a keep/delete decision automatically.
- Use entered part name and color for the decision; Part ID does not control cleanup.
- Persist only beneath the existing run-scoped `review.json`.
- Preserve all unrelated working-tree changes.

---

### Task 1: Pure candidate and decision logic

**Files:**
- Modify: `/Users/emily/lego-cv/training/inventory_review.py`
- Test: `/Users/emily/lego-cv/tests/training/test_inventory_review.py`

**Interfaces:**
- Produces: `overlap_candidates(document: dict) -> list[dict]`.
- Produces: `apply_overlap_decision(document: dict, component_a: str, component_b: str, action: str) -> dict`.

- [ ] **Step 1: Write failing candidate tests** covering same-frame overlap, ignored deleted/unconfirmed rows, stable ordering, and persisted `separate` dismissal.
- [ ] **Step 2: Run** `./.venv/bin/pytest tests/training/test_inventory_review.py -q` and confirm the new tests fail because the functions do not exist.
- [ ] **Step 3: Implement minimal overlap calculation** with `IoU >= 0.20 or containment >= 0.55`, stable pair keys, and current entered labels.
- [ ] **Step 4: Write and fail decision tests** for `keep_a`, `keep_b`, `separate`, invalid action, audit preservation, and count decrement.
- [ ] **Step 5: Implement minimal decision persistence** under `overlap_cleanup.decisions`, preserving the removed record's prior review.
- [ ] **Step 6: Run** `./.venv/bin/pytest tests/training/test_inventory_review.py -q` and confirm all tests pass.

### Task 2: API endpoints and atomic persistence

**Files:**
- Modify: `/Users/emily/lego-cv/inventory_review_app.py`
- Test: `/Users/emily/lego-cv/tests/test_inventory_review_app.py`

**Interfaces:**
- Consumes: `overlap_candidates` and `apply_overlap_decision` from Task 1.
- Produces: `GET /api/sessions/{session_id}/overlap-candidates`.
- Produces: `POST /api/sessions/{session_id}/overlap-decisions` with `{component_a, component_b, action}`.

- [ ] **Step 1: Write failing API tests** for candidate payloads, persisted keep decisions, persisted separate decisions, count changes, and invalid pair/action errors.
- [ ] **Step 2: Run** `./.venv/bin/pytest tests/test_inventory_review_app.py -q` and confirm endpoint tests fail with 404.
- [ ] **Step 3: Implement the two endpoints** using the existing session loader and `atomic_write_json`.
- [ ] **Step 4: Run** `./.venv/bin/pytest tests/test_inventory_review_app.py -q` and confirm all API tests pass.

### Task 3: Existing-page cleanup modal

**Files:**
- Modify: `/Users/emily/lego-cv/inventory_review_web/index.html`
- Modify: `/Users/emily/lego-cv/inventory_review_web/app.js`
- Modify: `/Users/emily/lego-cv/inventory_review_web/styles.css`
- Test: `/Users/emily/lego-cv/tests/test_inventory_review_app.py`

**Interfaces:**
- Consumes: Task 2 endpoints and existing `/assets/{session_id}/{asset_path}` routes.
- Produces: `Review possible extras` modal with full-frame A/B overlays, entered labels, live counts, and explicit decisions.

- [ ] **Step 1: Write a failing served-client contract test** asserting modal, pair labels, the three action labels, and live-count hooks.
- [ ] **Step 2: Run** `./.venv/bin/pytest tests/test_inventory_review_app.py -q` and confirm the contract test fails.
- [ ] **Step 3: Add minimal HTML and CSS** for the full-frame pair modal and responsive right-hand decision panel.
- [ ] **Step 4: Add JavaScript loading, rendering, and decision handlers** without changing normal annotation behavior.
- [ ] **Step 5: Run** `node --check inventory_review_web/app.js` and the two focused pytest files.

### Task 4: Real-data and browser verification

**Files:**
- Read: `/Users/emily/lego-capture/sessions/20260718-161851/analysis-runs/inventory-waypoint-v1/review.json`
- Read: `/Users/emily/lego-capture/sessions/20260718-163723/analysis-runs/inventory-waypoint-v1/review.json`

**Interfaces:**
- Consumes: completed local service and existing run-scoped annotations.
- Produces: verified live cleanup screen at `http://127.0.0.1:8766/`.

- [ ] **Step 1: Run focused and full inventory-review tests** and confirm zero failures.
- [ ] **Step 2: Query both real sessions read-only** and confirm candidate counts are 10 and 1 before Emily's decisions.
- [ ] **Step 3: Restart the existing Uvicorn process** so it serves the new code, preserving its workspace environment.
- [ ] **Step 4: Open and inspect the cleanup modal**; confirm A/B overlays align with the full frame and no mutation occurs before clicking a decision.
- [ ] **Step 5: Leave the page ready for Emily** without making any keep/delete/separate decision on her behalf.
