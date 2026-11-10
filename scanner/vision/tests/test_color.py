import numpy as np
import pytest
from skimage.color import deltaE_ciede2000, rgb2lab

import pipeline.color as color_module
from pipeline.color import (
    INVENTORY_PALETTE,
    PALETTE,
    apply_illuminant_correction,
    choose_illuminant_correction,
    dominant_rgb,
    dominant_rgb_masked,
    match_color,
    normalize_illumination,
    rank_color_candidates,
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


def test_gray_world_plan_preserves_brightness_instead_of_whitening_table():
    plan = choose_illuminant_correction(
        [(175, 165, 148), (174, 165, 149), (166, 156, 140)]
    )

    corrected, details = apply_illuminant_correction(
        (175, 165, 148), (175, 165, 148), plan
    )

    assert plan["method"] == "gray_world"
    assert max(corrected) < 200
    assert max(corrected) - min(corrected) <= 2
    assert details["applied"] is True


def test_unreliable_colored_reference_falls_back_to_raw():
    plan = choose_illuminant_correction(
        [(160, 90, 40), (80, 150, 45), (45, 75, 160)]
    )

    corrected, details = apply_illuminant_correction(
        (100, 50, 25), (160, 90, 40), plan
    )

    assert plan["method"] == "raw_fallback"
    assert corrected == (100, 50, 25)
    assert details["applied"] is False


def test_gray_world_does_not_turn_low_chroma_black_sample_blue():
    plan = choose_illuminant_correction(
        [(175, 165, 148), (174, 165, 149), (166, 156, 140)]
    )

    corrected, details = apply_illuminant_correction(
        (50, 59, 68), (175, 165, 148), plan
    )

    assert corrected == (50, 59, 68)
    assert details["rejection_reason"] == "low_chroma_amplification"


def test_chroma_gate_keeps_dark_neutral_out_of_blue_palette():
    matches, decision = rank_color_candidates((50, 59, 68), limit=3)

    assert decision["gate"] == "neutral"
    assert {match["name"] for match in matches} <= {
        "black", "dark gray", "gray", "light gray", "white"
    }


def test_chromatic_ranking_prioritizes_hue_over_brightness():
    matches, decision = rank_color_candidates((15, 60, 127), limit=3)

    assert decision["gate"] == "chromatic"
    assert matches[0]["name"] == "blue"
    assert matches[0]["decision_score"] < matches[1]["decision_score"]


def test_chroma_gate_keeps_yellow_out_of_neutral_and_lime_confusion():
    matches, decision = rank_color_candidates((227, 200, 27), limit=3)

    assert decision["gate"] == "chromatic"
    assert matches[0]["name"] == "yellow"


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


def test_inventory_palette_matches_physical_demo_bucket():
    assert tuple(color.name for color in INVENTORY_PALETTE) == (
        "red", "orange", "yellow", "beige", "brown", "green",
        "dark green", "blue", "white", "light gray", "dark gray", "black",
    )


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


def test_color_evidence_records_sample_correction_palette_and_quality():
    image = np.full((80, 100, 3), (200, 215, 225), np.uint8)
    image[20:60, 25:75] = (10, 30, 180)
    image[20:24, 25:75] = 255
    mask = np.zeros(image.shape[:2], dtype=bool)
    mask[20:60, 25:75] = True

    evidence = color_module.color_evidence(
        image,
        mask,
        bg_rgb=(225, 215, 200),
        neutral_tolerance=45,
        view_tilt_deg=38.0,
        segmentation_confidence=0.92,
        boundary_zone=False,
    )

    assert set(evidence) >= {
        "raw_rgb", "corrected_rgb", "lab", "top_palette_matches",
        "delta_e_margin", "luminance", "background", "view_quality",
        "flags",
    }
    assert len(evidence["lab"]) == 3
    assert len(evidence["top_palette_matches"]) == 3
    assert all("delta_e" in match for match in evidence["top_palette_matches"])
    assert evidence["delta_e_margin"] == pytest.approx(
        evidence["top_palette_matches"][1]["delta_e"]
        - evidence["top_palette_matches"][0]["delta_e"]
    )
    assert evidence["luminance"]["pixel_count"] > 0
    assert evidence["background"]["rgb"] == [225, 215, 200]
    assert evidence["view_quality"]["tilt_deg"] == 38.0
    assert "oblique_view" in evidence["flags"]
