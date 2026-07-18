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
