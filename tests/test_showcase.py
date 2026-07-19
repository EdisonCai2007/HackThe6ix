"""Showcase funnel: conservative selection of the safest identified pieces."""
from __future__ import annotations

from pipeline.showcase import (
    SAFE_MIN_MARGIN,
    SAFE_MIN_TOP1,
    ShowcaseCandidate,
    build_showcase,
    select_showcase,
)


def _cand(instance_id, *, part_id="3001", name="Brick 2 x 4", top1=0.92,
          top2=0.30, agreement=2, num_views=4, seg=0.95, complete=True,
          boundary=False, area=40000, instance_flags=(), view_flags=(),
          color="red", color_reliable=True):
    return ShowcaseCandidate(
        instance_id=instance_id, part_id=part_id, part_name=name,
        top1_score=top1, top2_score=top2, agreement=agreement,
        num_views=num_views, seg_confidence=seg, complete=complete,
        boundary_zone=boundary, crop_area_px=area, focus=10.0,
        instance_flags=tuple(instance_flags), view_flags=tuple(view_flags),
        color=color, color_reliable=color_reliable,
    )


def test_clean_multiview_piece_is_selected():
    out = select_showcase([_cand(0)], n=5)
    assert out["selected_count"] == 1
    piece = out["selected"][0]
    assert piece["instance_id"] == 0
    assert piece["part_name"] == "Brick 2 x 4"
    # Question is part-only; colour rides along separately.
    assert "Brick 2 x 4" in piece["question"]
    assert "red" not in piece["question"]
    assert piece["color"] == "red"
    assert piece["selection_reasons"]


def test_identity_disagreement_is_hard_veto():
    out = select_showcase(
        [_cand(0, instance_flags=["identity_view_disagreement"])], n=5
    )
    assert out["selected_count"] == 0
    reject = out["rejected"][0]
    assert reject["stage"] == "prefilter"
    assert "flag:identity_view_disagreement" in reject["rejection_reasons"]


def test_dimension_mismatch_and_non_canonical_are_vetoes():
    for flag in ["dimension_mismatch", "possible_non_canonical_pose"]:
        out = select_showcase([_cand(0, instance_flags=[flag])], n=5)
        assert out["selected_count"] == 0, flag


def test_boundary_and_incomplete_crops_vetoed():
    assert select_showcase([_cand(0, boundary=True)], n=5)["selected_count"] == 0
    assert select_showcase([_cand(0, complete=False)], n=5)["selected_count"] == 0


def test_shadow_specular_oblique_view_flags_vetoed():
    for flag in ["possible_shadow", "possible_specular", "oblique_view",
                 "boundary_view"]:
        out = select_showcase([_cand(0, view_flags=[flag])], n=5)
        assert out["selected_count"] == 0, flag


def test_unidentified_is_vetoed():
    out = select_showcase([_cand(0, part_id=None, name="unknown brick")], n=5)
    assert out["selected_count"] == 0
    assert "unidentified" in out["rejected"][0]["rejection_reasons"]


def test_family_reviewed_is_not_a_veto():
    # family_reviewed fires on nearly every piece; it must not disqualify.
    out = select_showcase([_cand(0, instance_flags=["family_reviewed"])], n=5)
    assert out["selected_count"] == 1


def test_view_diversity_unknown_is_not_a_veto():
    out = select_showcase(
        [_cand(0, instance_flags=["family_reviewed", "view_diversity_unknown"])],
        n=5,
    )
    assert out["selected_count"] == 1


def test_low_confidence_below_floor_rejected():
    out = select_showcase([_cand(0, top1=SAFE_MIN_TOP1 - 0.05)], n=5)
    assert out["selected_count"] == 0
    assert "low_confidence" in out["rejected"][0]["rejection_reasons"]


def test_low_margin_rejected():
    out = select_showcase([_cand(0, top1=0.85, top2=0.80)], n=5)  # margin 0.05
    assert out["selected_count"] == 0
    assert "low_margin" in out["rejected"][0]["rejection_reasons"]


def test_single_view_needs_to_be_exceptional():
    # Ordinary single-view (agreement 1) at a normal score is rejected...
    ordinary = select_showcase(
        [_cand(0, agreement=1, num_views=1, top1=0.85, top2=0.40)], n=5
    )
    assert ordinary["selected_count"] == 0
    assert "single_view_not_exceptional" in ordinary["rejected"][0][
        "rejection_reasons"
    ]
    # ...but an exceptional single clean view still qualifies (we don't make
    # >=2 views mandatory).
    exceptional = select_showcase(
        [_cand(0, agreement=1, num_views=1, top1=0.94, top2=0.20)], n=5
    )
    assert exceptional["selected_count"] == 1


def test_low_yolo_confidence_rejected():
    out = select_showcase([_cand(0, seg=0.30)], n=5)
    assert out["selected_count"] == 0
    assert "low_seg_confidence" in out["rejected"][0]["rejection_reasons"]


def test_cv_detector_none_confidence_not_auto_rejected():
    # No YOLO confidence (classical detector) must not be treated as low.
    out = select_showcase([_cand(0, seg=None)], n=5)
    assert out["selected_count"] == 1


def test_returns_fewer_than_n_when_only_some_are_safe():
    cands = [
        _cand(0),  # safe
        _cand(1, instance_flags=["dimension_mismatch"]),  # veto
        _cand(2, top1=0.72),  # low confidence
        _cand(3),  # safe
    ]
    out = select_showcase(cands, n=5)
    assert out["selected_count"] == 2
    assert {p["instance_id"] for p in out["selected"]} == {0, 3}


def test_caps_at_n_and_records_below_cut_survivors():
    # Six clean pieces, ask for 3: exactly 3 selected, 3 recorded below_cut.
    cands = [_cand(i, top1=0.80 + i * 0.02, top2=0.2) for i in range(6)]
    out = select_showcase(cands, n=3)
    assert out["selected_count"] == 3
    below = [r for r in out["rejected"] if r["stage"] == "below_cut"]
    assert len(below) == 3
    # Highest-safety pieces win (top1 increases with i, margin equal).
    assert {p["instance_id"] for p in out["selected"]} == {3, 4, 5}


def test_margin_ranks_above_raw_score():
    # Piece A: very high score, tiny margin. Piece B: lower score, big margin.
    a = _cand(0, top1=0.95, top2=0.86)  # margin 0.09 -> below floor, rejected
    b = _cand(1, top1=0.83, top2=0.20)  # margin 0.63
    out = select_showcase([a, b], n=1)
    assert out["selected_count"] == 1
    assert out["selected"][0]["instance_id"] == 1


def test_rejected_audit_sorted_strongest_first():
    cands = [
        _cand(0, top1=0.72, name="weak"),  # low conf, weak
        _cand(1, top1=0.91, instance_flags=["identity_view_disagreement"]),
    ]
    out = select_showcase(cands, n=5)
    # Strongest near-miss (0.91) is listed before the obviously-weak 0.72.
    assert out["rejected"][0]["top1_score"] == 0.91


def test_zero_selected_is_valid():
    out = select_showcase(
        [_cand(0, instance_flags=["dimension_mismatch"])], n=5
    )
    assert out["selected_count"] == 0
    assert out["selected"] == []


# --- build_showcase over a result-like object -----------------------------

class _Obs:
    def __init__(self, frame_id, complete=True, focus=10.0, color_evidence=None):
        self.frame_id = frame_id
        self.complete = complete
        self.identification_focus = focus
        self.color_evidence = color_evidence
        self.box = (10, 10, 90, 70)


class _Inst:
    def __init__(self, observations, best):
        self.observations = observations
        self.best = best


class _Result:
    def __init__(self, instances, id_crops):
        self.instances = instances
        self.id_crops = id_crops


def test_build_showcase_extracts_real_signals():
    best = _Obs(111, complete=True, color_evidence={"flags": []})
    inst = _Inst([best, _Obs(10)], best)
    id_crop = {
        "brickognize": {"part_id": "3001", "name": "Brick 2 x 4", "score": 0.9},
        "brickognize_raw": {"candidates": [
            {"part_id": "3001", "name": "Brick 2 x 4", "score": 0.9},
            {"part_id": "3002", "name": "Brick 2 x 3", "score": 0.4},
        ]},
        "identity_support": {"3001": 2},
        "segmentation_confidence": 0.95,
        "gate": {"boundary_zone": False},
        "frame_id": 111,
        "rgb": "frames/00111.rgb.jpg",
        "box_original": [100, 120, 300, 260],
        "source": "original-masked",
        "flags": ["family_reviewed"],
    }
    result = _Result([inst], [id_crop])
    out = build_showcase(result, n=5, colors=["red"])
    assert out["selected_count"] == 1
    piece = out["selected"][0]
    assert piece["part_id"] == "3001"
    assert piece["margin"] == 0.5  # 0.9 - 0.4
    assert piece["agreement"] == 2
    assert piece["seg_confidence"] == 0.95
    assert piece["rgb"] == "frames/00111.rgb.jpg"
    assert piece["box_original"] == [100, 120, 300, 260]


def test_build_showcase_chosen_view_flag_vetoes():
    # The user-visible crop's own view is shadowed -> veto.
    best = _Obs(111, color_evidence={"flags": ["possible_shadow"]})
    inst = _Inst([best], best)
    id_crop = {
        "brickognize": {"part_id": "3001", "name": "Brick 2 x 4", "score": 0.9},
        "brickognize_raw": {"candidates": [
            {"part_id": "3001", "name": "Brick 2 x 4", "score": 0.9}]},
        "identity_support": {"3001": 1},
        "segmentation_confidence": 0.95,
        "gate": {"boundary_zone": False},
        "frame_id": 111, "box_original": [0, 0, 200, 200], "flags": [],
    }
    out = build_showcase(_Result([inst], [id_crop]), n=5, colors=["red"])
    assert out["selected_count"] == 0
    assert "crop_flag:possible_shadow" in out["rejected"][0]["rejection_reasons"]
