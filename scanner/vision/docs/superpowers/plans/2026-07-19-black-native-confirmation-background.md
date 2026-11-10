# Black Native Confirmation Background Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Change only the native OpenCV confirmation canvas background to pure black.

**Architecture:** Preserve the existing renderer and replace its initial canvas fill color with BGR `(0, 0, 0)`. Protect the scope with a focused render assertion that samples an untouched outer-canvas pixel.

**Tech Stack:** Python 3.11, OpenCV, NumPy, pytest

## Global Constraints

- Change only the initial canvas fill in `opencv_confirmation.py`.
- Preserve the camera image, yellow segmentation tint, confirmation card, mascot, text, buttons, layout, keyboard and mouse behavior, inventory constraints, persistence, and handoff behavior.
- Do not modify the browser confirmation UI or any capture and CV pipeline logic.

---

### Task 1: Make the Native Canvas Pure Black

**Files:**
- Modify: `/Users/emily/lego-cv/opencv_confirmation.py`
- Modify: `/Users/emily/lego-cv/tests/test_opencv_confirmation.py`

**Interfaces:**
- Consumes: `ConfirmationController.render() -> numpy.ndarray`
- Produces: the same 1280 by 720 BGR canvas with pure-black untouched background pixels

- [x] **Step 1: Write the failing rendering assertion**

Extend `test_render_draws_yellow_mask_card_and_clickable_buttons` after the existing shape assertion:

```python
assert rendered[0, 0].tolist() == [0, 0, 0]
```

- [x] **Step 2: Run the focused test and verify it fails**

Run:

```bash
.venv/bin/pytest tests/test_opencv_confirmation.py::test_render_draws_yellow_mask_card_and_clickable_buttons -q
```

Expected: one failure showing the current outer-canvas BGR value instead of `[0, 0, 0]`.

- [x] **Step 3: Change only the initial canvas fill**

In `ConfirmationController.render`, replace:

```python
canvas = np.full((height, width, 3), (38, 49, 59), dtype=np.uint8)
```

with:

```python
canvas = np.full((height, width, 3), (0, 0, 0), dtype=np.uint8)
```

- [x] **Step 4: Run focused and full native confirmation tests**

Run:

```bash
.venv/bin/pytest tests/test_opencv_confirmation.py -q
```

Expected: all tests pass.

- [x] **Step 5: Verify the scope and commit**

Run:

```bash
git diff --check
git diff -- opencv_confirmation.py tests/test_opencv_confirmation.py
```

Expected: the diff contains only the black background assertion and the one-line canvas fill change.

Commit:

```bash
git add opencv_confirmation.py tests/test_opencv_confirmation.py docs/superpowers/plans/2026-07-19-black-native-confirmation-background.md
git commit -m "style: use black native confirmation background"
```
