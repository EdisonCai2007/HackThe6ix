# Source-frame Waypoint Inventory Review Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace unsafe fused-component review with a familiar UI where each numbered item is one waypoint from one untouched source frame, while preserving unambiguous Batch 1 decisions.

**Architecture:** A new run-scoped builder converts the completed original-frame LabelMe bundle into primary-frame review components plus a secondary-frame waypoint pool. Review documents remain compatible with the existing inventory aggregation model, while focused API endpoints promote a secondary waypoint or a manually boxed source-frame region into an independent component. The browser keeps the current two-column layout and uses a modal source-frame picker for missed pieces; it never displays cross-frame alternate thumbnails.

**Tech Stack:** Python 3, OpenCV, NumPy, FastAPI, vanilla JavaScript/CSS, pytest.

## Global Constraints

- Never overwrite `inventory-validation-v2/review.json`, historical session artifacts, or the completed LabelMe bundle.
- Every component must reference exactly one source frame and exactly one crop.
- Do not automatically fuse or attach observations across frames.
- Keep Part ID optional and restrict colors to the 12-color inventory profile.
- Preserve Batch 1 review fields only through an exact, unique reviewed-shape ID match.
- All generated files live beneath a new run-scoped output and a new workspace directory.
- The old workspace remains recoverable and unchanged.

---

### Task 1: Waypoint review document operations

**Files:**
- Modify: `training/inventory_review.py`
- Test: `tests/training/test_inventory_review.py`

**Interfaces:**
- Consumes: schema-1 review documents from `new_review_document()`.
- Produces: `add_waypoint_component(document: dict, waypoint_id: str) -> dict`, `add_manual_waypoint_component(document: dict, component: dict) -> dict`, and reconciliation counts that include promoted components.

- [ ] **Step 1: Write failing tests for promoting one pooled waypoint and rejecting repeats**

```python
def test_add_waypoint_promotes_one_source_frame_candidate_once():
    document = new_review_document("session-a", 2, [_component("primary")])
    document["waypoint_pool"] = [{
        "waypoint_id": "frame-2-shape-1",
        "component": _component("secondary-frame-2-shape-1"),
    }]

    row = add_waypoint_component(document, "frame-2-shape-1")

    assert row["component_id"] == "secondary-frame-2-shape-1"
    assert row["review"]["confirmed"] is False
    with pytest.raises(ValueError, match="already added"):
        add_waypoint_component(document, "frame-2-shape-1")
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `pytest -q tests/training/test_inventory_review.py -k waypoint`

Expected: FAIL because `add_waypoint_component` is not defined.

- [ ] **Step 3: Implement promotion without mutating immutable prediction provenance**

```python
def add_waypoint_component(document: dict, waypoint_id: str) -> dict:
    if document.get("locked"):
        raise ValueError("locked review documents cannot be edited")
    pool_row = next(
        (row for row in document.get("waypoint_pool", [])
         if row.get("waypoint_id") == waypoint_id),
        None,
    )
    if pool_row is None:
        raise KeyError(f"unknown waypoint: {waypoint_id}")
    component = copy.deepcopy(pool_row["component"])
    component_id = component["component_id"]
    if any(row.get("component_id") == component_id
           for row in document.get("components", [])):
        raise ValueError(f"waypoint already added: {waypoint_id}")
    component["review"] = _default_review(component.get("prediction") or {})
    document["components"].append(component)
    document["updated_at"] = _now()
    return component
```

- [ ] **Step 4: Add and test manual component insertion with a unique stable ID**

```python
def add_manual_waypoint_component(document: dict, component: dict) -> dict:
    if document.get("locked"):
        raise ValueError("locked review documents cannot be edited")
    row = copy.deepcopy(component)
    component_id = str(row.get("component_id") or "")
    if not component_id or any(
        item.get("component_id") == component_id
        for item in document.get("components", [])
    ):
        raise ValueError("manual waypoint component ID must be unique")
    row["review"] = _default_review(row.get("prediction") or {})
    row["review"]["segmentation"] = "missed"
    document["components"].append(row)
    document["updated_at"] = _now()
    return row
```

- [ ] **Step 5: Run document tests**

Run: `pytest -q tests/training/test_inventory_review.py`

Expected: all tests pass.

- [ ] **Step 6: Commit the focused document behavior**

```bash
git add training/inventory_review.py tests/training/test_inventory_review.py
git commit -m "feat: add source waypoint review operations"
```

### Task 2: Build a source-frame waypoint workspace

**Files:**
- Create: `training/inventory_waypoint_review.py`
- Create: `tests/training/test_inventory_waypoint_review.py`
- Reuse: `training/inventory_segmentation_import.py`

**Interfaces:**
- Consumes: `load_reviewed_bundle(bundle_path, ...) -> dict[str, ReviewedSession]` and the old `inventory-validation-v2/review.json` for optional migration.
- Produces: `build_waypoint_workspace(bundle_path: Path, workspace_dir: Path, *, require_all_counts: bool = True, run_name: str = "inventory-waypoint-v1") -> Path`.
- Produces review fields `source_frames`, `primary_frame_id`, `waypoint_pool`, and `migration_summary`.

The test module defines a two-frame bundle by calling the existing fixture-writing
pattern with frame 1 containing two polygons and frame 2 containing one polygon:

```python
def waypoint_bundle_fixture(tmp_path):
    bundle = _bundle_fixture(tmp_path)
    bundle_doc = json.loads(bundle.read_text())
    session = bundle_doc["sessions"][0]
    first = Path(bundle.parent / "review" / session["selected_frames"][0]["annotation"])
    first_doc = json.loads(first.read_text())
    first_doc["shapes"].append({
        "label": "lego_piece", "shape_type": "polygon", "group_id": 2,
        "flags": {}, "points": [[2, 2], [7, 2], [7, 7], [2, 7]],
    })
    first.write_text(json.dumps(first_doc))
    source = Path(session["selected_frames"][0]["source_rgb"])
    second_image = bundle.parent / "review" / "002.jpg"
    shutil.copy2(source, second_image)
    second_json = bundle.parent / "review" / "002.json"
    second_doc = {**first_doc, "imagePath": "002.jpg", "shapes": [first_doc["shapes"][0]]}
    second_doc["session"] = {**first_doc["session"], "frame_id": 2}
    second_json.write_text(json.dumps(second_doc))
    session["selected_frames"].append({
        "frame_id": 2, "view_index": 1, "image": "002.jpg",
        "annotation": "002.json", "source_rgb": str(source),
        "source_sha256": session["selected_frames"][0]["source_sha256"],
    })
    manifest_path = Path(session["manifest"])
    manifest = json.loads(manifest_path.read_text())
    manifest["views"].append({**manifest["views"][0], "frame_id": 2})
    manifest_path.write_text(json.dumps(manifest))
    bundle.write_text(json.dumps(bundle_doc))
    return bundle
```

- [ ] **Step 1: Write a fixture with two untouched frames and exact shape IDs**

```python
def test_builder_uses_one_complete_primary_frame_and_single_view_components(tmp_path):
    bundle, old_review = waypoint_bundle_fixture(tmp_path)

    workspace_path = build_waypoint_workspace(
        bundle, tmp_path / "workspace", require_all_counts=False,
    )

    workspace = json.loads(workspace_path.read_text())
    review = json.loads(Path(workspace["sessions"][0]["review_path"]).read_text())
    assert review["primary_frame_id"] == 1
    assert len(review["source_frames"]) == 2
    assert all(len(row["assets"]["views"]) == 1 for row in review["components"])
    assert all(
        row["source_anchor"]["frame_id"] == review["primary_frame_id"]
        for row in review["components"]
    )
```

- [ ] **Step 2: Run the builder test and verify it fails**

Run: `pytest -q tests/training/test_inventory_waypoint_review.py`

Expected: FAIL because `training.inventory_waypoint_review` does not exist.

- [ ] **Step 3: Implement primary-frame selection and stable waypoint records**

```python
def choose_primary_frame(session: ReviewedSession) -> int:
    by_frame = Counter(shape.frame_id for shape in session.shapes)
    if not by_frame:
        raise ValueError(f"session has no reviewed shapes: {session.session_id}")
    return min(
        by_frame,
        key=lambda frame_id: (
            abs(by_frame[frame_id] - session.expected_count),
            -by_frame[frame_id],
            frame_id,
        ),
    )

def waypoint_id(shape: ReviewedShape) -> str:
    return f"{shape.session_id}:frame-{shape.frame_id:05d}:shape-{shape.shape_id}"
```

The primary choice minimizes count disagreement first, then prefers greater coverage and the earlier frame. This chooses frame 0 with 45 shapes for Batch 1 and avoids generated mosaics.

- [ ] **Step 4: Write exact full-frame and crop assets**

```python
def write_shape_assets(shape: ReviewedShape, output_dir: Path) -> dict:
    frame_dir = output_dir / "review-assets" / f"frame-{shape.frame_id:05d}"
    frame_dir.mkdir(parents=True, exist_ok=True)
    frame_path = frame_dir / "source.jpg"
    if not frame_path.exists():
        shutil.copy2(shape.image_path, frame_path)
    x0, y0, x1, y1 = padded_box(shape.box_original, shape.image.shape[1::-1])
    crop_path = frame_dir / f"shape-{shape.shape_id.replace(':', '-')}.jpg"
    if not cv2.imwrite(str(crop_path), shape.image[y0:y1, x0:x1]):
        raise OSError(f"could not write waypoint crop: {crop_path}")
    return {
        "frame": frame_path.relative_to(output_dir).as_posix(),
        "crop": crop_path.relative_to(output_dir).as_posix(),
        "box_original": list(map(int, shape.box_original)),
        "crop_box_original": [x0, y0, x1, y1],
    }

def padded_box(box, image_wh, ratio=0.30):
    x0, y0, x1, y1 = map(int, box)
    width, height = map(int, image_wh)
    pad = max(12, round(max(x1 - x0, y1 - y0) * ratio))
    return (
        max(0, x0 - pad), max(0, y0 - pad),
        min(width, x1 + pad), min(height, y1 + pad),
    )
```

- [ ] **Step 5: Copy predictions and completed Batch 1 reviews only for unique exact shape matches**

```python
def exact_shape_owners(old_document: dict) -> dict[str, dict]:
    owners: dict[str, list[dict]] = defaultdict(list)
    for component in old_document.get("components", []):
        for shape_id in (component.get("association") or {}).get(
            "reviewed_shape_ids", []
        ):
            owners[str(shape_id)].append(component)
    return {
        shape_id: rows[0]
        for shape_id, rows in owners.items()
        if len(rows) == 1
    }
```

For Batch 1 only, copy `review` when the exact owner is unique and confirmed. For every session, copy `prediction` only from the same unique exact owner; otherwise use `part_name="unknown brick"`, an empty part ID, and same-crop color evidence.

- [ ] **Step 6: Assert old artifacts are unchanged and migration is audited**

```python
before = hashlib.sha256(old_review_path.read_bytes()).hexdigest()
workspace_path = build_waypoint_workspace(bundle, output, require_all_counts=False)
after = hashlib.sha256(old_review_path.read_bytes()).hexdigest()
assert before == after
assert migration["migrated_confirmed"] >= 1
assert set(migration) == {
    "eligible_confirmed", "migrated_confirmed", "ambiguous", "not_in_primary"
}
```

- [ ] **Step 7: Run builder tests**

Run: `pytest -q tests/training/test_inventory_waypoint_review.py tests/training/test_inventory_segmentation_import.py`

Expected: all tests pass.

- [ ] **Step 8: Commit the workspace builder**

```bash
git add training/inventory_waypoint_review.py tests/training/test_inventory_waypoint_review.py
git commit -m "feat: build source-frame waypoint workspace"
```

### Task 3: Add missed-waypoint API operations

**Files:**
- Modify: `inventory_review_app.py`
- Modify: `tests/test_inventory_review_app.py`

**Interfaces:**
- Consumes: `add_waypoint_component()` and `add_manual_waypoint_component()` from Task 1.
- Produces: `POST /api/sessions/{session_id}/waypoints/{waypoint_id}` and `POST /api/sessions/{session_id}/manual-waypoints`.

- [ ] **Step 1: Write failing API tests for secondary promotion**

```python
def test_add_secondary_waypoint_creates_independent_component(tmp_path):
    workspace, review_path = _waypoint_workspace(tmp_path)
    client = TestClient(create_app(workspace))

    response = client.post("/api/sessions/s1/waypoints/frame-2-shape-1")

    assert response.status_code == 200
    rows = response.json()["components"]
    assert rows[-1]["source_anchor"]["frame_id"] == 2
    assert len(rows[-1]["assets"]["views"]) == 1
```

- [ ] **Step 2: Run the focused tests and verify they fail**

Run: `pytest -q tests/test_inventory_review_app.py -k waypoint`

Expected: FAIL with HTTP 404 for the absent endpoints.

- [ ] **Step 3: Implement secondary promotion and actionable errors**

```python
@app.post("/api/sessions/{session_id}/waypoints/{waypoint_id}")
def promote_waypoint(session_id: str, waypoint_id: str) -> dict:
    path, document = load_review(session_id)
    try:
        add_waypoint_component(document, waypoint_id)
    except KeyError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    atomic_write_json(path, document)
    return response_document(document)
```

- [ ] **Step 4: Implement manual source-frame box creation with bounded coordinates**

The endpoint validates `frame_id` against `document["source_frames"]`, clips `[x0, y0, x1, y1]` to the recorded source dimensions, rejects boxes smaller than 8×8 pixels, writes a padded crop beneath the current run's `review-assets/manual/`, and inserts an independent unconfirmed component with provenance `human_clicked_missed_piece`.

```python
def create_manual_component(run_dir: Path, document: dict, payload: dict) -> dict:
    frame_id = int(payload.get("frame_id", -1))
    frame = next(
        (row for row in document.get("source_frames", [])
         if int(row["frame_id"]) == frame_id),
        None,
    )
    if frame is None:
        raise ValueError(f"unknown source frame: {frame_id}")
    width, height = map(int, frame["size_wh"])
    values = payload.get("box") or []
    if len(values) != 4:
        raise ValueError("manual waypoint box must contain four coordinates")
    x0, y0, x1, y1 = map(lambda value: int(round(float(value))), values)
    x0, x1 = sorted((max(0, x0), min(width, x1)))
    y0, y1 = sorted((max(0, y0), min(height, y1)))
    if x1 - x0 < 8 or y1 - y0 < 8:
        raise ValueError("manual waypoint box must be at least 8 x 8 pixels")
    image = cv2.imread(str(run_dir / frame["image"]))
    if image is None:
        raise ValueError(f"unreadable source frame asset: {frame['image']}")
    index = sum(
        str(row.get("component_id", "")).startswith("manual-waypoint-")
        for row in document.get("components", [])
    )
    component_id = f"manual-waypoint-{index:03d}"
    asset_dir = run_dir / "review-assets" / "manual"
    asset_dir.mkdir(parents=True, exist_ok=True)
    crop_path = asset_dir / f"{component_id}.jpg"
    if not cv2.imwrite(str(crop_path), image[y0:y1, x0:x1]):
        raise OSError(f"could not write manual crop: {crop_path}")
    return {
        "component_id": component_id,
        "source_anchor": {"frame_id": frame_id, "box_original": [x0, y0, x1, y1]},
        "prediction": {"part_id": None, "part_name": "unknown brick", "color": "", "score": 0.0},
        "candidates": [],
        "assets": {"views": [{"frame_id": frame_id, "crop": crop_path.relative_to(run_dir).as_posix()}]},
        "provenance": {"source": "human_clicked_missed_piece"},
    }
```

```python
@app.post("/api/sessions/{session_id}/manual-waypoints")
def create_manual_waypoint(session_id: str, payload: dict) -> dict:
    path, document = load_review(session_id)
    component = create_manual_component(path.parent, document, payload)
    add_manual_waypoint_component(document, component)
    atomic_write_json(path, document)
    return response_document(document)
```

- [ ] **Step 5: Run API tests**

Run: `pytest -q tests/test_inventory_review_app.py`

Expected: all tests pass.

- [ ] **Step 6: Commit API support**

```bash
git add inventory_review_app.py tests/test_inventory_review_app.py
git commit -m "feat: add missed waypoint review API"
```

### Task 4: Replace cross-frame thumbnails with source-frame waypoint review

**Files:**
- Modify: `inventory_review_web/index.html`
- Modify: `inventory_review_web/app.js`
- Modify: `inventory_review_web/styles.css`
- Modify: `tests/test_inventory_review_app.py`

**Interfaces:**
- Consumes: review-document `primary_frame_id`, `source_frames`, `waypoint_pool`, single-view component assets, and Task 3 endpoints.
- Produces: a full-frame numbered review surface and an Add Missed Piece modal.

- [ ] **Step 1: Add browser contract tests**

```python
def test_browser_uses_one_source_frame_and_has_missed_waypoint_picker(tmp_path):
    workspace, _ = _waypoint_workspace(tmp_path)
    client = TestClient(create_app(workspace))
    index = client.get("/").text
    script = client.get("/app.js").text
    assert 'id="missed-piece-dialog"' in index
    assert 'id="source-frame-select"' in index
    assert "primary_frame_id" in script
    assert "waypoint_pool" in script
    assert "view-thumbnails" not in index
    assert "overview_images" not in script
```

- [ ] **Step 2: Run the browser contract test and verify it fails**

Run: `pytest -q tests/test_inventory_review_app.py -k source_frame`

Expected: FAIL because the current page still renders fused alternate views.

- [ ] **Step 3: Render the exact primary source frame and only matching waypoints**

```javascript
function activeFrame() {
  return state.document.source_frames.find(
    (row) => row.frame_id === state.document.primary_frame_id
  );
}

function renderPrimaryFrame() {
  const frame = activeFrame();
  $("overview").src = asset(frame.image);
  $("shape-buttons").innerHTML = state.document.components
    .filter((row) => row.source_anchor.frame_id === frame.frame_id)
    .map(renderWaypointButton).join("");
}

function renderWaypointButton(row) {
  const frame = activeFrame();
  const [width, height] = frame.size_wh;
  const [x0, y0, x1, y1] = row.source_anchor.box_original;
  const index = state.document.components.indexOf(row);
  return `<button class="shape-button" aria-label="Select piece ${index + 1}"
    data-index="${index}" style="left:${100 * x0 / width}%;top:${100 * y0 / height}%;
    width:${100 * (x1 - x0) / width}%;height:${100 * (y1 - y0) / height}%">
    <span>${String(index).padStart(3, "0")}</span></button>`;
}
```

Use the source image's recorded width and height for percentage positioning. Remove the thumbnail strip and all `viewIndex` behavior. The selected crop always comes from `row.assets.views[0].crop`.

- [ ] **Step 4: Build the missed-piece dialog**

The dialog contains a source-frame selector, one full untouched frame, numbered pooled waypoints for that frame, **Add selected waypoint**, and **Draw missing box**. Already-added waypoints are visibly disabled. Selecting a pooled waypoint shows its exact crop and current proposed type/color before promotion.

```javascript
async function addSelectedWaypoint() {
  state.document = await api(
    `/api/sessions/${encodeURIComponent(state.sessionId)}/waypoints/` +
    encodeURIComponent(state.missedWaypointId),
    { method: "POST" },
  );
  closeMissedDialog();
  state.index = state.document.components.length - 1;
  render();
}
```

- [ ] **Step 5: Keep the familiar confirmation controls and correct counts**

Rename **Delete segmentation** to **Delete detection**. Keep block type, color, optional Part ID, include/exclude, segmentation status, Confirm + next, batch selector, lock, and export. Header text becomes:

```javascript
`Physical ${r.expected} · active ${r.segmentations_active} · ` +
`confirmed ${r.accounted_physical} · excluded ${r.excluded} · ` +
`unresolved ${r.unresolved}`
```

- [ ] **Step 6: Run browser and API tests**

Run: `pytest -q tests/test_inventory_review_app.py`

Expected: all tests pass.

- [ ] **Step 7: Commit the UI replacement**

```bash
git add inventory_review_web/index.html inventory_review_web/app.js inventory_review_web/styles.css tests/test_inventory_review_app.py
git commit -m "feat: review inventory from source-frame waypoints"
```

### Task 5: Generate, switch, and verify the live workspace

**Files:**
- Create: `/Users/emily/lego-capture/inventory-waypoint-validation-20260718/workspace.json` and run-scoped session assets.
- Modify only the local launch configuration that selects `LEGO_INVENTORY_WORKSPACE`; preserve its previous value in the handoff notes.

**Interfaces:**
- Consumes: `/Users/emily/lego-capture/inventory-segmentation-labelme-original-20260718/bundle.json`.
- Produces: the live page at `http://127.0.0.1:8766/` backed by the new workspace.

- [ ] **Step 1: Hash historical review files before generation**

Run:

```bash
find /Users/emily/lego-capture/sessions -path '*/analysis-runs/inventory-validation-v2/review.json' -print0 \
  | sort -z | xargs -0 shasum -a 256 \
  > /tmp/lego-waypoint-historical-before.sha256
```

Expected: 12 review hashes.

- [ ] **Step 2: Generate the new workspace**

Run:

```bash
/Users/emily/lego-cv/.venv/bin/python -m training.inventory_waypoint_review \
  --bundle /Users/emily/lego-capture/inventory-segmentation-labelme-original-20260718/bundle.json \
  --workspace-dir /Users/emily/lego-capture/inventory-waypoint-validation-20260718
```

Expected: 12 sessions and expected physical total 780.

- [ ] **Step 3: Verify historical hashes and workspace invariants**

Run the same hash command into `/tmp/lego-waypoint-historical-after.sha256`, then run:

```bash
diff -u /tmp/lego-waypoint-historical-before.sha256 /tmp/lego-waypoint-historical-after.sha256
/Users/emily/lego-cv/.venv/bin/python -m pytest -q
```

Expected: empty diff and the full test suite passes.

- [ ] **Step 4: Switch and restart the local review service**

Update the service environment to point at
`/Users/emily/lego-capture/inventory-waypoint-validation-20260718/workspace.json`, restart only `com.emily.lego-inventory-review-8766`, and verify:

```bash
curl -fsS http://127.0.0.1:8766/api/workspace
```

Expected: 12 source-frame waypoint sessions.

- [ ] **Step 5: Perform concrete Batch 1 and Batch 2 checks**

Verify via API and browser:

- Batch 1 primary frame is original frame 0 at 1440×1920 and begins with 45 source-frame waypoints before explicit additions/deletions.
- The Batch 1 migration report states exactly how many of the 49 completed reviews migrated, were ambiguous, or were not present in the primary frame.
- Batch 2 components each contain one view and one source frame.
- No Batch 2 component contains both reviewed shape IDs `00002:086` and `00200:016`.
- The selected crop and numbered waypoint always come from the same frame.

- [ ] **Step 6: Record the generated paths and validation result**

Append a concise checkpoint to `/Users/emily/lego-capture/PROGRESS.md` with the new workspace path, migration counts, test result, and the fact that historical `inventory-validation-v2` hashes were unchanged.

- [ ] **Step 7: Commit the generation entry point and progress checkpoint**

```bash
git -C /Users/emily/lego-cv add training/inventory_waypoint_review.py
git -C /Users/emily/lego-cv commit -m "chore: finalize waypoint review workflow"
```

Do not add generated session assets to either repository.
