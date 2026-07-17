# lego-cv

Photograph a pile of spread-out LEGO pieces → get a structured parts
inventory as JSON.

```json
[{"part_id": "3001", "name": "Brick 2 x 4", "color": "red", "color_id": 4, "quantity": 7}]
```

## Setup

```bash
python3.11 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/python scripts/download_colors.py   # refresh data/colors.csv (optional)
.venv/bin/python -m pytest                    # no network needed
```

## Usage

```bash
# CLI: scan one photo
.venv/bin/python cli.py photo.jpg -o inventory.json --debug
# --debug writes debug.jpg with labeled boxes: "{name} | {color} | {score}"
# --detector auto|yolo|cv (auto = yolo if models/lego_yolo.pt exists, else cv)

# API server
.venv/bin/uvicorn api:app --reload
```

For a moving-camera Record3D session, use the multi-view path so inventory
does not depend on one camera frame or on detecting a stitched image:

```bash
cd /Users/emily/lego-capture
.venv/bin/python multiview.py sessions/<timestamp>

cd /Users/emily/lego-cv
.venv/bin/python session_cli.py \
  /Users/emily/lego-capture/sessions/<timestamp> --detector cv
```

This detects at most five complementary clean rectifications, fuses duplicate
observations in table coordinates, identifies the best complete crop once, and
writes `inventory.json`, `topdown.jpg`, `debug.jpg`, and
`multiview_result.json` to the capture session. The mosaic is a visualization;
inventory is never redetected from its blended pixels.

API endpoints:

| Endpoint | Purpose |
|---|---|
| `POST /scan` (multipart `file`) | one photo → inventory JSON |
| `POST /sessions` | start an accumulating session |
| `POST /sessions/{id}/scan` | add a photo; returns accumulated inventory |
| `GET /sessions/{id}/inventory` | current accumulated inventory |

Sessions let the app scan a big bucket in small batches; quantities merge
across photos. The legacy `clusters` and `warning` response fields remain for
client compatibility but are empty/`null` in the color-aware CV path.

## Pipeline

1. **DETECT** ([pipeline/detect.py](pipeline/detect.py)) — find pieces, crop
   each with 10% padding.
   - `yolo`: ultralytics model from `models/lego_yolo.pt` (train with
     [scripts/train_yolo.py](scripts/train_yolo.py); no usable pretrained
     public weights existed as of 2026-07).
   - `cv` fallback (the current active detector when no model weights are
     installed): foreground = pixels differing from a local background
     estimate; needs a plain background. Palette-aware interior markers and
     watershed split nearby pieces, including same-color pieces joined only by
     weak shadows. Large and border-touching LEGO pieces remain valid; only
     shallow crop-edge slivers are discarded.
2. **IDENTIFY** ([pipeline/identify.py](pipeline/identify.py)) — each crop is
   POSTed to the free [Brickognize](https://api.brickognize.com/) API
   (4 workers behind a global ~1 req/s throttle, retry with backoff).
   Results with score < 0.7 become `"unknown brick"`; so does everything
   when the API is down (the pipeline never crashes on network failure).
   Responses are cached in `.cache/` by SHA1 of the crop, so re-runs are free.
3. **COLOR** ([pipeline/color.py](pipeline/color.py)) — median of the crop's
   central ~5% pixels (glare/shadow dropped), white-patch normalized against
   the table color when the table is near-neutral, then CIEDE2000-matched in
   Lab space against a curated 24-color base palette (red, dark red, orange,
   yellow, beige, tan, ..., black). `color_id` is the nearest representative
   Rebrickable color id. Finish variants (trans/pearl/chrome) report as
   their base color — a center-pixel sample can't see finish.

Grouping by `(part_id, color)` → [pipeline/inventory.py](pipeline/inventory.py).

Every stage runs standalone for debugging:

```bash
.venv/bin/python -m pipeline.detect photo.jpg --detector cv   # boxes + detect_debug.jpg
.venv/bin/python -m pipeline.identify crop.jpg                # one Brickognize lookup
.venv/bin/python -m pipeline.color crop.jpg                   # dominant color match
.venv/bin/python scripts/live_identify_check.py photo.jpg     # raw API response
```

## Taking good photos

- Single layer. Small gaps are helpful, but nearby pieces no longer need to be
  manually separated and re-scanned; color and spatial interiors split them.
- Plain, light, uncluttered background; a white/gray table doubles as the
  white reference for color correction.
- Top-down, fill the frame, keep clutter away from the edges.
- Even, bright light; avoid harsh shadows and glare.

## Legacy YOLO box-detector training

```bash
.venv/bin/pip install roboflow
.venv/bin/python scripts/train_yolo.py \
    --roboflow-key YOUR_KEY \
    --roboflow-project workspace/project/version \
    --device mps        # Apple Silicon; "cpu" works but is slow
```

Installs `models/lego_yolo.pt`; `--detector auto` then prefers it. This script
trains bounding boxes, not masks. The planned Task B upgrade is a single-class
YOLO **instance-segmentation** dataset/model, with session-level train/validation
splits and tiled or multi-view inference for larger batches; that work should
start only after the live Option A test.
