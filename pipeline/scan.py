"""Full-photo scan: detect -> identify -> color -> inventory.

Shared by cli.py and api.py.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

import numpy as np

from pipeline.color import dominant_rgb, match_color
from pipeline.detect import Box, crop_box, detect
from pipeline.identify import identify_all
from pipeline.inventory import build_inventory


@dataclass
class ScanResult:
    inventory: list[dict] = field(default_factory=list)
    boxes: list[Box] = field(default_factory=list)
    labels: list[str] = field(default_factory=list)
    clusters: list[Box] = field(default_factory=list)


def scan_image(
    img: np.ndarray,
    detector: str = "auto",
    cache_dir: Path = Path(".cache"),
) -> ScanResult:
    dets = detect(img, method=detector)
    crops = [crop_box(img, b) for b in dets.boxes]
    idents = identify_all(crops, cache_dir=cache_dir)
    colors = [match_color(dominant_rgb(c)) for c in crops]
    labels = [
        f"{ident.name} | {color.name} | {ident.score:.2f}"
        for ident, color in zip(idents, colors)
    ]
    return ScanResult(
        inventory=build_inventory(list(zip(idents, colors))),
        boxes=dets.boxes,
        labels=labels,
        clusters=dets.clusters,
    )
