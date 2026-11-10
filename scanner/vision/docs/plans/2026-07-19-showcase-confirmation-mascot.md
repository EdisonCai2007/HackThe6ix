# Showcase Confirmation Mascot Implementation Plan

**Goal:** Make the showcase confirmation screen remove the annotation header and place a softly glowing yellow waving brick-minifigure image beneath the confirmation card.

**Architecture:** Keep the existing full annotation workspace unchanged. When a loaded review document has `showcase_only: true`, JavaScript adds a body mode class; CSS uses that class to remove the header, expand the image stage, and reveal a static SVG mascot positioned beneath the confirmation card.

**Tech Stack:** Static HTML/CSS/JavaScript, FastAPI `FileResponse`, SVG, pytest/Starlette `TestClient`

## Global Constraints

- The entire annotation header is hidden only for `showcase_only` documents.
- Normal inventory review documents retain the full header and existing tools.
- The mascot is an image asset, contains no text or logo, and appears only in showcase mode.
- The mascot sits beneath the confirmation card and uses the established yellow glow theme.

---

### Task 1: Showcase-only header and confirmation mascot

**Files:**
- Create: `inventory_review_web/confirmation-mascot.svg`
- Modify: `inventory_review_web/index.html`
- Modify: `inventory_review_web/app.js`
- Modify: `inventory_review_web/styles.css`
- Modify: `inventory_review_app.py`
- Test: `tests/test_inventory_review_app.py`

**Interfaces:**
- Consumes: review JSON field `showcase_only: bool`
- Produces: body class `showcase-mode`, `GET /confirmation-mascot.svg`, and image element `#confirmation-mascot`

- [x] **Step 1: Write the failing browser contract test**

```python
def test_showcase_browser_hides_annotation_header_and_serves_mascot(tmp_path):
    workspace, _ = _workspace(tmp_path)
    client = TestClient(create_app(workspace))
    index = client.get("/").text
    script = client.get("/app.js").text
    styles = client.get("/styles.css").text
    mascot = client.get("/confirmation-mascot.svg")
    assert 'id="confirmation-mascot"' in index
    assert 'classList.toggle("showcase-mode"' in script
    assert "body.showcase-mode > header" in styles
    assert "body.showcase-mode #confirmation-mascot" in styles
    assert mascot.status_code == 200
    assert mascot.headers["content-type"].startswith("image/svg+xml")
```

- [x] **Step 2: Run the focused test and verify it fails for the missing mascot contract**

Run: `.venv/bin/pytest tests/test_inventory_review_app.py::test_showcase_browser_hides_annotation_header_and_serves_mascot -q`

Expected: `FAIL` because the new image, showcase class, styles, and route do not exist yet.

- [x] **Step 3: Implement the minimal showcase UI behavior**

Add `#confirmation-mascot` to the callout, toggle `showcase-mode` from `state.document.showcase_only`, hide the top-level header and reveal/position the image only in that mode, serve the SVG through FastAPI, and bump the static asset cache versions.

- [x] **Step 4: Run the focused and full UI tests**

Run: `.venv/bin/pytest tests/test_inventory_review_app.py -q`

Expected: all tests pass.

- [x] **Step 5: Run JavaScript syntax and browser visual checks**

Run: `node --check inventory_review_web/app.js`

Expected: exit code `0`. Then load a showcase workspace and confirm the header is absent, the mascot sits below the card without covering the segmentation, and Yes/No/correction remain usable.
