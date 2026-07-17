# Phase 3 — Trained separator: single-class yolo11n-seg on ORIGINAL frames

**Goal:** a per-original-frame instance segmenter that separates touching
same-color pieces (the 005145 white-plate merge), integrated behind the
existing table-coordinate fusion. Designed to be re-run unchanged as Emily
adds varied captures — robustness over fitting the current 4 sessions.

**Honesty up front:** with ~4–5 sessions, the by-session holdout is a smoke
test, not proof of generalization. Real validation arrives only with varied
future captures. Everything below is structured so those captures drop in
with zero restructuring.

## Layout (all new code in lego-cv/training/, model use in pipeline/)

```
lego-cv/training/
  extract_frames.py   # sessions -> diverse deduped frames
  autolabel.py        # Grounded SAM (autodistill) -> YOLO-seg autolabels
  make_review_set.py  # prioritized human-correction queue + instructions
  build_dataset.py    # autolabels + corrections -> YOLO dataset, split by session
  splits.yaml         # session -> train/val/holdout (holdout NEVER tuned against)
  colab_train.ipynb   # yolo11n-seg, single class, imgsz 1024, ~100 epochs
  README.md           # the exact re-run steps for new data
  data/               # raw/<session>/, autolabels/<session>/, corrections/<session>/
  dist/               # versioned dataset zips for Colab
```

## Steps

1. **extract_frames.py** — for each session in lego-capture/sessions with
   frames.jsonl: drop blurry frames (Laplacian threshold), dedup by pose
   (keep a frame only if camera moved >5 cm or rotated >10° vs last kept),
   cap ~25/session by uniform thinning. ~965 raw frames -> ~100–120 images.
   Re-runnable: skips already-extracted sessions unless --force.
2. **autolabel.py** — autodistill + Grounded SAM, ontology
   {"lego brick": "lego_piece"} -> YOLO-seg polygons. CPU-only (~40 s/image,
   ~1.5 h for the initial set; unattended). NOT used at inference time —
   training-data bootstrap only, so the documented same-category merge
   failure is exactly what Emily's corrections fix.
3. **make_review_set.py** — renders label overlays and orders the review
   queue: (a) frames where two same-color-family masks touch or come within
   ~2 studs (the entire point of this phase), (b) frames where mask count
   disagrees with the session's known piece count, (c) a random 15% sample.
   Writes REVIEW_INSTRUCTIONS.md: labelme-based (offline, no account),
   polygon-level fix-ups only, expected ~30–60 min.
4. **build_dataset.py** — corrections override autolabels; emits YOLO
   dataset + data.yaml split BY SESSION per splits.yaml:
   train = 212422, 005145, 211643(+210957) · val = 234326 ·
   **holdout = 221544** (never tuned against; reported once at the end).
   005145 must be in train — its touching whites are the target concept.
   Versioned zip to dist/ with checksum.
5. **colab_train.ipynb** — free-GPU notebook: upload zip, ultralytics
   yolo11n-seg, single class, imgsz 1024, epochs 100, early-stop patience;
   exports best.pt + val curves. No MPS anywhere.
6. **Integration (after best.pt returns)** — pipeline/segdetect.py: run the
   model on each selected ORIGINAL frame inside the projected table ROI
   (workspace polygon -> view homography -> original coords); map each
   instance mask back to table/canvas coordinates; feed the existing fusion
   (distance + color/ID compatibility, one observation per source frame per
   instance). Detector mode "seg" with the cv detector kept as fallback.
   Identification path unchanged: Phase 1 original crops (now mask-shaped,
   not quad-guessed) + Phase 2 stud advisory / second-chance.

## Emily's batch (one sitting, in order — flagged clearly)

1. Review/correct labels with labelme (queue + instructions generated;
   priority frames first; ~30–60 min).
2. Run colab_train.ipynb on Colab free GPU (~1–2 h, mostly unattended).
3. Drop best.pt into lego-cv/models/lego_seg.pt and say so — integration
   and the gate run are already wired by then.

## GATE

005145 -> 8/8 with TWO separate white plates AND unchanged correct counts
on 212422/221544/234326. Explicitly necessary-but-not-sufficient: 005145 is
in the training split, and the holdout is one thin session. If whites still
merge: add more corrected touching-same-color examples and retrain — never
fall back to SAM automatic mode at inference.

## Adding new data later (no rework)

capture session -> extract_frames.py (picks it up automatically) ->
autolabel.py -> review queue -> add session to splits.yaml (grow val/
holdout as sessions allow) -> build_dataset.py -> new zip -> retrain ->
replace lego_seg.pt. Documented in training/README.md.
