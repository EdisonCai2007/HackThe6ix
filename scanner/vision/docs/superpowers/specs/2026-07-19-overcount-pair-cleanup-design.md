# Overcount Pair Cleanup Design

## Goal

Let Emily reconcile only the suspected duplicate annotations in the two over-counted batches without re-reviewing the full inventory or automatically deleting any confirmed record.

## Scope

- Generate same-frame overlap candidates from confirmed, included components.
- Use the already validated thresholds: box IoU at least `0.20` or smaller-box containment at least `0.55`.
- Show the full source frame with only the current A/B pair highlighted.
- Show each record's entered block type and color. Part ID is informational and never drives the decision.
- Provide exactly three decisions: `Keep A`, `Keep B`, and `These are separate pieces`.
- Persist every decision in the session's existing run-scoped `review.json`.
- For a keep decision, mark only the non-kept record as a duplicate and preserve its former review in the cleanup audit trail.
- For a separate decision, preserve both records and exclude that pair from the remaining candidate queue.
- Display live confirmed count, expected count, and remaining overcount.
- Do not touch historical source images, segmentation assets, part/color labels, unrelated sessions, or inventory inference code.

## Data and API

`training.inventory_review.overlap_candidates(document)` returns stable, sorted candidate records containing pair key, frame ID, component IDs, box overlap metrics, and the current entered labels.

`training.inventory_review.apply_overlap_decision(document, component_a, component_b, action)` validates the live candidate and appends an audit record beneath `document["overlap_cleanup"]["decisions"]`. `keep_a` marks B duplicate, `keep_b` marks A duplicate, and `separate` changes neither component.

The FastAPI service exposes:

- `GET /api/sessions/{session_id}/overlap-candidates`
- `POST /api/sessions/{session_id}/overlap-decisions`

Mutations continue to use the existing atomic JSON writer and return refreshed reconciliation and candidates.

## UI

The existing page gains a `Review possible extras` button. Its modal uses the current session and shows one pair at a time:

- left: complete source frame with A and B boxes and labels;
- right: A and B type/color cards, overlap strength, live count, and the three decisions;
- after a decision: refresh from disk-backed API state and advance to the next remaining pair;
- when the count equals the expected count: show a reconciled state and stop suggesting deletions.

No decision is made on page load. No automatic duplicate suppression runs.

## Acceptance Criteria

- The current data produces 10 candidates for `20260718-161851` and 1 for `20260718-163723` before cleanup decisions.
- The user can retain either label when two boxes cover the same physical area.
- `These are separate pieces` survives refresh and never changes inventory counts.
- Each keep decision decreases the confirmed physical count by exactly one.
- The source `review.json` records the decision and prior removed review.
- Existing annotation and missed-piece workflows continue to pass their tests.
