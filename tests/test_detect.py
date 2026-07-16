from pathlib import Path

import numpy as np
import pytest

import pipeline.detect
from pipeline.detect import _split_clusters, crop_box, detect_pieces


def make_scene():
    """White 800x600 background with three separated colored rectangles."""
    img = np.full((600, 800, 3), 250, dtype=np.uint8)
    rects = [(100, 100, 220, 180), (400, 120, 560, 240), (250, 350, 420, 480)]
    colors = [(9, 26, 201), (191, 85, 0), (55, 205, 242)]
    for (x0, y0, x1, y1), c in zip(rects, colors):
        img[y0:y1, x0:x1] = c
    return img, rects


def centers_covered(boxes, rects):
    """Every rect center falls inside exactly one detected box."""
    for x0, y0, x1, y1 in rects:
        cx, cy = (x0 + x1) // 2, (y0 + y1) // 2
        hits = [b for b in boxes if b[0] <= cx <= b[2] and b[1] <= cy <= b[3]]
        if len(hits) != 1:
            return False
    return True


def test_detects_three_separated_pieces():
    img, rects = make_scene()
    boxes = detect_pieces(img, method="cv")
    assert len(boxes) == 3
    assert centers_covered(boxes, rects)


def test_border_clutter_ignored():
    img, rects = make_scene()
    img[:, 770:] = 20  # dark clutter strip touching the right edge
    boxes = detect_pieces(img, method="cv")
    assert len(boxes) == 3
    assert centers_covered(boxes, rects)


def test_speck_noise_ignored():
    img, rects = make_scene()
    img[300:303, 600:603] = 0  # tiny speck, far below min area
    boxes = detect_pieces(img, method="cv")
    assert len(boxes) == 3


def test_auto_falls_back_to_cv_without_weights(monkeypatch):
    monkeypatch.setattr(
        pipeline.detect, "YOLO_WEIGHTS", Path("models/does-not-exist.pt")
    )
    img, rects = make_scene()
    boxes = detect_pieces(img, method="auto")
    assert len(boxes) == 3  # cv fallback ran; no ultralytics import needed


def test_unknown_method_raises():
    img, _ = make_scene()
    with pytest.raises(ValueError, match="unknown detector"):
        detect_pieces(img, method="bogus")


def test_oversized_box_flagged_as_cluster():
    pieces = [(0, 0, 100, 80), (200, 0, 310, 90), (0, 200, 120, 290)]
    blob = (300, 300, 600, 520)  # ~7x the median piece area
    result = _split_clusters(pieces + [blob], img_area=800 * 600)
    assert result.boxes == pieces
    assert result.clusters == [blob]


def test_lone_huge_blob_still_flagged():
    # Even-count regression: the blob must not drag the median baseline up.
    piece = (0, 0, 150, 120)
    blob = (200, 200, 700, 640)
    result = _split_clusters([piece, blob], img_area=800 * 600)
    assert result.boxes == [piece]
    assert result.clusters == [blob]


def test_similar_sized_pieces_never_clustered():
    pieces = [(0, 0, 100, 80), (200, 0, 300, 85), (0, 200, 110, 280),
              (400, 400, 520, 490)]
    result = _split_clusters(pieces, img_area=800 * 600)
    assert result.clusters == []
    assert len(result.boxes) == 4


def test_crop_box_pads_ten_percent():
    img = np.zeros((600, 800, 3), dtype=np.uint8)
    crop = crop_box(img, (100, 100, 300, 200))
    # 200x100 box padded by 10% per side -> 240x120
    assert crop.shape[1] == 240
    assert crop.shape[0] == 120


def test_crop_box_clamps_at_image_edge():
    img = np.zeros((600, 800, 3), dtype=np.uint8)
    crop = crop_box(img, (0, 0, 100, 100))
    assert crop.shape[0] == 110 and crop.shape[1] == 110  # clamped at 0


def test_boxes_scale_back_to_original_coords():
    # Detector downscales internally; boxes must come back in original coords.
    img, rects = make_scene()
    big = np.kron(img, np.ones((4, 4, 1), dtype=np.uint8))  # 3200x2400
    boxes = detect_pieces(big, method="cv")
    scaled_rects = [(4 * x0, 4 * y0, 4 * x1, 4 * y1) for x0, y0, x1, y1 in rects]
    assert len(boxes) == 3
    assert centers_covered(boxes, scaled_rects)
