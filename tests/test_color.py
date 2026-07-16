from pathlib import Path

from pipeline.color import dominant_rgb, load_colors, match_color

COLORS = load_colors(Path("data/colors.csv"))


def test_pure_red_matches_red(solid_crop):
    crop = solid_crop((9, 26, 201))  # BGR of Rebrickable Red C91A09
    rgb = dominant_rgb(crop)
    assert match_color(rgb, COLORS).name == "Red"


def test_dominant_rgb_ignores_glare_and_shadow(solid_crop):
    crop = solid_crop((9, 26, 201), size=100)
    crop[:10, :] = 255  # glare band
    crop[-10:, :] = 0  # shadow band
    r, g, b = dominant_rgb(crop)
    assert (r, g, b) == (201, 26, 9)  # median unaffected by clipped bands


def test_match_color_returns_id():
    red = match_color((201, 26, 9), COLORS)
    assert red.id == 4


def test_white_matches_white(solid_crop):
    crop = solid_crop((240, 240, 240))
    assert match_color(dominant_rgb(crop), COLORS).name == "White"


def test_unknown_color_excluded():
    assert all(c.id != -1 for c in COLORS)


def test_unphotographable_families_excluded():
    # Finish/system families (Pearl, Modulex, Trans-, ...) are RGB
    # near-duplicates of core colors; a center-pixel median can't tell them
    # apart, so they must not be in the matching palette.
    for prefix in ("Modulex", "Pearl", "Chrome", "Trans-"):
        assert not any(c.name.startswith(prefix) for c in COLORS), prefix
