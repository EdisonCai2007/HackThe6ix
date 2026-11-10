from pathlib import Path

import cv2
import numpy as np
import pytest

from pipeline.identify import Identification
from pipeline.studs import (
    StudEvidence,
    aggregate_stud_evidence,
    analyze_studs,
    advise,
    count_studs,
    expected_studs,
    stud_radius_px,
)

DATA = Path(__file__).parent / "data"


def _ident(part_id, name, score, candidates=()):
    return Identification(part_id, name, None, score, candidates=candidates)


def _dark_grid(rows, cols, *, radius=11):
    spacing = radius * 3
    pad = radius * 3
    height = pad * 2 + max(0, rows - 1) * spacing
    width = pad * 2 + max(0, cols - 1) * spacing
    image = np.full((height, width, 3), 238, dtype=np.uint8)
    mask = np.zeros((height, width), dtype=np.uint8)
    cv2.rectangle(mask, (radius, radius),
                  (width - radius - 1, height - radius - 1), 255, -1)
    image[mask > 0] = (34, 34, 34)
    for row in range(rows):
        for col in range(cols):
            center = (pad + col * spacing, pad + row * spacing)
            cv2.circle(image, center, radius, (50, 50, 50), -1)
            cv2.circle(image, center, radius, (15, 15, 15), 2)
            cv2.circle(image, (center[0] - 2, center[1] - 2),
                       max(1, radius // 4), (78, 78, 78), -1)
    return image, mask


# --- expected_studs -------------------------------------------------------

def test_expected_studs_parses_n_x_m():
    assert expected_studs("Brick 1 x 8") == 8
    assert expected_studs("Plate 6 x 12") == 72
    assert expected_studs("Plate 2 x 3") == 6
    assert expected_studs("Brick 2 x 2") == 4


def test_expected_studs_unparseable_is_none():
    assert expected_studs("unknown brick") is None
    assert expected_studs("Wedge, Plate 2 x 2  Cut Corner") == 4  # still N x M
    assert expected_studs("Minifig Head") is None


# --- stud_radius_px -------------------------------------------------------

def test_stud_radius_scales_with_homography():
    # canvas at 2 px/mm; original 3x larger: stud (4.8 mm dia) -> r=14.4 px
    r = stud_radius_px(canvas_box=(0, 0, 100, 50),
                       box_original=(0, 0, 300, 150), px_per_m=2000.0)
    assert r == pytest.approx(14.4, rel=0.05)


# --- count_studs ----------------------------------------------------------

def test_count_studs_synthetic_grid():
    img = np.full((300, 400, 3), 200, dtype=np.uint8)
    for row in range(4):
        for col in range(6):
            cv2.circle(img, (50 + col * 55, 45 + row * 65), 18, (150, 150, 150),
                       -1)
            cv2.circle(img, (50 + col * 55, 45 + row * 65), 18, (90, 90, 90), 2)
    count = count_studs(img, radius_px=18)
    assert 20 <= count <= 28  # 24 studs, Hough slack


def test_count_studs_real_6x12_plate_is_large():
    img = cv2.imread(str(DATA / "plate_6x12_gray.png"))
    count = count_studs(img, radius_px=21.0)
    assert count >= 25  # 72 studs; undercounting is fine, magnitude matters


def test_count_studs_real_1x8_beam_not_contradicting():
    img = cv2.imread(str(DATA / "brick_1x8_orange.png"))
    count = count_studs(img, radius_px=30.0)
    assert count < 24  # < 3x its 8 studs: must not contradict the true ID


def test_count_studs_blank_image_is_zero_or_tiny():
    img = np.full((200, 200, 3), 230, dtype=np.uint8)
    assert count_studs(img, radius_px=15) <= 2


def test_dark_2x12_grid_uses_enhanced_variants():
    image, mask = _dark_grid(2, 12)

    evidence = analyze_studs(image, radius_px=11, mask=mask)

    assert evidence.is_dark
    assert 18 <= evidence.count <= 30
    assert evidence.visibility == "stud_face"
    assert evidence.reliability in {"high", "medium"}
    assert {variant.name for variant in evidence.variants} == {
        "clahe", "gamma_clahe"
    }


def test_dark_2x2_does_not_hallucinate_large_grid():
    image, mask = _dark_grid(2, 2)

    evidence = analyze_studs(image, radius_px=11, mask=mask)

    assert evidence.is_dark
    assert evidence.count <= 8


def test_side_view_without_stud_edges_is_not_reliable_negative_evidence():
    image = np.full((120, 220, 3), 238, dtype=np.uint8)
    mask = np.zeros((120, 220), dtype=np.uint8)
    mask[35:85, 20:200] = 255
    image[mask > 0] = (32, 32, 32)

    evidence = analyze_studs(image, radius_px=11, mask=mask)

    assert evidence.count < 4
    assert evidence.visibility != "stud_face"
    assert evidence.reliability in {"low", "unavailable"}


def test_transitional_dark_piece_uses_multiple_variants():
    image, mask = _dark_grid(2, 12)
    adjusted = image.astype(np.int16)
    adjusted[mask > 0] += 22
    image = np.clip(adjusted, 0, 255).astype(np.uint8)

    evidence = analyze_studs(image, radius_px=11, mask=mask)

    assert 50 <= evidence.median_luma <= 80
    assert len(evidence.variants) >= 2


def test_one_plausible_variant_is_not_high_reliability(monkeypatch):
    import pipeline.studs as studs

    centers = iter((
        ((30.0, 30.0), (60.0, 30.0),
         (30.0, 60.0), (60.0, 60.0)),
        (),
    ))
    monkeypatch.setattr(
        studs, "_hough_centers", lambda *args: next(centers)
    )
    image = np.full((100, 100, 3), 100, dtype=np.uint8)
    mask = np.ones((100, 100), dtype=np.uint8)

    evidence = analyze_studs(image, 10, mask)

    assert evidence.reliability != "high"


def _stud_evidence(count, reliability="high"):
    return StudEvidence(
        count=count,
        reliability=reliability,
        visibility="stud_face",
        is_dark=True,
        median_luma=40.0,
        variants=(),
        reason="fixture",
    )


def test_one_usable_view_is_medium_consensus_at_most():
    consensus = aggregate_stud_evidence([_stud_evidence(24)])

    assert consensus.count == 24
    assert consensus.reliability == "medium"


def test_two_agreeing_views_make_high_stud_consensus():
    consensus = aggregate_stud_evidence([
        _stud_evidence(23), _stud_evidence(25, "medium")
    ])

    assert consensus.count == 24
    assert consensus.reliability == "high"


def test_conflicting_views_make_low_stud_consensus():
    consensus = aggregate_stud_evidence([
        _stud_evidence(8), _stud_evidence(24)
    ])

    assert consensus.reliability == "low"


# --- advise ---------------------------------------------------------------

def _cands(*triples):
    return tuple({"part_id": p, "name": n, "score": s} for p, n, s in triples)


def test_advise_skips_on_unreliable_count():
    ident = _ident("3007", "Brick 2 x 8", 0.795)
    out, action = advise(ident, stud_count=1)
    assert out is ident and action == "skipped"


def test_advise_does_not_demote_low_reliability_dark_undercount():
    ident = _ident("2445", "Plate 2 x 12", 0.8905)
    evidence = StudEvidence(
        count=4,
        reliability="low",
        visibility="partial",
        is_dark=True,
        median_luma=34.0,
        variants=(),
        reason="preprocessing variants disagree",
    )

    out, action = advise(ident, evidence)

    assert out is ident
    assert action == "unreliable"


def test_advise_keeps_high_reliability_negative_evidence_bidirectional():
    ident = _ident("2445", "Plate 2 x 12", 0.85)
    evidence = StudEvidence(
        count=4,
        reliability="high",
        visibility="stud_face",
        is_dark=True,
        median_luma=34.0,
        variants=(),
        reason="stable visible grid",
    )

    out, action = advise(ident, evidence)

    assert out.part_id is None
    assert action == "demoted"


def test_advise_never_overrides_high_confidence():
    ident = _ident("3028", "Plate 6 x 12", 0.92)
    out, action = advise(ident, stud_count=8)  # wildly contradicting count
    assert out is ident and action == "high-confidence"


def test_advise_keeps_compatible_id():
    ident = _ident("3028", "Plate 6 x 12", 0.83)
    out, action = advise(ident, stud_count=53)  # 53 vs 72: within band
    assert out is ident and action == "compatible"


def test_advise_corrects_contradicted_id_to_matching_candidate():
    # 16 counted vs Brick 2 x 8's 16: wait — contradiction needs 3x.
    # 30 counted vs Brick 1 x 8 (8): contradicted; Plate 6 x 12 (72) fits.
    ident = _ident("3008", "Brick 1 x 8", 0.79, candidates=_cands(
        ("3008", "Brick 1 x 8", 0.79), ("3028", "Plate 6 x 12", 0.55)))
    out, action = advise(ident, stud_count=30)
    assert out.part_id == "3028" and action == "corrected"


def test_advise_demotes_contradicted_id_without_alternative():
    ident = _ident("3008", "Brick 1 x 8", 0.79, candidates=_cands(
        ("3008", "Brick 1 x 8", 0.79), ("3460", "Plate 1 x 8", 0.51)))
    out, action = advise(ident, stud_count=75)  # contradicts both
    assert out.part_id is None and out.name == "unknown brick"
    assert action == "demoted"


def test_advise_rescues_below_threshold_when_studs_confirm():
    # Unknown (score 0.65 < 0.7) but the top candidate's stud count fits.
    ident = _ident(None, "unknown brick", 0.65, candidates=_cands(
        ("3002", "Brick 2 x 3", 0.65), ("3021", "Plate 2 x 3", 0.60)))
    out, action = advise(ident, stud_count=6)
    assert out.part_id == "3002" and action == "rescued"


def test_advise_does_not_rescue_on_contradicting_count():
    ident = _ident(None, "unknown brick", 0.65, candidates=_cands(
        ("3002", "Brick 2 x 3", 0.65),))
    out, action = advise(ident, stud_count=40)  # 40 vs 6: contradicts
    assert out.part_id is None and action in ("no-rescue", "skipped")
