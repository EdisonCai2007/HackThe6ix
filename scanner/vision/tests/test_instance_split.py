import cv2
import numpy as np

from pipeline.instance_split import _Seed, _merge_spatial_variants, split_component


def _scene():
    return np.full((220, 260, 3), 235, dtype=np.uint8)


def _centers_covered_once(boxes, rects):
    for x0, y0, x1, y1 in rects:
        cx, cy = (x0 + x1) // 2, (y0 + y1) // 2
        assert sum(x0b <= cx <= x1b and y0b <= cy <= y1b
                   for x0b, y0b, x1b, y1b in boxes) == 1


def test_splits_touching_red_yellow_and_white_pieces():
    image = _scene()
    mask = np.zeros(image.shape[:2], dtype=np.uint8)
    rects = [(35, 45, 95, 105), (88, 105, 158, 165),
             (150, 55, 215, 120)]
    colors = [(9, 26, 201), (55, 205, 242), (205, 205, 205)]
    for rect, color in zip(rects, colors):
        x0, y0, x1, y1 = rect
        image[y0:y1, x0:x1] = color
        mask[y0:y1, x0:x1] = 255
    cv2.line(mask, (92, 103), (102, 113), 255, 7)
    cv2.line(mask, (153, 108), (160, 112), 255, 7)

    boxes = split_component(image, mask, min_area=300)

    assert len(boxes) == 3
    _centers_covered_once(boxes, rects)


def test_splits_two_same_color_pieces_joined_by_unconfident_bridge():
    image = _scene()
    mask = np.zeros(image.shape[:2], dtype=np.uint8)
    rects = [(30, 70, 95, 135), (150, 70, 215, 135)]
    for x0, y0, x1, y1 in rects:
        image[y0:y1, x0:x1] = (9, 26, 201)
        mask[y0:y1, x0:x1] = 255
    image[98:107, 95:150] = 225
    mask[98:107, 95:150] = 255

    boxes = split_component(image, mask, min_area=300)

    assert len(boxes) == 2
    _centers_covered_once(boxes, rects)


def test_keeps_one_long_orange_piece_whole():
    image = _scene()
    mask = np.zeros(image.shape[:2], dtype=np.uint8)
    image[80:125, 25:225] = (24, 138, 254)
    mask[80:125, 25:225] = 255

    boxes = split_component(image, mask, min_area=300)

    assert len(boxes) == 1
    x0, y0, x1, y1 = boxes[0]
    assert x0 <= 25 and y0 <= 80 and x1 >= 225 and y1 >= 125


def test_keeps_one_piece_whole_when_lighting_creates_nested_palette_family():
    image = _scene()
    mask = np.zeros(image.shape[:2], dtype=np.uint8)
    image[35:185, 55:205] = (55, 205, 242)  # yellow base
    image[80:140, 95:165] = (85, 125, 170)  # tan-looking shadow/highlight
    mask[35:185, 55:205] = 255

    boxes = split_component(image, mask, min_area=300)

    assert len(boxes) == 1


def test_keeps_long_piece_whole_when_shading_splits_its_color_core():
    image = _scene()
    mask = np.zeros(image.shape[:2], dtype=np.uint8)
    image[25:200, 90:125] = (24, 138, 254)  # orange base
    image[35:105, 103:125] = (9, 26, 201)   # red-looking shaded side
    image[145:190, 108:125] = (9, 26, 201)
    mask[25:200, 90:125] = 255

    boxes = split_component(image, mask, min_area=300)

    assert len(boxes) == 1


def test_merges_adjacent_overlapping_seed_shapes_from_different_families():
    first = np.zeros((120, 60), dtype=bool)
    first[10:30, 20:30] = True
    first[25:80, 25:30] = True
    second = np.zeros_like(first)
    second[30:100, 10:25] = True
    seeds = [
        _Seed(first, (20, 10, 30, 80), "red"),
        _Seed(second, (10, 30, 25, 100), "orange"),
    ]

    merged = _merge_spatial_variants(seeds)

    assert len(merged) == 1


def test_keeps_adjacent_compact_seed_shapes_as_different_pieces():
    first = np.zeros((80, 80), dtype=bool)
    first[10:20, 20:60] = True
    first[20:50, 55:60] = True
    second = np.zeros_like(first)
    second[20:60, 10:20] = True
    second[20:25, 20:25] = True
    seeds = [
        _Seed(first, (20, 10, 60, 50), "yellow"),
        _Seed(second, (10, 20, 25, 60), "light-neutral"),
    ]

    merged = _merge_spatial_variants(seeds)

    assert len(merged) == 2
