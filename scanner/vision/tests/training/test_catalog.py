from pathlib import Path

import pytest
import yaml

from training.catalog import Catalog, SessionSpec, load_catalog


def test_catalog_excludes_empty_and_holds_out_white_environment():
    catalog = load_catalog(Path("training/catalog.yaml"))

    catalog.validate()

    empty = catalog.sessions["20260717-153911"]
    assert empty.split == "exclude"
    assert empty.reason == "zero_frames"
    assert empty.environment == "unknown"
    white = {
        session_id
        for session_id, spec in catalog.sessions.items()
        if spec.environment == "white_round"
    }
    assert white == {"20260717-153942", "20260717-155228"}
    assert {catalog.sessions[session_id].split for session_id in white} == {
        "test"
    }


def test_catalog_contains_every_new_session_exactly_once():
    catalog = load_catalog(Path("training/catalog.yaml"))
    expected = {
        "20260717-145941", "20260717-150212", "20260717-150350",
        "20260717-151014", "20260717-151357", "20260717-151611",
        "20260717-152048", "20260717-152202", "20260717-152340",
        "20260717-152458", "20260717-152721", "20260717-153020",
        "20260717-153200", "20260717-153313", "20260717-153423",
        "20260717-153911", "20260717-153942", "20260717-154428",
        "20260717-154929", "20260717-155228",
    }

    actual = {
        session_id
        for session_id, spec in catalog.sessions.items()
        if spec.cohort == "phase3_new"
    }

    assert actual == expected


def test_catalog_rejects_training_member_of_held_out_environment():
    catalog = Catalog(
        version=1,
        held_out_environment="white_round",
        sessions={
            "session": SessionSpec(
                environment="white_round",
                split="train",
                target_frames=2,
                provenance="custom_record3d",
                cohort="phase3_new",
            )
        },
    )

    with pytest.raises(ValueError, match="held-out environment"):
        catalog.validate()


@pytest.mark.parametrize(
    ("split", "target_frames", "reason", "message"),
    [
        ("other", 2, None, "split"),
        ("train", 0, None, "target_frames"),
        ("exclude", 0, None, "reason"),
    ],
)
def test_catalog_rejects_invalid_session_spec(
    split, target_frames, reason, message
):
    catalog = Catalog(
        version=1,
        held_out_environment=None,
        sessions={
            "session": SessionSpec(
                environment="wood",
                split=split,
                target_frames=target_frames,
                provenance="custom_record3d",
                cohort="phase3_new",
                reason=reason,
            )
        },
    )

    with pytest.raises(ValueError, match=message):
        catalog.validate()


def test_load_catalog_rejects_unknown_top_level_field(tmp_path):
    path = tmp_path / "catalog.yaml"
    path.write_text(yaml.safe_dump({
        "version": 1,
        "held_out_environment": None,
        "unexpected": True,
        "sessions": {},
    }))

    with pytest.raises(ValueError, match="unknown catalog fields"):
        load_catalog(path)
