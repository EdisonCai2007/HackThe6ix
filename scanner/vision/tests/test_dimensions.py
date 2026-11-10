import pytest

from pipeline.dimensions import (
    parse_regular_dimensions,
    resolve_dimensions,
)
from pipeline.footprint import MetricSilhouette
from pipeline.identify import Identification


def _metric(short_mm, long_mm, reliability="high"):
    return MetricSilhouette(
        short_mm=short_mm,
        long_mm=long_mm,
        reliability=reliability,
        measurements=(),
        used_frame_ids=(1, 2),
        rejected_frame_ids=(),
        spread_mm=(1.0, 1.0),
        reason="fixture",
    )


def _candidate(part_id, name, score):
    return {"part_id": part_id, "name": name, "score": score}


def _ident(part_id, name, score=0.8, candidates=()):
    return Identification(
        part_id, name, None, score, candidates=tuple(candidates)
    )


def test_parser_accepts_only_regular_brick_and_plate_names():
    brick = parse_regular_dimensions("Brick 2 x 3")
    plate = parse_regular_dimensions("Plate 12 x 2")

    assert brick.kind == "Brick"
    assert brick.studs == (2, 3)
    assert brick.dimensions_mm == pytest.approx((15.8, 23.8))
    assert plate.kind == "Plate"
    assert plate.studs == (2, 12)
    assert parse_regular_dimensions("Wedge, Plate 2 x 3") is None
    assert parse_regular_dimensions("Brick 2 x 3 with Axle Hole") is None


def test_rotation_is_naturally_supported_by_sorted_dimensions():
    ident = _ident("3002", "Brick 2 x 3")

    decision = resolve_dimensions(ident, _metric(23.9, 15.9))

    assert decision.identification is ident
    assert decision.action == "compatible"
    assert decision.flag is None


def test_low_reliability_measurement_cannot_change_identification():
    ident = _ident("3622", "Brick 1 x 3", candidates=(
        _candidate("3622", "Brick 1 x 3", 0.78),
        _candidate("3002", "Brick 2 x 3", 0.60),
    ))

    decision = resolve_dimensions(
        ident, _metric(17.5, 28.5, reliability="low")
    )

    assert decision.identification is ident
    assert decision.action == "insufficient_metric_evidence"
    assert decision.flag is None


def test_high_reliability_can_choose_supplied_better_fitting_candidate():
    ident = _ident("3622", "Brick 1 x 3", 0.78, candidates=(
        _candidate("3622", "Brick 1 x 3", 0.78),
        _candidate("3002", "Brick 2 x 3", 0.60),
    ))

    decision = resolve_dimensions(ident, _metric(17.5, 24.0))

    assert decision.identification.part_id == "3002"
    assert decision.action == "corrected"
    assert decision.flag is None


def test_all_candidate_mismatch_keeps_raw_and_flags_pose():
    ident = _ident("3622", "Brick 1 x 3", 0.77, candidates=(
        _candidate("3622", "Brick 1 x 3", 0.77),
    ))

    decision = resolve_dimensions(ident, _metric(17.5, 28.5))

    assert decision.identification is ident
    assert decision.action == "flagged"
    assert decision.flag in {
        "dimension_mismatch", "possible_non_canonical_pose"
    }
    assert decision.proposed_family == "2 x 3"


def test_dimensions_do_not_invent_plate_or_brick_for_unknown():
    ident = _ident(None, "unknown brick", 0.45)

    decision = resolve_dimensions(ident, _metric(17.0, 24.0))

    assert decision.identification is ident
    assert decision.action == "unmodeled_candidate"
    assert decision.proposed_family == "2 x 3"


def test_medium_reliability_can_flag_but_not_rerank():
    ident = _ident("3622", "Brick 1 x 3", 0.78, candidates=(
        _candidate("3622", "Brick 1 x 3", 0.78),
        _candidate("3002", "Brick 2 x 3", 0.60),
    ))

    decision = resolve_dimensions(
        ident, _metric(17.5, 24.0, reliability="medium")
    )

    assert decision.identification is ident
    assert decision.action == "flagged"
    assert decision.flag == "dimension_mismatch"


def test_projection_tolerance_keeps_audited_regular_plates_compatible():
    dark_blue = resolve_dimensions(
        _ident("3029", "Plate 4 x 12"), _metric(42.3, 102.9)
    )
    light_blue = resolve_dimensions(
        _ident("3028", "Plate 6 x 12"), _metric(54.4, 106.4)
    )

    assert dark_blue.action == "compatible"
    assert light_blue.action == "compatible"
