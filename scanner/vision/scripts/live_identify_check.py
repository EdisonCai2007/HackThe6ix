"""One-shot smoke test of pipeline.identify against the REAL Brickognize API.

Usage:
    python scripts/live_identify_check.py photo.jpg      # your photo
    python scripts/live_identify_check.py --synthetic    # rendered 2x4 brick

Prints the parsed Identification plus the raw cached API response.
"""
from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path

import cv2
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from pipeline.identify import identify_crop  # noqa: E402


def render_synthetic_2x4(path: Path) -> None:
    """Top-down render of a red 2x4 brick on a light background."""
    img = np.full((360, 560, 3), (235, 233, 230), dtype=np.uint8)
    x0, y0, x1, y1 = 80, 80, 480, 280
    body = (9, 26, 201)  # LEGO Red, BGR
    cv2.rectangle(img, (x0, y0), (x1, y1), body, -1)
    # darker right/bottom edges for depth
    cv2.rectangle(img, (x1 - 8, y0), (x1, y1), (7, 18, 150), -1)
    cv2.rectangle(img, (x0, y1 - 8), (x1, y1), (7, 18, 150), -1)
    # 2 rows x 4 cols of studs
    for row in range(2):
        for col in range(4):
            cx = x0 + 50 + col * 100
            cy = y0 + 50 + row * 100
            cv2.circle(img, (cx, cy), 34, (7, 20, 160), -1)  # stud shadow ring
            cv2.circle(img, (cx - 2, cy - 2), 30, (30, 50, 220), -1)  # stud top
            cv2.ellipse(img, (cx - 10, cy - 12), (10, 6), -35, 0, 360,
                        (90, 110, 240), -1)  # highlight
    cv2.imwrite(str(path), img)


def main() -> None:
    if len(sys.argv) > 1 and sys.argv[1] != "--synthetic":
        img_path = Path(sys.argv[1])
    else:
        img_path = Path("data/synthetic_2x4.jpg")
        render_synthetic_2x4(img_path)
        print(f"rendered synthetic brick -> {img_path}")

    img = cv2.imread(str(img_path))
    if img is None:
        raise SystemExit(f"could not read image: {img_path}")

    result = identify_crop(img)
    print(f"\nIdentification: {result}")

    ok, buf = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, 95])
    cache_file = Path(".cache") / f"{hashlib.sha1(buf.tobytes()).hexdigest()}.json"
    if cache_file.exists():
        raw = json.loads(cache_file.read_text())
        print("\nTop 3 raw API items:")
        for item in raw.get("items", [])[:3]:
            print(f"  {item.get('id')}  {item.get('name')!r}  "
                  f"score={item.get('score'):.3f}")


if __name__ == "__main__":
    main()
