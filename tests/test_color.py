import numpy as np
import pytest
from skimage.color import deltaE_ciede2000, rgb2lab

from pipeline.color import (
    PALETTE,
    dominant_rgb,
    dominant_rgb_masked,
    match_color,
    normalize_illumination,
)


def bgr(hexstr: str) -> tuple[int, int, int]:
    r, g, b = (int(hexstr[i : i + 2], 16) for i in (0, 2, 4))
    return (b, g, r)


def test_pure_red_matches_red(solid_crop):
    crop = solid_crop(bgr("C91A09"))
    assert match_color(dominant_rgb(crop), PALETTE).name == "red"


def test_dominant_rgb_ignores_glare_and_shadow(solid_crop):
    crop = solid_crop((9, 26, 201), size=100)
    crop[:10, :] = 255  # glare band
    crop[-10:, :] = 0  # shadow band
    r, g, b = dominant_rgb(crop)
    assert (r, g, b) == (201, 26, 9)  # median unaffected by clipped bands


def test_red_has_rebrickable_id():
    assert match_color((201, 26, 9), PALETTE).id == 4


def test_white_matches_white(solid_crop):
    crop = solid_crop((240, 240, 240))
    assert match_color(dominant_rgb(crop), PALETTE).name == "white"


def test_beige_and_tan_are_distinct(solid_crop):
    assert match_color(dominant_rgb(solid_crop(bgr("E4CD9E")))).name == "beige"
    assert match_color(dominant_rgb(solid_crop(bgr("AA7D55")))).name == "tan"


def test_dim_white_brick_normalizes_to_white():
    # A white brick photographed on a white table in dim light reads gray;
    # scaling by the (near-neutral) background restores it.
    rgb = normalize_illumination((180, 178, 175), bg_rgb=(190, 188, 186))
    assert match_color(rgb, PALETTE).name == "white"


def test_neutral_bg_removes_color_cast():
    # Warm indoor light tints everything; the background tint cancels it.
    rgb = normalize_illumination((170, 155, 140), bg_rgb=(225, 215, 200))
    r, g, b = rgb
    assert abs(r - g) < 12 and abs(g - b) < 12  # cast mostly gone


def test_colored_background_left_alone():
    # A wooden/colored table is no reference; correction must not fire.
    assert normalize_illumination((100, 50, 25), bg_rgb=(160, 90, 40)) == (100, 50, 25)


def test_rectified_view_can_use_a_slightly_wider_neutral_tolerance():
    corrected = normalize_illumination(
        (205, 66, 11), bg_rgb=(167, 150, 130), neutral_tolerance=45
    )

    assert match_color(corrected).name == "orange"


def test_palette_has_expected_colors():
    names = {c.name for c in PALETTE}
    expected = {
        "red", "dark red", "orange", "yellow", "beige", "tan", "brown",
        "dark brown", "lime", "green", "dark green", "teal", "cyan",
        "light blue", "blue", "dark blue", "purple", "pink", "magenta",
        "white", "light gray", "gray", "dark gray", "black",
    }
    assert names == expected
    assert len(PALETTE) == len(expected)  # no duplicate names


@pytest.mark.parametrize("color", PALETTE, ids=lambda c: c.name)
def test_palette_roundtrip(color):
    # Every palette hex must match itself — catches colliding entries.
    assert match_color(color.rgb, PALETTE).name == color.name


def test_palette_is_well_separated():
    # Lighting variation shouldn't push a piece across color boundaries, so
    # every pair of palette colors must keep a healthy CIEDE2000 distance.
    labs = rgb2lab(
        (np.array([c.rgb for c in PALETTE], dtype=float) / 255.0).reshape(-1, 1, 3)
    ).reshape(-1, 3)
    worst = None
    min_d = 1e9
    for i in range(len(labs)):
        for j in range(i + 1, len(labs)):
            d = float(deltaE_ciede2000(labs[i], labs[j]))
            if d < min_d:
                min_d, worst = d, (PALETTE[i].name, PALETTE[j].name)
    assert min_d > 8.0, f"palette pair too close: {worst} (dE={min_d:.1f})"


def test_masked_dominant_color_ignores_touching_neighbor_and_background():
    image = np.full((100, 120, 3), (220, 220, 220), np.uint8)
    image[20:80, 20:60] = (10, 20, 210)   # red target in BGR
    image[20:80, 60:100] = (210, 40, 10)  # blue neighbor
    mask = np.zeros(image.shape[:2], dtype=bool)
    mask[20:80, 20:60] = True

    rgb = dominant_rgb_masked(image, mask)

    assert match_color(rgb).name in {"red", "dark red"}
