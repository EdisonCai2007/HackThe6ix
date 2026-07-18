import json

import pytest

from training.acceptance import (
    AcceptancePiece,
    acceptance_report,
    load_acceptance,
    match_acceptance,
    worksheet_from_predictions,
)


def _piece(instance_id, anchor, *, verified=True):
    return AcceptancePiece(
        instance_id=instance_id,
        anchor_table_xy_m=anchor,
        expected_part_id="3001",
        expected_name="Brick 2 x 4",
        expected_color="red",
        pose="studs_up",
        user_verified=verified,
    )


def _prediction(instance_id, anchor, part_id="3001"):
    return {
        "instance_id": instance_id,
        "anchor_table_xy_m": list(anchor),
        "part_id": part_id,
        "name": "Brick 2 x 4",
        "color": "red",
    }


def test_anchor_matching_is_one_to_one_and_distance_guarded():
    expected = [_piece("a", (0.10, 0.10)), _piece("b", (0.12, 0.10))]
    predicted = [
        _prediction("p", (0.101, 0.10)),
        _prediction("far", (0.80, 0.80)),
    ]

    matches = match_acceptance(expected, predicted, max_distance_m=0.03)

    assert [(m.expected_id, m.predicted_id) for m in matches.matches] == [
        ("a", "p")
    ]
    assert matches.unmatched_expected == ("b",)
    assert matches.unmatched_predicted == ("far",)


def test_unverified_entries_are_never_scored_as_ground_truth():
    report = acceptance_report(
        [_piece("review", (0.1, 0.1), verified=False)],
        [_prediction("p", (0.1, 0.1))],
    )

    assert report["verified_piece_count"] == 0
    assert report["part_accuracy"] is None
    assert report["review_required"] == ["review"]


def test_verified_report_scores_matches_and_reports_unmatched():
    report = acceptance_report(
        [_piece("correct", (0.1, 0.1)), _piece("missed", (0.5, 0.5))],
        [_prediction("p", (0.101, 0.1)), _prediction("extra", (0.9, 0.9))],
    )

    assert report["verified_piece_count"] == 2
    assert report["matched_verified_count"] == 1
    assert report["part_accuracy"] == pytest.approx(1.0)
    assert report["unmatched_expected"] == ["missed"]
    assert report["unmatched_predicted"] == ["extra"]


def test_load_acceptance_validates_pose_and_anchor(tmp_path):
    path = tmp_path / "acceptance.json"
    payload = {
        "session_id": "session",
        "pieces": [{
            "instance_id": "piece-000",
            "anchor_table_xy_m": [0.1, 0.2],
            "expected_part_id": None,
            "expected_name": None,
            "expected_color": None,
            "pose": "diagonal",
            "user_verified": False,
            "note": "",
        }],
    }
    path.write_text(json.dumps(payload))

    with pytest.raises(ValueError, match="pose"):
        load_acceptance(path)


def test_worksheet_marks_every_generated_row_unverified():
    worksheet = worksheet_from_predictions(
        "20260717-202103",
        [_prediction("piece-000", (0.1, 0.2))],
    )

    assert worksheet["session_id"] == "20260717-202103"
    assert worksheet["pieces"][0]["user_verified"] is False
    assert worksheet["pieces"][0]["expected_part_id"] == "3001"
