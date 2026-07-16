"""Match a crop's dominant color to a curated base-color palette (CIEDE2000).

Matching runs against PALETTE, a hand-picked set of ~24 well-separated base
colors, not the full Rebrickable catalog: the catalog's near-duplicate shades
(several grays, bright vs regular green, Pearl/Trans finish variants) only add
noise that lighting variation would push pieces across. Each palette entry
carries the nearest representative Rebrickable color id so downstream part
lookups still work.

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
    id: int  # representative Rebrickable color id
    name: str
    rgb: tuple[int, int, int]


def _hx(hexstr: str) -> tuple[int, int, int]:
    return tuple(int(hexstr[i : i + 2], 16) for i in (0, 2, 4))


# Hand-picked hexes, chosen for CIEDE2000 separation (see
# test_palette_is_well_separated). Beige is lighter/creamier; tan is
# warmer/darker.
PALETTE: list[LegoColor] = [
    LegoColor(4, "red", _hx("C91A09")),
    LegoColor(320, "dark red", _hx("720E0F")),
    LegoColor(25, "orange", _hx("FE8A18")),
    LegoColor(14, "yellow", _hx("F2CD37")),
    LegoColor(19, "beige", _hx("E4CD9E")),
    LegoColor(84, "tan", _hx("AA7D55")),
    LegoColor(6, "brown", _hx("583927")),
    LegoColor(308, "dark brown", _hx("352100")),
    LegoColor(27, "lime", _hx("BBE90B")),
    LegoColor(2, "green", _hx("237841")),
    LegoColor(288, "dark green", _hx("184632")),
    LegoColor(3, "teal", _hx("008F9B")),
    LegoColor(322, "cyan", _hx("36AEBF")),
    LegoColor(73, "light blue", _hx("5A93DB")),
    LegoColor(23, "blue", _hx("0055BF")),
    LegoColor(272, "dark blue", _hx("0A3463")),
    LegoColor(85, "purple", _hx("3F3691")),
    LegoColor(29, "pink", _hx("E4ADC8")),
    LegoColor(26, "magenta", _hx("923978")),
    LegoColor(15, "white", _hx("FFFFFF")),
    LegoColor(71, "light gray", _hx("A0A5A9")),
    LegoColor(72, "gray", _hx("6C6E68")),
    LegoColor(8, "dark gray", _hx("3E4044")),
    LegoColor(0, "black", _hx("05131D")),
]


def load_colors(csv_path: Path = Path("data/colors.csv")) -> list[LegoColor]:
    """Load the full Rebrickable catalog (solid opaque colors only).

    Kept as a reference loader; pipeline matching uses PALETTE instead.
    """
    colors = []
    with open(csv_path, newline="") as f:
        for row in csv.DictReader(f):
            cid = int(row["id"])
            if cid == -1:  # "[Unknown]" placeholder row
                continue
            if row.get("is_trans", "f").lower() in ("t", "true"):
                continue
            h = row["rgb"].lstrip("#")
            colors.append(LegoColor(cid, row["name"], _hx(h)))
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


def match_color(
    rgb: tuple[int, int, int], colors: list[LegoColor] | None = None
) -> LegoColor:
    if colors is None:
        colors = PALETTE
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
    color = match_color(rgb)
    print(f"dominant rgb={rgb} -> {color.name} (color_id={color.id})")
