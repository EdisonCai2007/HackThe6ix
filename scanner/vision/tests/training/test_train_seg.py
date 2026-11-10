import json
from pathlib import Path

import pytest
import yaml

from training.train_seg import (
    TrainingConfig,
    inspect_training_csv,
    verified_dataset_preflight,
)


def _dataset(tmp_path: Path, *, verified=True, leak=False):
    root = tmp_path / "lego-seg-abcdef123456"
    root.mkdir()
    (root / "data.yaml").write_text(yaml.safe_dump({
        "path": str(root.resolve()),
        "train": "images/train",
        "val": "images/val",
        "test": "images/test",
        "names": {0: "lego_piece"},
    }))
    metadata = {
        "dataset_sha256": "abcdef123456" + "0" * 52,
        "require_verified": verified,
        "class_names": ["lego_piece"],
        "counts": {"train": 2, "val": 1, "test": 1},
        "sessions_by_split": {
            "train": ["session_train"],
            "val": ["session_train" if leak else "session_val"],
            "test": ["session_test"],
        },
    }
    (root / "dataset-metadata.json").write_text(json.dumps(metadata))
    return root / "data.yaml"


def test_smoke_defaults_to_yolo11n_seg_on_mps():
    config = TrainingConfig.smoke("data.yaml")

    assert config.model == "yolo11n-seg.pt"
    assert config.device == "mps"
    assert config.epochs <= 3
    assert config.fraction <= 0.25
    assert config.batch <= 4


def test_full_config_uses_all_verified_data():
    config = TrainingConfig.full("data.yaml")

    assert config.model == "yolo11n-seg.pt"
    assert config.device == "mps"
    assert config.fraction == 1.0
    assert config.epochs >= 50


def test_preflight_accepts_verified_one_class_session_split(tmp_path):
    data = _dataset(tmp_path)

    result = verified_dataset_preflight(data)

    assert result["dataset_sha256"].startswith("abcdef123456")
    assert result["counts"] == {"train": 2, "val": 1, "test": 1}


def test_preflight_rejects_unverified_dataset(tmp_path):
    data = _dataset(tmp_path, verified=False)

    with pytest.raises(ValueError, match="verified"):
        verified_dataset_preflight(data)


def test_preflight_rejects_session_leakage(tmp_path):
    data = _dataset(tmp_path, leak=True)

    with pytest.raises(ValueError, match="session leakage"):
        verified_dataset_preflight(data)


def test_training_csv_requires_finite_nonzero_segmentation_loss(tmp_path):
    csv_path = tmp_path / "results.csv"
    csv_path.write_text(
        "epoch,train/box_loss,train/seg_loss,val/seg_loss\n"
        "1,1.2,2.4,2.8\n"
        "2,1.0,2.0,2.5\n"
    )

    summary = inspect_training_csv(csv_path)

    assert summary["epochs_completed"] == 2
    assert summary["last"]["train/seg_loss"] == 2.0


@pytest.mark.parametrize("value", ["nan", "inf", "0"])
def test_training_csv_rejects_pathological_segmentation_loss(tmp_path, value):
    csv_path = tmp_path / "results.csv"
    csv_path.write_text(
        "epoch,train/box_loss,train/seg_loss,val/seg_loss\n"
        f"1,1.2,{value},2.8\n"
    )

    with pytest.raises(ValueError, match="segmentation loss"):
        inspect_training_csv(csv_path)
