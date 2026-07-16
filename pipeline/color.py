"""Match a crop's dominant color to the nearest LEGO color (CIEDE2000).

Independently runnable: python -m pipeline.color crop.jpg
"""
from __future__ import annotations

import csv
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from skimage.color import deltaE_ciede2000, rgb2lab


@dataclass(frozen=True)
class LegoColor:
    id: int
    name: str
    rgb: tuple[int, int, int]


# A median-of-center-pixels sample can only resolve hue/lightness, never
# surface finish or transparency, so these families are indistinguishable
# from their solid counterparts and only steal matches (e.g. Pearl White
# F2F3F2 outranks White FFFFFF). Modulex/Duplo/Fabuland are non-standard
# brick systems.
_EXCLUDED_FAMILIES = (
    "Modulex", "Duplo", "Fabuland", "Chrome", "Pearl", "Metallic",
    "Speckle", "Glitter", "Glow", "Milky", "Opal", "Satin",
)


def load_colors(csv_path: Path = Path("data/colors.csv")) -> list[LegoColor]:
    colors = []
    with open(csv_path, newline="") as f:
        for row in csv.DictReader(f):
            cid = int(row["id"])
            if cid == -1:  # "[Unknown]" placeholder row
                continue
            if row.get("is_trans", "f").lower() in ("t", "true"):
                continue
            if row["name"].startswith(_EXCLUDED_FAMILIES):
                continue
            h = row["rgb"].lstrip("#")
            rgb = (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16))
            colors.append(LegoColor(cid, row["name"], rgb))
    return colors


def dominant_rgb(crop_bgr: np.ndarray) -> tuple[int, int, int]:
    """Median color of the central ~5% of pixels, excluding glare/shadow."""
    h, w = crop_bgr.shape[:2]
    side = max(2, int((0.05**0.5) * min(h, w)))
    cy, cx = h // 2, w // 2
    center = crop_bgr[
        max(0, cy - side // 2) : cy + side // 2 + 1,
        max(0, cx - side // 2) : cx + side // 2 + 1,
    ]
    px = center.reshape(-1, 3).astype(np.int32)
    lum = px.mean(axis=1)
    keep = px[(lum > 25) & (lum < 235)]
    if len(keep) == 0:  # uniformly dark/bright crop: use everything
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
    dists = deltaE_ciede2000(target[None, :], _lab_cache[key])
    return colors[int(np.argmin(dists))]


if __name__ == "__main__":
    import sys

    import cv2

    img = cv2.imread(sys.argv[1])
    if img is None:
        raise SystemExit(f"could not read image: {sys.argv[1]}")
    rgb = dominant_rgb(img)
    color = match_color(rgb, load_colors())
    print(f"dominant rgb={rgb} -> {color.name} (id={color.id})")
