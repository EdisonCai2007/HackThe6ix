import cv2
import numpy as np

from pipeline.instance_split import split_component


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
