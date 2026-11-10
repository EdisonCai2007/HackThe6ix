import json
from pathlib import Path

import cv2
import numpy as np
import pytest
import yaml

from training.build_dataset import build_dataset


VALID_LABEL = "0 0.1 0.1 0.8 0.1 0.8 0.8 0.1 0.8\n"


def _write_fixture(
    root: Path,
    review_status: str = "verified",
    leak: bool = False,
    invalid_label: bool = False,
):
    selected = root / "selected"
    images = selected / "images"
    labels = root / "labels"
    images.mkdir(parents=True)
    labels.mkdir()
    rows = []
    specs = [
        ("train_session", "train"),
        ("val_session", "val"),
        ("test_session", "test"),
    ]
    if leak:
        specs[1] = ("train_session", "val")
    for index, (session_id, split) in enumerate(specs):
        dataset_id = f"{session_id}__f{index:05d}"
        image_path = (images / f"{dataset_id}.jpg").resolve()
        image = np.full((80, 100, 3), 220 - index * 20, np.uint8)
        cv2.rectangle(image, (10, 10), (80, 65), (20, 30, 180), -1)
        cv2.imwrite(str(image_path), image)
        label_path = labels / f"{dataset_id}.txt"
        label_path.write_text(
            "0 0.1 0.1 1.2 0.1 0.8 0.8\n"
            if invalid_label and index == 0 else VALID_LABEL
        )
        (labels / f"{dataset_id}.review.json").write_text(json.dumps({
            "status": review_status,
            "annotation_source": "human" if review_status == "verified"
            else "sam2.1_s",
            "reviewer": "fixture" if review_status == "verified" else None,
        }))
        rows.append({
            "dataset_id": dataset_id,
            "source_session": session_id,
            "source_frame": index,
            "source_rgb": str(image_path),
            "selected_image": str(image_path),
            "environment": "wood" if split != "test" else "white_round",
            "split": split,
            "cohort": "phase3_new",
            "dataset_provenance": "custom_record3d",
            "annotation_status": "missing",
        })
    manifest = selected / "manifest.jsonl"
    manifest.write_text(
        "".join(json.dumps(row) + "\n" for row in rows)
    )
    return manifest, labels, root / "dataset"


def test_builder_refuses_unverified_labels(tmp_path):
    fixture = _write_fixture(tmp_path, review_status="unverified")

    with pytest.raises(ValueError, match="unverified"):
        build_dataset(*fixture, require_verified=True)


def test_builder_refuses_session_leakage(tmp_path):
    fixture = _write_fixture(tmp_path, leak=True)

    with pytest.raises(ValueError, match="session leakage"):
        build_dataset(*fixture)


def test_builder_refuses_invalid_polygon(tmp_path):
    fixture = _write_fixture(tmp_path, invalid_label=True)

    with pytest.raises(ValueError, match="invalid label"):
        build_dataset(*fixture)


def test_builder_emits_one_class_dataset_and_provenance(tmp_path):
    manifest, labels, output = _write_fixture(tmp_path)

    data_yaml = build_dataset(manifest, labels, output)
    data = yaml.safe_load(data_yaml.read_text())

    assert data["names"] == {0: "lego_piece"}
    assert Path(data["path"]).is_absolute()
    assert data["train"] == "images/train"
    assert data["val"] == "images/val"
    assert data["test"] == "images/test"
    dataset_root = data_yaml.parent
    assert len(list((dataset_root / "images/train").glob("*.jpg"))) == 1
    assert len(list((dataset_root / "labels/val").glob("*.txt"))) == 1
    metadata = json.loads((dataset_root / "dataset-metadata.json").read_text())
    assert metadata["class_names"] == ["lego_piece"]
    assert len(metadata["dataset_sha256"]) == 64
    rows = [
        json.loads(line)
        for line in (dataset_root / "dataset-manifest.jsonl").read_text().splitlines()
    ]
    assert {row["dataset_provenance"] for row in rows} == {
        "custom_record3d"
    }
    assert {row["review_status"] for row in rows} == {"verified"}


def test_builder_is_content_addressed_and_deterministic(tmp_path):
    fixture = _write_fixture(tmp_path)

    first = build_dataset(*fixture)
    second = build_dataset(*fixture)

    assert first == second
    assert first.read_bytes() == second.read_bytes()
