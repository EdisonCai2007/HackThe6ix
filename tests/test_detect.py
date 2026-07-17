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


def test_long_piece_below_five_percent_of_image_is_not_a_cluster():
    pieces = [(20, 20, 60, 60), (80, 20, 120, 60), (140, 20, 180, 60)]
    long_piece = (200, 100, 320, 200)  # 4% of a 600x500 crop
    result = _split_clusters(pieces + [long_piece], img_area=600 * 500)
    assert long_piece in result.boxes
    assert result.clusters == []


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


def test_filter_drops_box_spanning_most_of_image():
    boxes = [(100, 100, 180, 160), (20, 300, 980, 380)]
    kept = pipeline.detect._filter_implausible_boxes(boxes, (800, 1000, 3))
    assert kept == [boxes[0]]


def test_filter_drops_only_large_isolated_outlier():
    central = [
        (350, 350, 390, 390),
        (420, 350, 460, 390),
        (490, 350, 530, 390),
        (420, 420, 460, 460),
    ]
    long_brick_in_group = (330, 450, 530, 510)
    large_isolated_junk = (800, 800, 920, 920)
    kept = pipeline.detect._filter_implausible_boxes(
        central + [long_brick_in_group, large_isolated_junk],
        (1000, 1000, 3),
    )
    assert long_brick_in_group in kept
    assert large_isolated_junk not in kept


def test_filter_keeps_normal_sized_isolated_piece():
    central = [
        (350, 350, 390, 390),
        (420, 350, 460, 390),
        (490, 350, 530, 390),
        (420, 420, 460, 460),
        (470, 420, 510, 460),
    ]
    isolated_piece = (850, 850, 890, 890)
    kept = pipeline.detect._filter_implausible_boxes(
        central + [isolated_piece], (1000, 1000, 3)
    )
    assert isolated_piece in kept


def test_background_kernel_remains_large_on_workspace_crop():
    ksize = pipeline.detect._background_kernel_size(701, 601)
    assert ksize >= 41
    assert ksize % 2 == 1
