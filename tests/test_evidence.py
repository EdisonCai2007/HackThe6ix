from pipeline.identify import Identification


def _ident(part_id, name, score):
    return Identification(part_id, name, None, score)


def test_stud_only_correction_is_preserved_as_conflict():
    from pipeline.evidence import arbitrate_identification

    outcome = arbitrate_identification(
        current=_ident("2445", "Plate 2 x 12", 0.868),
        dimension_action="compatible",
        stud_proposal=_ident(
            "32064", "Technic Brick 1 x 12", 0.502
        ),
        stud_action="corrected",
        identity_support={"32064": 0},
    )

    assert outcome.identification.part_id == "2445"
    assert outcome.action == "conflict_preserved"
    assert outcome.supporting_categories == ("stud",)


def test_stud_cannot_demote_without_an_identity_alternative():
    from pipeline.evidence import arbitrate_identification

    current = _ident("2445", "Plate 2 x 12", 0.868)
    outcome = arbitrate_identification(
        current=current,
        dimension_action="flagged",
        stud_proposal=_ident(None, "unknown brick", 0.868),
        stud_action="demoted",
        identity_support={},
    )

    assert outcome.identification is current
    assert outcome.action == "conflict_preserved"


def test_stud_and_two_view_identity_support_can_correct_unprotected_raw():
    from pipeline.evidence import arbitrate_identification

    outcome = arbitrate_identification(
        current=_ident("3008", "Brick 1 x 8", 0.79),
        dimension_action="flagged",
        stud_proposal=_ident("3028", "Plate 6 x 12", 0.75),
        stud_action="corrected",
        identity_support={"3028": 2},
    )

    assert outcome.identification.part_id == "3028"
    assert outcome.action == "corrected"
    assert outcome.supporting_categories == (
        "stud", "multi_view_identity"
    )


def test_high_reliability_metric_rejection_protects_current_identity():
    from pipeline.evidence import arbitrate_identification

    current = _ident("3008", "Brick 1 x 8", 0.79)
    outcome = arbitrate_identification(
        current=current,
        dimension_action="flagged",
        dimension_evidence={
            "evidence": {"reliability": "high"},
            "decision": {
                "candidate_scores": [{
                    "part_id": "3028",
                    "name": "Plate 6 x 12",
                    "modeled": True,
                    "fits": False,
                }],
            },
        },
        stud_proposal=_ident("3028", "Plate 6 x 12", 0.75),
        stud_action="corrected",
        identity_support={"3028": 2},
    )

    assert outcome.identification is current
    assert outcome.action == "conflict_preserved"
    assert outcome.reason == (
        "high-reliability metric evidence rejects the proposed identity"
    )


def test_compatible_stud_evidence_leaves_identity_unchanged():
    from pipeline.evidence import arbitrate_identification

    current = _ident("3002", "Brick 2 x 3", 0.84)
    outcome = arbitrate_identification(
        current=current,
        dimension_action="compatible",
        stud_proposal=current,
        stud_action="compatible",
        identity_support={"3002": 2},
    )

    assert outcome.identification is current
    assert outcome.action == "compatible"


def test_appearance_support_counts_only_each_frames_top_raw_hypothesis():
    from pipeline.evidence import aggregate_appearance_support

    entries = [
        {
            "frame_id": 35, "part_id": None, "name": "unknown brick",
            "score": 0.615,
            "candidates": [
                {"part_id": "3001", "name": "Brick 2 x 4", "score": 0.615},
                {"part_id": "39789", "name": "Technic, Brick 2 x 4 with 3 Axle Holes", "score": 0.600},
            ],
        },
        {
            "frame_id": 54, "part_id": None, "name": "unknown brick",
            "score": 0.687,
            "candidates": [
                {"part_id": "3001", "name": "Brick 2 x 4", "score": 0.687},
                {"part_id": "39789", "name": "Technic, Brick 2 x 4 with 3 Axle Holes", "score": 0.578},
            ],
        },
        {
            "frame_id": 263, "part_id": None, "name": "unknown brick",
            "score": 0.699,
            "candidates": [
                {"part_id": "39789", "name": "Technic, Brick 2 x 4 with 3 Axle Holes", "score": 0.699},
            ],
        },
    ]

    result = aggregate_appearance_support(entries)

    assert result["unique_top_candidate"] == "3001"
    assert result["unique_top_count"] == 2
    assert result["candidate_support"]["3001"]["weak_frame_ids"] == [35, 54]
    assert result["candidate_support"]["39789"]["weak_frame_ids"] == [263]
    assert result["candidate_support"]["39789"]["alternative_frame_ids"] == [35, 54]


def test_appearance_support_separates_accepted_and_weak_frames():
    from pipeline.evidence import aggregate_appearance_support

    result = aggregate_appearance_support([
        {
            "frame_id": 1, "part_id": "3001", "name": "Brick 2 x 4",
            "score": 0.81,
            "candidates": [
                {"part_id": "3001", "name": "Brick 2 x 4", "score": 0.81},
            ],
        },
        {
            "frame_id": 2, "part_id": None, "name": "unknown brick",
            "score": 0.64,
            "candidates": [
                {"part_id": "3001", "name": "Brick 2 x 4", "score": 0.64},
            ],
        },
    ])

    support = result["candidate_support"]["3001"]
    assert support["accepted_frame_ids"] == [1]
    assert support["weak_frame_ids"] == [2]
    assert support["top_frame_ids"] == [1, 2]
    assert support["best_score"] == 0.81


def test_appearance_support_tie_has_no_unique_top_candidate():
    from pipeline.evidence import aggregate_appearance_support

    result = aggregate_appearance_support([
        {
            "frame_id": 1, "part_id": None, "name": "unknown brick",
            "score": 0.65,
            "candidates": [
                {"part_id": "3001", "name": "Brick 2 x 4", "score": 0.65},
            ],
        },
        {
            "frame_id": 2, "part_id": None, "name": "unknown brick",
            "score": 0.66,
            "candidates": [
                {"part_id": "39789", "name": "Technic, Brick 2 x 4 with 3 Axle Holes", "score": 0.66},
            ],
        },
    ])

    assert result["unique_top_candidate"] is None
    assert result["unique_top_count"] == 1
