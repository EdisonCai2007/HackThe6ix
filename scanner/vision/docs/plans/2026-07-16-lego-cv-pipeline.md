# LEGO CV Inventory Pipeline Implementation Plan

**Goal:** Photograph a pile of spread-out LEGO pieces and emit a structured parts inventory (`inventory.json`) plus a labeled `debug.jpg`.

**Architecture:** 3-stage pipeline — DETECT (YOLO or OpenCV-contour fallback finds pieces, crops each with 10% padding), IDENTIFY (each crop POSTed to the free Brickognize API, cached by SHA1, throttled ~1 req/s with a 4-worker pool), COLOR (median of central pixels → Lab → nearest Rebrickable color via CIEDE2000). Results grouped by `(part_id, color)` into an inventory; exposed via CLI and a FastAPI app with multi-photo session merging.

**Tech Stack:** Python 3.11 (`/opt/homebrew/bin/python3.11`, venv + requirements.txt — uv not installed), ultralytics (YOLO, CPU), opencv-python, scikit-image (`deltaE_ciede2000` — NOT colormath, which is unmaintained and broken on modern numpy), requests, FastAPI + uvicorn, pytest.

## Global Constraints

- Python 3.11; everything must run on CPU (no GPU assumptions at inference).
- Brickognize: `POST https://api.brickognize.com/predict/`, multipart field `query_image`, no auth. Take `items[0]` (fields: `id`, `name`, `category`, `type`, `score`). Discard `score < 0.7`.
- Throttle Brickognize to ~1 req/sec globally; concurrency pool of 4 workers; retry with exponential backoff; cache responses in `.cache/` keyed by SHA1 of crop bytes.
- If Brickognize is unreachable, degrade to `{"part_id": null, "name": "unknown brick", ...}` — never crash.
- Color matching against Rebrickable `colors.csv` (columns: `id,name,rgb,is_trans`), CIEDE2000 in Lab space.
- Every pipeline module independently runnable: `python -m pipeline.detect photo.jpg` etc.
- Crop padding: ~10% of box size. Central ~5% of pixels sampled for color; drop very dark/bright pixels; median.
- Inventory entry shape: `{"part_id": "3001", "name": "Brick 2 x 4", "color": "Red", "color_id": 4, "quantity": 7}`.
- CLI contract: `python cli.py photo.jpg -o inventory.json --debug`.
- Long YOLO training runs require explicit user approval before starting.

## File Structure

```
lego-cv/
  requirements.txt
  README.md
  scripts/download_colors.py     # fetch Rebrickable colors.csv -> data/colors.csv
  scripts/train_yolo.py          # Phase 3 training script (written, not auto-run)
  scripts/live_identify_check.py # Phase 2 one-shot real-API smoke test
  pipeline/__init__.py
  pipeline/detect.py             # boxes: YOLO + cv-contour fallback, cropping
  pipeline/identify.py           # Brickognize client: cache, throttle, retry, pool
  pipeline/color.py              # median center color -> nearest Rebrickable color
  pipeline/inventory.py          # grouping, merging, debug overlay drawing
  cli.py
  api.py
  tests/conftest.py              # synthetic fixture images
  tests/test_color.py
  tests/test_identify.py
  tests/test_detect.py
  tests/test_inventory.py
  tests/test_api.py
  models/                        # yolo weights (gitignored, .gitkeep)
  data/colors.csv                # downloaded (small fallback subset committed)
  .cache/                        # gitignored
```

### Interfaces (shared across all tasks)

```python
# pipeline/detect.py
def detect_pieces(img: np.ndarray, method: str = "auto") -> list[tuple[int, int, int, int]]
    # method: "auto" | "yolo" | "cv"; boxes are (x1, y1, x2, y2) in pixels
def crop_box(img: np.ndarray, box: tuple[int, int, int, int], pad: float = 0.10) -> np.ndarray

# pipeline/identify.py
@dataclass
class Identification:
    part_id: str | None; name: str; category: str | None; score: float
def identify_crop(crop_bgr: np.ndarray, *, session=None, cache_dir=Path(".cache")) -> Identification
def identify_all(crops: list[np.ndarray], *, workers: int = 4, min_interval: float = 1.0) -> list[Identification]

# pipeline/color.py
@dataclass
class LegoColor:
    id: int; name: str; rgb: tuple[int, int, int]
def load_colors(csv_path: Path = Path("data/colors.csv")) -> list[LegoColor]
def dominant_rgb(crop_bgr: np.ndarray) -> tuple[int, int, int]
def match_color(rgb: tuple[int, int, int], colors: list[LegoColor]) -> LegoColor

# pipeline/inventory.py
def build_inventory(items: list[tuple[Identification, LegoColor]]) -> list[dict]
def merge_inventories(*inventories: list[dict]) -> list[dict]
def draw_debug(img: np.ndarray, boxes, labels: list[str]) -> np.ndarray
```

---

## Phase 1 — Scaffolding, colors.csv, color.py

### Task 1: Project scaffolding

**Files:** Create `requirements.txt`, `pipeline/__init__.py`, `tests/__init__.py`, `.gitignore`, `models/.gitkeep`; `git init`.

- [ ] **Step 1:** `git init`; write `.gitignore` (`.venv/`, `.cache/`, `models/*.pt`, `__pycache__/`, `*.egg-info`, `debug.jpg`, `inventory.json`)
- [ ] **Step 2:** Write `requirements.txt`:

```
ultralytics>=8.2
opencv-python>=4.9
numpy>=1.26
scikit-image>=0.22
requests>=2.31
fastapi>=0.110
uvicorn[standard]>=0.29
python-multipart>=0.0.9
httpx>=0.27
pytest>=8.0
```

- [ ] **Step 3:** `python3.11 -m venv .venv && .venv/bin/pip install -r requirements.txt` (ultralytics pulls CPU torch — slow but one-time)
- [ ] **Step 4:** Verify: `.venv/bin/python -c "import cv2, skimage, ultralytics, fastapi"` → no error
- [ ] **Step 5:** Commit `chore: scaffold lego-cv project`

### Task 2: colors.csv download script

**Files:** Create `scripts/download_colors.py`, `data/colors.csv`.

**Produces:** `data/colors.csv` with header `id,name,rgb,is_trans`.

- [ ] **Step 1:** Write `scripts/download_colors.py`: try `https://cdn.rebrickable.com/media/downloads/colors.csv.gz` (gzip), decompress to `data/colors.csv`. On failure, write an embedded fallback subset (~25 common colors incl. `4,Red,C91A09,f`, `0,Black,05131D,f`, `15,White,FFFFFF,f`, `14,Yellow,F2CD37,f`, `23,Blue,0055BF,f`, `2,Green,237841,f`, `71,Light Bluish Gray,A0A5A9,f`, `72,Dark Bluish Gray,6C6E68,f`, `19,Tan,E4CD9E,f`, `70,Reddish Brown,582A12,f`, `25,Orange,FE8A18,f`, `27,Lime,BBE90B,f`, `1,Blue... etc`) so the pipeline never hard-depends on the network.
- [ ] **Step 2:** Run it; verify `data/colors.csv` exists, has >100 rows (or fallback ~25), header contains `id,name,rgb`.
- [ ] **Step 3:** Commit `feat: colors.csv download script with offline fallback`

### Task 3: color.py (TDD)

**Files:** Create `pipeline/color.py`, `tests/test_color.py`, `tests/conftest.py`.

- [ ] **Step 1:** Write failing tests:

```python
# tests/conftest.py
import numpy as np, pytest

@pytest.fixture
def solid_crop():
    def make(bgr, size=64):
        return np.full((size, size, 3), bgr, dtype=np.uint8)
    return make

# tests/test_color.py
from pathlib import Path
from pipeline.color import load_colors, dominant_rgb, match_color

COLORS = load_colors(Path("data/colors.csv"))

def test_pure_red_matches_red(solid_crop):
    crop = solid_crop((9, 26, 201))            # BGR of Rebrickable Red C91A09
    rgb = dominant_rgb(crop)
    assert match_color(rgb, COLORS).name == "Red"

def test_dominant_rgb_ignores_glare_and_shadow(solid_crop):
    crop = solid_crop((9, 26, 201), size=100)
    crop[:10, :] = 255                          # glare band
    crop[-10:, :] = 0                           # shadow band
    r, g, b = dominant_rgb(crop)
    assert (r, g, b) == (201, 26, 9)            # median unaffected

def test_match_color_returns_id():
    red = match_color((201, 26, 9), COLORS)
    assert red.id == 4

def test_unknown_color_excluded():
    assert all(c.id != -1 for c in COLORS)
```

- [ ] **Step 2:** Run `pytest tests/test_color.py -v` → FAIL (module missing)
- [ ] **Step 3:** Implement `pipeline/color.py`:

```python
from __future__ import annotations
import csv
from dataclasses import dataclass
from pathlib import Path
import numpy as np
from skimage.color import rgb2lab, deltaE_ciede2000

@dataclass(frozen=True)
class LegoColor:
    id: int
    name: str
    rgb: tuple[int, int, int]

def load_colors(csv_path: Path = Path("data/colors.csv")) -> list[LegoColor]:
    colors = []
    with open(csv_path, newline="") as f:
        for row in csv.DictReader(f):
            cid = int(row["id"])
            if cid == -1:                       # "[Unknown]"
                continue
            h = row["rgb"].lstrip("#")
            colors.append(LegoColor(cid, row["name"],
                          (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16))))
    return colors

def dominant_rgb(crop_bgr: np.ndarray) -> tuple[int, int, int]:
    h, w = crop_bgr.shape[:2]
    side = max(2, int((0.05 ** 0.5) * min(h, w)))   # central ~5% of pixels
    cy, cx = h // 2, w // 2
    center = crop_bgr[cy - side // 2: cy + side // 2 + 1,
                      cx - side // 2: cx + side // 2 + 1]
    px = center.reshape(-1, 3).astype(np.int32)
    lum = px.mean(axis=1)
    keep = px[(lum > 25) & (lum < 235)]             # drop shadow / glare
    if len(keep) == 0:
        keep = px
    b, g, r = np.median(keep, axis=0).astype(int)
    return int(r), int(g), int(b)

_lab_cache: dict[int, np.ndarray] = {}

def match_color(rgb: tuple[int, int, int], colors: list[LegoColor]) -> LegoColor:
    key = id(colors)
    if key not in _lab_cache:
        arr = np.array([c.rgb for c in colors], dtype=float) / 255.0
        _lab_cache[key] = rgb2lab(arr.reshape(-1, 1, 3)).reshape(-1, 3)
    target = rgb2lab(np.array(rgb, dtype=float).reshape(1, 1, 3) / 255.0).reshape(3)
    d = deltaE_ciede2000(target[None, :], _lab_cache[key])
    return colors[int(np.argmin(d))]

if __name__ == "__main__":
    import sys, cv2
    img = cv2.imread(sys.argv[1])
    rgb = dominant_rgb(img)
    print(rgb, "->", match_color(rgb, load_colors()))
```

- [ ] **Step 4:** `pytest tests/test_color.py -v` → PASS
- [ ] **Step 5:** Commit `feat: color matching via CIEDE2000 against Rebrickable colors`

**Phase 1 gate:** all tests green; show user; get go-ahead for Phase 2.

---

## Phase 2 — identify.py (Brickognize client)

### Task 4: identify.py (TDD, mocked HTTP)

**Files:** Create `pipeline/identify.py`, `tests/test_identify.py`, `scripts/live_identify_check.py`.

- [ ] **Step 1:** Failing tests (mock `requests.Session.post` via monkeypatch):

```python
# tests/test_identify.py — key cases
import numpy as np
from pipeline.identify import identify_crop, identify_all, Identification

BRICK_RESP = {"items": [{"id": "3001", "name": "Brick 2 x 4",
                         "category": "Bricks", "type": "part", "score": 0.93}]}

def test_takes_top_item(monkeypatch, tmp_path, solid_crop): ...
    # mock post -> BRICK_RESP; assert part_id == "3001", score == 0.93

def test_low_score_discarded(...): ...
    # score 0.42 -> Identification(part_id=None, name="unknown brick", score=0.42)

def test_cache_hit_skips_http(...): ...
    # call twice with same crop + cache_dir=tmp_path; post called exactly once

def test_api_down_degrades(...): ...
    # post raises ConnectionError -> part_id=None, name="unknown brick", no exception

def test_retry_then_success(...): ...
    # post fails twice (503) then succeeds -> returns "3001"; backoff patched to 0
```

- [ ] **Step 2:** Run → FAIL
- [ ] **Step 3:** Implement: encode crop to JPEG (`cv2.imencode`), SHA1 the bytes; check `{cache_dir}/{sha1}.json` first; POST multipart `{"query_image": ("crop.jpg", jpeg_bytes, "image/jpeg")}` to `https://api.brickognize.com/predict/`; parse `items[0]`; score < 0.7 or empty items → unknown-brick Identification; write cache on success. `identify_all`: `ThreadPoolExecutor(4)` + lock-guarded global rate limiter (min 1.0 s between request starts, cache hits exempt); retries: 3 attempts, backoff 1s/2s/4s on 5xx/429/network errors. `__main__` block: identify a single image path.
- [ ] **Step 4:** Tests PASS; commit `feat: Brickognize identify client with cache, throttle, retry`

### Task 5: Live API verification

- [ ] **Step 1:** Write `scripts/live_identify_check.py`: take an image path, run `identify_crop`, print result.
- [ ] **Step 2:** Ask user for a real photo of a single 2x4 brick; if none, generate a synthetic render (flat-color rounded rectangle with studs drawn via cv2 circles) — note synthetic may score low; a real photo is strongly preferred.
- [ ] **Step 3:** Run once against the real API; show user the JSON. **Phase 2 gate.**

---

## Phase 3 — detect.py

### Task 6: CV-contour fallback detector (TDD)

**Files:** Create `pipeline/detect.py`, `tests/test_detect.py`.

- [ ] **Step 1:** Failing tests: synthetic 800×600 white image with 3 solid colored rectangles (non-touching) → `detect_pieces(img, method="cv")` returns 3 boxes, each containing its rectangle's center; `crop_box` pads 10% and clamps to image bounds.
- [ ] **Step 2:** Implement `_detect_cv`: gray → GaussianBlur(5) → Otsu inverse threshold → morph close (5×5, 2 iter) → `findContours(EXTERNAL)` → keep contours with `0.0003 * img_area < area < 0.25 * img_area` → `boundingRect`. `crop_box`: pad each side by 10% of box w/h, clamp. `__main__`: run on a photo, print boxes, write `detect_debug.jpg`.
- [ ] **Step 3:** Tests PASS; commit.

### Task 7: YOLO detector

- [ ] **Step 1:** Search Roboflow Universe for a pretrained single-class LEGO detector with downloadable YOLOv8-compatible weights. If found: document download into `models/lego_yolo.pt` in README + a `scripts/get_model.py` helper.
- [ ] **Step 2:** Implement `_detect_yolo`: lazy-import ultralytics; `YOLO("models/lego_yolo.pt").predict(img, conf=0.25, device="cpu")`; boxes from `results[0].boxes.xyxy`. `method="auto"`: YOLO if weights file exists, else cv fallback (log which).
- [ ] **Step 3:** Write `scripts/train_yolo.py` (yolov8n, ~30 epochs, Roboflow dataset export in YOLO format, `device="cpu"` default with `--device` flag). **DO NOT RUN without user approval.**
- [ ] **Step 4:** Unit test: `method="auto"` with no weights file falls back to cv (monkeypatch path). Commit. **Phase 3 gate:** show detection debug image on a real/synthetic pile photo.

---

## Phase 4 — inventory, CLI, API, integration

### Task 8: inventory.py (TDD)

- [ ] Tests: grouping sums quantities by `(part_id, color_id)`; unknown bricks (part_id None) group by `(None, color_id)`; `merge_inventories` adds quantities across photos; output sorted by quantity desc. Implement; commit.

### Task 9: cli.py + debug overlay

- [ ] `python cli.py photo.jpg -o inventory.json --debug [--detector auto|yolo|cv]`: detect → crop → identify_all → color per crop → build_inventory → write JSON; `--debug` writes `debug.jpg` via `draw_debug` (green box + label `"{name} | {color} | {score:.2f}"`, filled text background for readability). Test with mocked identify. Commit.

### Task 10: api.py

- [ ] FastAPI: `POST /scan` (UploadFile) → inventory JSON. Sessions for the scan-in-batches flow: `POST /sessions` → `{"session_id"}`; `POST /sessions/{id}/scan` → accumulated inventory (in-memory dict store, `merge_inventories`); `GET /sessions/{id}/inventory`. Tests via `TestClient` with identify mocked. Commit.

### Task 11: Integration + README

- [ ] End-to-end run on a real pile photo from user (cv detector if YOLO weights absent); inspect `debug.jpg` together. Write README: setup, pipeline diagram, module-by-module debugging commands, photo guidance (single layer, pieces not touching, plain light background, top-down, even light, fill the frame). Final commit. **Phase 4 gate.**

---

## Self-Review Notes

- Spec coverage: all constraints mapped (degrade-on-API-failure → Task 4; independent module runnability → `__main__` blocks in Tasks 3/4/6/9; multi-photo merge → Tasks 8/10; training approval gate → Task 7).
- colormath explicitly rejected in favor of scikit-image (colormath crashes on numpy ≥1.23 due to removed `asscalar`).
- Type consistency: `Identification`/`LegoColor` dataclasses defined once, consumed by inventory/cli/api as specified in Interfaces section.
