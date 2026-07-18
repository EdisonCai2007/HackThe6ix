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

import cv2
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


def dominant_rgb_masked(
    image_bgr: np.ndarray, mask: np.ndarray
) -> tuple[int, int, int]:
    """Robust piece color from only one segmentation instance's pixels."""
    mask = np.asarray(mask, dtype=bool)
    if mask.shape != image_bgr.shape[:2]:
        raise ValueError("color mask must match image dimensions")
    if not mask.any():
        raise ValueError("color mask is empty")
    interior = cv2.erode(
        mask.astype(np.uint8), np.ones((3, 3), np.uint8)
    ).astype(bool)
    if interior.sum() < max(9, 0.25 * mask.sum()):
        interior = mask
    pixels = image_bgr[interior].reshape(-1, 3).astype(np.int32)
    luminance = pixels.mean(axis=1)
    usable = pixels[(luminance > 25) & (luminance < 245)]
    if len(usable) < 9:
        usable = pixels
    if len(usable) >= 20:
        usable_luminance = usable.mean(axis=1)
        low, high = np.quantile(usable_luminance, [0.10, 0.90])
        central = usable[
            (usable_luminance >= low) & (usable_luminance <= high)
        ]
        if len(central):
            usable = central
    b, g, r = np.median(usable, axis=0).astype(int)
    return int(r), int(g), int(b)


def normalize_illumination(
    rgb: tuple[int, int, int],
    bg_rgb: tuple[int, int, int],
    neutral_tolerance: int = 30,
) -> tuple[int, int, int]:
    """White-patch correction: if the background is near-neutral (a white or
    gray table), scale channels so the background maps to white, cancelling
    dim light and color casts. Colored backgrounds are no reference — the
    input is returned unchanged.
    """
    if max(bg_rgb) - min(bg_rgb) > neutral_tolerance or max(bg_rgb) < 100:
        return rgb
    scaled = tuple(
        min(255, int(round(c * min(2.0, 245 / max(1, b)))))
        for c, b in zip(rgb, bg_rgb)
    )
    return scaled  # type: ignore[return-value]


_lab_cache: dict[int, np.ndarray] = {}


def _rgb_lab(rgb: tuple[int, int, int]) -> np.ndarray:
    return rgb2lab(
        np.array(rgb, dtype=float).reshape(1, 1, 3) / 255.0
    ).reshape(3)


def palette_matches(
    rgb: tuple[int, int, int],
    colors: list[LegoColor] | None = None,
    limit: int = 3,
) -> list[dict]:
    """Rank palette candidates while preserving inspectable delta-E values."""
    if colors is None:
        colors = PALETTE
    key = id(colors)
    if key not in _lab_cache:
        arr = np.array([color.rgb for color in colors], dtype=float) / 255.0
        _lab_cache[key] = rgb2lab(arr.reshape(-1, 1, 3)).reshape(-1, 3)
    distances = deltaE_ciede2000(_rgb_lab(rgb)[None, :], _lab_cache[key])
    order = np.argsort(distances)[:max(0, int(limit))]
    return [
        {
            "color_id": colors[int(index)].id,
            "name": colors[int(index)].name,
            "rgb": list(colors[int(index)].rgb),
            "delta_e": float(distances[int(index)]),
        }
        for index in order
    ]


def _masked_interior_pixels(
    image_bgr: np.ndarray, mask: np.ndarray
) -> np.ndarray:
    mask = np.asarray(mask, dtype=bool)
    if mask.shape != image_bgr.shape[:2]:
        raise ValueError("color mask must match image dimensions")
    if not mask.any():
        raise ValueError("color mask is empty")
    interior = cv2.erode(
        mask.astype(np.uint8), np.ones((3, 3), np.uint8)
    ).astype(bool)
    if interior.sum() < max(9, 0.25 * mask.sum()):
        interior = mask
    return image_bgr[interior].reshape(-1, 3)


def color_evidence(
    image_bgr: np.ndarray,
    mask: np.ndarray,
    *,
    bg_rgb: tuple[int, int, int],
    sampled_rgb: tuple[int, int, int] | None = None,
    neutral_tolerance: int = 30,
    view_tilt_deg: float | None = None,
    segmentation_confidence: float | None = None,
    boundary_zone: bool = False,
) -> dict:
    """Describe the existing color decision without changing that decision."""
    raw_rgb = (
        dominant_rgb_masked(image_bgr, mask)
        if sampled_rgb is None else sampled_rgb
    )
    corrected_rgb = normalize_illumination(
        raw_rgb, bg_rgb, neutral_tolerance=neutral_tolerance
    )
    matches = palette_matches(corrected_rgb, limit=3)
    pixels = _masked_interior_pixels(image_bgr, mask)
    gray = cv2.cvtColor(
        pixels.reshape(-1, 1, 3).astype(np.uint8), cv2.COLOR_BGR2GRAY
    ).reshape(-1).astype(float)
    p10, median, p90 = np.quantile(gray, [0.10, 0.50, 0.90])
    low_fraction = float(np.mean(gray <= 25))
    high_fraction = float(np.mean(gray >= 245))
    spread = float(p90 - p10)
    background_neutral = max(bg_rgb) - min(bg_rgb) <= neutral_tolerance
    flags = []
    if raw_rgb != corrected_rgb:
        flags.append("white_patch_applied")
    if not background_neutral:
        flags.append("background_not_neutral")
    if low_fraction >= 0.10 and spread >= 40.0:
        flags.append("possible_shadow")
    if high_fraction >= 0.02 and spread >= 40.0:
        flags.append("possible_specular")
    if view_tilt_deg is not None and view_tilt_deg >= 30.0:
        flags.append("oblique_view")
    if segmentation_confidence is not None and segmentation_confidence < 0.70:
        flags.append("low_segmentation_confidence")
    if boundary_zone:
        flags.append("boundary_view")
    return {
        "raw_rgb": list(raw_rgb),
        "corrected_rgb": list(corrected_rgb),
        "lab": [float(value) for value in _rgb_lab(corrected_rgb)],
        "top_palette_matches": matches,
        "delta_e_margin": (
            float(matches[1]["delta_e"] - matches[0]["delta_e"])
            if len(matches) >= 2 else None
        ),
        "luminance": {
            "pixel_count": int(gray.size),
            "p10": float(p10),
            "median": float(median),
            "p90": float(p90),
            "p90_minus_p10": spread,
            "shadow_clip_fraction": low_fraction,
            "highlight_clip_fraction": high_fraction,
        },
        "background": {
            "rgb": list(bg_rgb),
            "neutral_tolerance": int(neutral_tolerance),
            "is_neutral": background_neutral,
        },
        "view_quality": {
            "tilt_deg": view_tilt_deg,
            "segmentation_confidence": segmentation_confidence,
            "boundary_zone": bool(boundary_zone),
        },
        "flags": flags,
    }


def match_color(
    rgb: tuple[int, int, int], colors: list[LegoColor] | None = None
) -> LegoColor:
    if colors is None:
        colors = PALETTE
    key = id(colors)
    if key not in _lab_cache:
        arr = np.array([c.rgb for c in colors], dtype=float) / 255.0
        _lab_cache[key] = rgb2lab(arr.reshape(-1, 1, 3)).reshape(-1, 3)
    target = _rgb_lab(rgb)
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
