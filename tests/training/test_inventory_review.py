import json

import pytest

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
