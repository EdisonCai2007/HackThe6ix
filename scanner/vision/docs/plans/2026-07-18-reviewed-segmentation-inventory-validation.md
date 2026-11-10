# Reviewed-Segmentation Inventory Validation Implementation Plan

**Goal:** Convert immutable reviewed LabelMe masks into a count-gated color and brick-type confirmation workspace.

**Architecture:** A dedicated importer validates and projects reviewed polygons, assigns them one-to-one to existing prediction anchors per frame, and emits new review documents with corrected crops and explicit residual-conflict provenance. The existing FastAPI reviewer supplies confirmation, exclusion, locking, and final export.

**Tech Stack:** Python 3.11, OpenCV, NumPy, FastAPI, LabelMe JSON, pytest.

## Global Constraints

- Never edit the completed LabelMe images or JSON files.
- Never overwrite historical session artifacts or existing review documents.
- Make no Brickognize API calls during import.
- Preserve the twelve approved session counts totaling exactly 780.
- Never silently delete unmatched anchors, reviewed polygons, or overlap conflicts.

---

### Task 1: Immutable bundle validation and projection

**Files:**
- Create: `training/inventory_segmentation_import.py`
- Create: `tests/training/test_inventory_segmentation_import.py`

**Interfaces:**
- Consumes: `bundle.json`, paired LabelMe JSON/JPEG files, and session manifests.
- Produces: `load_reviewed_shapes(bundle_path: Path) -> dict[str, ReviewedSession]`.

- [ ] Write failing tests proving unchecked files, changed hashes, invalid polygons, and wrong count contracts are rejected.
- [ ] Run `.venv/bin/pytest -q tests/training/test_inventory_segmentation_import.py` and confirm failure because the importer is absent.
- [ ] Implement validation plus original-mask creation and homography projection with `pipeline.segdetect.map_instance`.
- [ ] Re-run the focused tests and require them to pass.

### Task 2: One-to-one anchor association and residual preservation

**Files:**
- Modify: `training/inventory_segmentation_import.py`
- Modify: `tests/training/test_inventory_segmentation_import.py`

**Interfaces:**
- Consumes: production anchor boxes and reviewed projected observations grouped by frame.
- Produces: `associate_reviewed_shapes(anchor_boxes, observations) -> AssociationResult`.

- [ ] Write failing tests proving one anchor receives at most one polygon per frame, one polygon maps to at most one anchor, and unmatched items remain present.
- [ ] Implement deterministic geometric edge scoring and greedy one-to-one assignment per frame.
- [ ] Add residual nested-overlap detection that records both shape IDs without deleting either.
- [ ] Run the focused tests and require them to pass.

### Task 3: Run-scoped confirmation workspace generation

**Files:**
- Modify: `training/inventory_segmentation_import.py`
- Modify: `training/inventory_review.py`
- Modify: `inventory_review_web/index.html`
- Modify: `inventory_review_web/app.js`
- Modify: `inventory_review_web/styles.css`
- Modify: `tests/training/test_inventory_segmentation_import.py`
- Modify: `tests/training/test_inventory_review.py`

**Interfaces:**
- Consumes: reviewed sessions, existing `inventory-annotation-v1/review.json` prediction anchors, and their cached assets.
- Produces: twelve `inventory-validation-v2/review.json` documents plus a new `workspace.json`.

- [ ] Write failing tests proving production predictions are preserved, human-mask crops replace proposal crops, and conflict flags appear in the review document.
- [ ] Generate assets and review documents without network calls or source mutation.
- [ ] Surface association/conflict provenance in the existing inspector and prioritize unresolved segmentation conflicts.
- [ ] Run focused importer, review-model, and app tests and require them to pass.

### Task 4: Real-data gate and launch

**Files:**
- Create: `/Users/emily/lego-capture/inventory-validation-20260718/workspace.json`
- Create: twelve run-scoped `analysis-runs/inventory-validation-v2` directories.

**Interfaces:**
- Consumes: the completed original-frame LabelMe bundle.
- Produces: the live color/type validation workspace and audit report.

- [ ] Import all twelve sessions and write association/count/conflict diagnostics.
- [ ] Verify the workspace expected total is 780 and every source LabelMe hash remains unchanged.
- [ ] Run `.venv/bin/pytest -q` and require zero failures.
- [ ] Launch the reviewer on the new workspace and open it for Emily.
