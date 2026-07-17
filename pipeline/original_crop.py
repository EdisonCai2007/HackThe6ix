"""Map fused table-canvas boxes into ORIGINAL full-res frame pixels.

Rectified views are used for localization and fusion only; identification
crops are cut from the unwarped original frames so raised pieces keep their
true proportions (the rectifying homography is exact only for the z=0 plane —
anything above it gets stretched, which corrupted Brickognize IDs).
"""
from __future__ import annotations

import numpy as np

Box = tuple[int, int, int, int]


def original_box_and_fit(
    box_canvas: Box,
    homography: np.ndarray,
    rgb_size: tuple[int, int],
    raise_uv_per_cm: tuple[float, float] = (0.0, 0.0),
    pad_frac: float = 0.2,
    raise_cm: float = 1.5,
) -> tuple[Box, bool]:
    """Like original_box, but also reports whether the padded box fits the
    original image without clamping — a clamped crop means the piece may run
    off the physical camera frame and that view is a poor ID source."""
    box = original_box(box_canvas, homography, rgb_size, raise_uv_per_cm,
                       pad_frac=pad_frac, raise_cm=raise_cm, _clamp=False)
    height, width = rgb_size
    fits = box[0] >= 0 and box[1] >= 0 and box[2] <= width and box[3] <= height
    clamped = (max(0, box[0]), max(0, box[1]),
               min(width, box[2]), min(height, box[3]))
    return clamped, fits


def original_box(
    box_canvas: Box,
    homography: np.ndarray,
    rgb_size: tuple[int, int],
    raise_uv_per_cm: tuple[float, float] = (0.0, 0.0),
    pad_frac: float = 0.2,
    raise_cm: float = 1.5,
    _clamp: bool = True,
) -> Box:
    """AABB of the canvas box mapped into the original frame, padded.

    `homography` maps canvas px -> original px (the view's rectification
    matrix, manifest v2). Symmetric `pad_frac` covers localization slack;
    the extra one-sided extension follows `raise_uv_per_cm * raise_cm`,
    the projected displacement of a piece top ~raise_cm above the plane —
    the plane-projected box under-covers piece tops in oblique views.
    """
    x0, y0, x1, y1 = box_canvas
    corners = np.array(
        [[x0, y0, 1.0], [x1, y0, 1.0], [x0, y1, 1.0], [x1, y1, 1.0]]
    )
    mapped = corners @ np.asarray(homography, dtype=float).T
    uv = mapped[:, :2] / mapped[:, 2:3]
    mx0, my0 = uv.min(axis=0)
    mx1, my1 = uv.max(axis=0)

    pad_u = (mx1 - mx0) * pad_frac
    pad_v = (my1 - my0) * pad_frac
    mx0, mx1 = mx0 - pad_u, mx1 + pad_u
    my0, my1 = my0 - pad_v, my1 + pad_v

    du = raise_uv_per_cm[0] * raise_cm
    dv = raise_uv_per_cm[1] * raise_cm
    if du >= 0:
        mx1 += du
    else:
        mx0 += du
    if dv >= 0:
        my1 += dv
    else:
        my0 += dv

    height, width = rgb_size
    if not _clamp:
        return (int(np.floor(mx0)), int(np.floor(my0)),
                int(np.ceil(mx1)), int(np.ceil(my1)))
    return (
        int(max(0, np.floor(mx0))),
        int(max(0, np.floor(my0))),
        int(min(width, np.ceil(mx1))),
        int(min(height, np.ceil(my1))),
    )
