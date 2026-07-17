# Option A: Clean Top-down and Color-aware Detection Implementation Plan

> **For Codex:** Execute this plan task-by-task with test-driven development and verify both recorded sessions before completion.

**Goal:** Detect each visible LEGO piece once—including the large gray plate—without treating stitched-frame seams or nearby differently colored pieces as background objects or one rescan cluster.

**Architecture:** `lego-capture` will export a clean, median-filled best-frame rectification as the default detector input while retaining the orthographic composite as an explicit diagnostic mode. `lego-cv` will form foreground connected components, create conservative color-interior markers, and use marker-controlled watershed to split only components with multiple credible piece seeds. Large and border-touching components remain valid detections; the legacy user-facing cluster/rescan path is retired while its response field remains empty for compatibility.

**Tech Stack:** Python, OpenCV, NumPy, scikit-image, pytest.

---

## Task 1: Make the clean best frame the default detector input

**Files:**
- Modify: `/Users/emily/lego-capture/topdown.py`
- Test: `/Users/emily/lego-capture/tests/test_topdown.py`
- Modify: `/Users/emily/lego-capture/README.md`

1. Add a failing test proving `export_topdown()` defaults to `best-frame`.
2. Add a failing unit test proving invalid rectification pixels are filled with the median valid table color rather than black.
3. Run the focused tests and confirm the expected failures.
4. Change the Python and CLI defaults to `best-frame`; add a small invalid-pixel fill helper and use it in that path.
5. Document `--mode ortho` as the optional stitched diagnostic output.
6. Run the focused and full capture tests.
7. Regenerate detector inputs for sessions `20260716-221544` and `20260716-212422`.
8. Commit the capture changes.

## Task 2: Add conservative color-aware instance splitting

**Files:**
- Create: `/Users/emily/lego-cv/pipeline/instance_split.py`
- Modify: `/Users/emily/lego-cv/pipeline/detect.py`
- Create: `/Users/emily/lego-cv/tests/test_instance_split.py`
- Modify: `/Users/emily/lego-cv/tests/test_detect.py`

1. Add failing synthetic tests for three differently colored pieces joined into one foreground component, two same-color pieces joined by an unconfident bridge, and one long orange piece that must remain whole.
2. Add failing detector tests proving a large gray border-touching piece is retained and oversized valid pieces are not converted into rescan clusters.
3. Run the focused tests and confirm the expected failures.
4. Implement palette-assisted seed extraction from eroded component interiors, consolidating nearby color variants into one spatial marker per credible piece.
5. Apply marker-controlled watershed only when at least two credible markers survive; otherwise return the original component unchanged.
6. Refactor OpenCV detection to split foreground components with this helper, remove border rejection and size-based cluster conversion, and keep `clusters=[]` for API compatibility.
7. Run focused and full CV tests.

## Task 3: Real-session acceptance and handoff

**Files:**
- Verify: `/Users/emily/lego-capture/sessions/20260716-221544/topdown.jpg`
- Verify: `/Users/emily/lego-capture/sessions/20260716-212422/topdown.jpg`
- Update if generated: each session's `inventory.json` and `debug.jpg`
- Modify: `/Users/emily/lego-cv/README.md`

1. On `20260716-221544`, require eight piece detections, including the large gray piece, separately detected central red/yellow/white pieces, zero seam boxes, and zero rescan clusters.
2. On `20260716-212422`, require seven piece detections with no background objects and zero rescan clusters.
3. Tune only conservative marker thresholds needed to meet both recorded-session requirements; add a regression test for every discovered failure mode before changing code.
4. Update documentation with the new detector behavior and explain that YOLO instance segmentation remains Task B.
5. Run both repositories' full test suites and inspect rendered debug images.
6. Commit the CV changes and provide the exact live-test command sequence.
