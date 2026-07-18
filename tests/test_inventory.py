import numpy as np

from pipeline.color import LegoColor
from pipeline.identify import Identification
from pipeline.inventory import build_inventory, draw_debug, merge_inventories

RED = LegoColor(4, "red", (201, 26, 9))
BLUE = LegoColor(23, "blue", (0, 85, 191))
AMBIGUOUS_DARK = LegoColor(-1, "ambiguous(black/dark gray)", (34, 42, 49))
AMBIGUOUS_WARM = LegoColor(-1, "ambiguous(orange/red)", (228, 82, 16))

BRICK_2X4 = Identification("3001", "Brick 2 x 4", "Bricks", 0.93)
BRICK_2X2 = Identification("3003", "Brick 2 x 2", "Bricks", 0.88)
UNKNOWN = Identification(None, "unknown brick", None, 0.0)


def test_groups_by_part_and_color():
    inv = build_inventory(
        [(BRICK_2X4, RED), (BRICK_2X4, RED), (BRICK_2X4, BLUE), (BRICK_2X2, RED)]
    )
    assert {
        "part_id": "3001", "name": "Brick 2 x 4", "color": "red",
        "color_id": 4, "quantity": 2,
    } in inv
    assert len(inv) == 3


def test_unknown_bricks_group_by_color():
    inv = build_inventory([(UNKNOWN, RED), (UNKNOWN, RED), (UNKNOWN, BLUE)])
    assert len(inv) == 2
    red_unknown = next(e for e in inv if e["color"] == "red")
    assert red_unknown["part_id"] is None
    assert red_unknown["name"] == "unknown brick"
    assert red_unknown["quantity"] == 2


def test_distinct_ambiguities_do_not_merge_under_placeholder_color_id():
    inv = build_inventory(
        [(BRICK_2X4, AMBIGUOUS_DARK), (BRICK_2X4, AMBIGUOUS_WARM)]
    )

    assert len(inv) == 2
    assert {item["color"] for item in inv} == {
        "ambiguous(black/dark gray)", "ambiguous(orange/red)"
    }


def test_sorted_by_quantity_desc():
    inv = build_inventory(
        [(BRICK_2X2, RED)] + [(BRICK_2X4, BLUE)] * 3 + [(BRICK_2X4, RED)] * 2
    )
    assert [e["quantity"] for e in inv] == [3, 2, 1]


def test_merge_adds_quantities():
    inv1 = build_inventory([(BRICK_2X4, RED), (BRICK_2X2, RED)])
    inv2 = build_inventory([(BRICK_2X4, RED)] * 2 + [(BRICK_2X4, BLUE)])
    merged = merge_inventories(inv1, inv2)
    red_2x4 = next(e for e in merged if e["part_id"] == "3001" and e["color_id"] == 4)
    assert red_2x4["quantity"] == 3
    assert len(merged) == 3
    assert [e["quantity"] for e in merged] == sorted(
        (e["quantity"] for e in merged), reverse=True
    )


def test_merge_of_nothing_is_empty():
    assert merge_inventories() == []


def test_draw_debug_returns_annotated_copy():
    img = np.zeros((200, 300, 3), dtype=np.uint8)
    out = draw_debug(img, [(10, 10, 100, 80)], ["Brick 2 x 4 | red | 0.93"])
    assert out.shape == img.shape
    assert out.any()  # something was drawn
    assert not img.any()  # original untouched
