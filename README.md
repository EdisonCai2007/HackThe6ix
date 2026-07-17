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
.venv/bin/python -m pytest                    # 72 tests, no network needed
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

API endpoints:

| Endpoint | Purpose |
|---|---|
| `POST /scan` (multipart `file`) | one photo → inventory JSON |
| `POST /sessions` | start an accumulating session |
| `POST /sessions/{id}/scan` | add a photo; returns accumulated inventory |
| `GET /sessions/{id}/inventory` | current accumulated inventory |

Sessions let the app scan a big bucket in small batches; quantities merge
across photos. Responses include a `warning` when touching-piece clusters
were skipped.

## Pipeline

1. **DETECT** ([pipeline/detect.py](pipeline/detect.py)) — find pieces, crop
   each with 10% padding.
   - `yolo`: ultralytics model from `models/lego_yolo.pt` (train with
     [scripts/train_yolo.py](scripts/train_yolo.py); no usable pretrained
     public weights existed as of 2026-07).
   - `cv` fallback: foreground = pixels differing from a local background
     estimate; needs a plain background. Blobs much larger than the median
     piece are flagged as *clusters* (touching pieces it can't split) and
     excluded from the count rather than miscounted. A conservative
     post-filter also removes boxes spanning most of the image, plus very
     large isolated outliers when a clear main piece group exists; normal-size
     isolated pieces are kept.
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

- **Single layer, pieces not touching** — touching pieces merge into one
  "cluster" box the cv detector skips (the debug overlay marks them orange).
- Plain, light, uncluttered background; a white/gray table doubles as the
  white reference for color correction.
- Top-down, fill the frame, keep clutter away from the edges.
- Even, bright light; avoid harsh shadows and glare.

## Training the YOLO detector

```bash
.venv/bin/pip install roboflow
.venv/bin/python scripts/train_yolo.py \
    --roboflow-key YOUR_KEY \
    --roboflow-project workspace/project/version \
    --device mps        # Apple Silicon; "cpu" works but is slow
```

Installs `models/lego_yolo.pt`; `--detector auto` then prefers it. YOLO
handles touching pieces far better than the cv fallback.
