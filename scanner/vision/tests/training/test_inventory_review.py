import json

import pytest

import training.inventory_review as review_module

from training.inventory_review import (
    add_manual_piece,
    aggregate_documents,
    apply_component_review,
    atomic_write_json,
    lock_document,
    new_review_document,
    reconciliation,
)


def _component(component_id, part_id="3001", name="Brick 2 x 4",
               color="blue"):
    return {
        "component_id": component_id,
        "prediction": {
            "part_id": part_id,
            "part_name": name,
            "color": color,
        },
        "candidates": [],
        "assets": {},
    }


def _confirm(document, component_id, **updates):
    patch = {
        "confirmed": True,
        "part_id": "3001",
        "part_name": "Brick 2 x 4",
        "color": "blue",
        "included": True,
        "exclusion_reason": None,
        "segmentation": "correct",
    }
    patch.update(updates)
    return apply_component_review(document, component_id, patch)


def _anchored_component(component_id, box, *, frame_id=2, **kwargs):
    row = _component(component_id, **kwargs)
    row["source_anchor"] = {
        "frame_id": frame_id,
        "shape_id": f"{frame_id:05d}:{component_id}",
        "box_original": list(box),
    }
    return row


def test_new_review_document_keeps_prediction_separate_from_review():
    document = new_review_document("session-a", 1, [_component("piece-000")])

    row = document["components"][0]
    assert row["prediction"]["part_id"] == "3001"
    assert row["review"] == {
        "confirmed": False,
        "part_id": "3001",
        "part_name": "Brick 2 x 4",
        "color": "blue",
        "included": True,
        "exclusion_reason": None,
        "segmentation": "unreviewed",
    }


def test_reconciliation_distinguishes_exclusion_from_duplicate_detection():
    document = new_review_document(
        "session-a", 2,
        [_component("piece-000"), _component("piece-001"),
         _component("piece-002")],
    )
    _confirm(document, "piece-000")
    _confirm(
        document, "piece-001", included=False,
        exclusion_reason="not in demo bank", part_id="", part_name="",
        color="",
    )
    _confirm(
        document, "piece-002", included=False,
        segmentation="duplicate", exclusion_reason="duplicate detection",
        part_id="", part_name="", color="",
    )

    assert reconciliation(document) == {
        "expected": 2,
        "segmentations_total": 3,
        "segmentations_active": 2,
        "segmentations_removed": 1,
        "accounted_physical": 2,
        "included": 1,
        "excluded": 1,
        "duplicates": 1,
        "manual_missed": 0,
        "unresolved": 0,
        "reconciled": True,
    }


def test_manual_missed_piece_can_close_a_detection_shortfall():
    document = new_review_document("session-a", 2, [_component("piece-000")])
    _confirm(document, "piece-000")
    manual = add_manual_piece(
        document, part_id="3003", part_name="Brick 2 x 2",
        color="white", included=True,
    )

    assert manual["manual_id"] == "manual-000"
    assert reconciliation(document)["reconciled"] is True
    assert reconciliation(document)["manual_missed"] == 1


def test_add_waypoint_promotes_one_source_frame_candidate_once():
    document = new_review_document("session-a", 2, [_component("primary")])
    secondary = _component("secondary-frame-2-shape-1")
    secondary["source_anchor"] = {
        "frame_id": 2,
        "box_original": [1, 2, 11, 12],
    }
    document["waypoint_pool"] = [{
        "waypoint_id": "frame-2-shape-1",
        "component": secondary,
    }]

    row = review_module.add_waypoint_component(
        document, "frame-2-shape-1"
    )

    assert row["component_id"] == "secondary-frame-2-shape-1"
    assert row["source_anchor"]["frame_id"] == 2
    assert row["review"]["confirmed"] is False
    assert document["waypoint_pool"][0]["component"].get("review") is None
    with pytest.raises(ValueError, match="already added"):
        review_module.add_waypoint_component(document, "frame-2-shape-1")


def test_add_manual_waypoint_requires_a_unique_component_id():
    document = new_review_document("session-a", 2, [_component("primary")])
    manual = _component("manual-waypoint-000")
    manual["prediction"] = {
        "part_id": None,
        "part_name": "unknown brick",
        "color": "",
    }

    row = review_module.add_manual_waypoint_component(document, manual)

    assert row["review"]["confirmed"] is False
    assert row["review"]["segmentation"] == "missed"
    with pytest.raises(ValueError, match="unique"):
        review_module.add_manual_waypoint_component(document, manual)


def test_confirmed_missed_waypoint_counts_as_a_physical_piece():
    document = new_review_document("session-a", 1, [])
    manual = _component("manual-waypoint-000")
    review_module.add_manual_waypoint_component(document, manual)

    _confirm(document, "manual-waypoint-000", segmentation="missed")

    assert reconciliation(document)["accounted_physical"] == 1
    assert reconciliation(document)["unresolved"] == 0
    assert reconciliation(document)["reconciled"] is True


def test_overlap_candidates_are_same_frame_confirmed_included_and_stable():
    document = new_review_document(
        "session-a", 3,
        [
            _anchored_component("a", [0, 0, 100, 100], name="Brick 2 x 4"),
            _anchored_component("b", [10, 10, 50, 50], name="Plate 2 x 2"),
            _anchored_component("c", [200, 200, 240, 240]),
            _anchored_component("other-frame", [10, 10, 50, 50], frame_id=3),
        ],
    )
    for component_id in ("a", "b", "c", "other-frame"):
        _confirm(document, component_id)

    candidates = review_module.overlap_candidates(document)

    assert len(candidates) == 1
    assert candidates[0]["pair_key"] == "a::b"
    assert candidates[0]["frame_id"] == 2
    assert candidates[0]["iou"] == pytest.approx(0.16)
    assert candidates[0]["containment"] == pytest.approx(1.0)
    assert candidates[0]["a"]["part_name"] == "Brick 2 x 4"
    assert candidates[0]["b"]["part_name"] == "Brick 2 x 4"


def test_overlap_candidates_ignore_unconfirmed_excluded_and_duplicate_rows():
    document = new_review_document(
        "session-a", 1,
        [
            _anchored_component("kept", [0, 0, 100, 100]),
            _anchored_component("unconfirmed", [10, 10, 50, 50]),
            _anchored_component("excluded", [20, 20, 60, 60]),
            _anchored_component("duplicate", [30, 30, 70, 70]),
        ],
    )
    _confirm(document, "kept")
    _confirm(
        document, "excluded", included=False, exclusion_reason="not inventory",
        part_id="", part_name="", color="",
    )
    _confirm(
        document, "duplicate", included=False,
        exclusion_reason="duplicate detection", segmentation="duplicate",
        part_id="", part_name="", color="",
    )

    assert review_module.overlap_candidates(document) == []


def test_overlap_candidates_hide_pairs_previously_confirmed_separate():
    document = new_review_document(
        "session-a", 2,
        [
            _anchored_component("a", [0, 0, 100, 100]),
            _anchored_component("b", [10, 10, 50, 50]),
        ],
    )
    _confirm(document, "a")
    _confirm(document, "b")
    document["overlap_cleanup"] = {
        "decisions": [{"pair_key": "a::b", "action": "separate"}],
    }

    assert review_module.overlap_candidates(document) == []


def _confirmed_overlap_document():
    document = new_review_document(
        "session-a", 1,
        [
            _anchored_component("a", [0, 0, 100, 100]),
            _anchored_component("b", [10, 10, 50, 50]),
        ],
    )
    _confirm(document, "a", part_name="Brick 2 x 4", color="blue")
    _confirm(document, "b", part_name="Plate 2 x 2", color="red")
    return document


@pytest.mark.parametrize(
    ("action", "removed_id", "kept_id"),
    [("keep_a", "b", "a"), ("keep_b", "a", "b")],
)
def test_overlap_keep_decision_removes_only_other_record_and_audits_review(
    action, removed_id, kept_id,
):
    document = _confirmed_overlap_document()
    before = reconciliation(document)["accounted_physical"]

    decision = review_module.apply_overlap_decision(
        document, "a", "b", action
    )

    rows = {row["component_id"]: row for row in document["components"]}
    assert rows[kept_id]["review"]["included"] is True
    assert rows[removed_id]["review"]["segmentation"] == "duplicate"
    assert rows[removed_id]["review"]["included"] is False
    assert reconciliation(document)["accounted_physical"] == before - 1
    assert decision["removed_component_id"] == removed_id
    assert decision["removed_review"]["part_name"] in {
        "Brick 2 x 4", "Plate 2 x 2",
    }
    assert document["overlap_cleanup"]["decisions"] == [decision]


def test_overlap_separate_decision_persists_without_changing_count():
    document = _confirmed_overlap_document()
    before = reconciliation(document)

    decision = review_module.apply_overlap_decision(
        document, "a", "b", "separate"
    )

    assert decision["action"] == "separate"
    assert decision["removed_component_id"] is None
    assert review_module.overlap_candidates(document) == []
    assert reconciliation(document) == before


def test_overlap_decision_rejects_invalid_action_and_non_candidate():
    document = _confirmed_overlap_document()
    with pytest.raises(ValueError, match="invalid overlap action"):
        review_module.apply_overlap_decision(document, "a", "b", "delete_both")
    with pytest.raises(ValueError, match="not a current overlap candidate"):
        review_module.apply_overlap_decision(document, "a", "missing", "keep_a")


def test_lock_rejects_unconfirmed_merged_or_count_mismatch():
    unconfirmed = new_review_document("unconfirmed", 1, [_component("a")])
    with pytest.raises(ValueError, match="unresolved"):
        lock_document(unconfirmed)

    merged = new_review_document("merged", 1, [_component("a")])
    _confirm(merged, "a", segmentation="merged")
    with pytest.raises(ValueError, match="unresolved"):
        lock_document(merged)

    mismatch = new_review_document("mismatch", 2, [_component("a")])
    _confirm(mismatch, "a")
    with pytest.raises(ValueError, match="physical count"):
        lock_document(mismatch)


def test_review_validation_rejects_unknown_color_and_unexplained_exclusion():
    document = new_review_document("session-a", 1, [_component("a")])
    with pytest.raises(ValueError, match="inventory color"):
        _confirm(document, "a", color="lime")
    with pytest.raises(ValueError, match="exclusion reason"):
        _confirm(document, "a", included=False, exclusion_reason=None)


def test_included_piece_can_be_confirmed_and_exported_without_part_id():
    document = new_review_document("session-a", 1, [_component("a")])

    _confirm(document, "a", part_id="", part_name="Plate 2 x 16")
    lock_document(document)
    inventory, pieces, summary = aggregate_documents([document])

    assert inventory == [{
        "part_id": "",
        "name": "Plate 2 x 16",
        "color": "blue",
        "quantity": 1,
    }]
    assert pieces[0]["part_id"] == ""
    assert summary["included"] == 1


def test_aggregate_sums_only_locked_included_rows():
    first = new_review_document("first", 1, [_component("a")])
    _confirm(first, "a")
    lock_document(first)

    second = new_review_document(
        "second", 2,
        [_component("b"), _component("c", "3003", "Brick 2 x 2", "white")],
    )
    _confirm(second, "b")
    _confirm(
        second, "c", included=False, exclusion_reason="not in demo bank",
        part_id="", part_name="", color="",
    )
    lock_document(second)

    inventory, pieces, summary = aggregate_documents([first, second])
    assert inventory == [{
        "part_id": "3001",
        "name": "Brick 2 x 4",
        "color": "blue",
        "quantity": 2,
    }]
    assert len(pieces) == 3
    assert summary["included"] == 2
    assert summary["excluded"] == 1


def test_atomic_write_json_replaces_complete_document(tmp_path):
    path = tmp_path / "review.json"
    atomic_write_json(path, {"version": 1})
    atomic_write_json(path, {"version": 2, "rows": [1, 2]})

    assert json.loads(path.read_text()) == {"version": 2, "rows": [1, 2]}
    assert not list(tmp_path.glob("*.tmp"))
