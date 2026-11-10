from pathlib import Path

import numpy as np
import pytest

from training.labels import (
    LabelValidationError,
    instances_to_masks,
    parse_yolo_seg_line,
    validate_label_file,
)


@pytest.mark.parametrize(
    "line",
    [
        "1 0.1 0.1 0.2 0.1 0.2 0.2",
        "0 0.1 0.1 1.2 0.1 0.2 0.2",
        "0 0.1 0.1 0.2 0.2",
        "0 nan 0.1 0.2 0.1 0.2 0.2",
        "not-a-class 0.1 0.1 0.2 0.1 0.2 0.2",
    ],
)
def test_invalid_yolo_seg_lines_are_rejected(line):
    with pytest.raises(LabelValidationError):
        parse_yolo_seg_line(line)


def test_self_intersecting_polygon_is_rejected():
    with pytest.raises(LabelValidationError, match="polygon"):
        parse_yolo_seg_line("0 0.1 0.1 0.9 0.9 0.1 0.9 0.9 0.1")


def test_valid_polygon_parses_and_closing_duplicate_is_normalized():
    instance = parse_yolo_seg_line(
        "0 0.1 0.1 0.8 0.1 0.8 0.7 0.1 0.7 0.1 0.1"
    )

    assert instance.class_id == 0
    assert len(instance.points) == 4
    assert instance.area > 0


def test_validate_label_file_reports_duplicate_polygon(tmp_path):
    path = tmp_path / "label.txt"
    line = "0 0.1 0.1 0.4 0.1 0.4 0.4 0.1 0.4"
    path.write_text(line + "\n" + line + "\n")

    issues = validate_label_file(path, image_shape=(100, 100))

    assert "duplicate_polygon" in {issue.code for issue in issues}


def test_instances_to_masks_keeps_touching_instances_separate():
    instances = [
        parse_yolo_seg_line("0 .1 .1 .4 .1 .4 .4 .1 .4"),
        parse_yolo_seg_line("0 .4 .1 .7 .1 .7 .4 .4 .4"),
    ]

    masks = instances_to_masks(instances, (100, 100))

    assert masks.shape == (2, 100, 100)
    assert masks[0, 20, 20]
    assert masks[1, 20, 60]
    assert not masks[0, 20, 60]
    assert not masks[1, 20, 20]


def test_missing_and_empty_label_files_are_reported(tmp_path):
    missing = validate_label_file(tmp_path / "missing.txt", (100, 100))
    empty_path = tmp_path / "empty.txt"
    empty_path.write_text("")
    empty = validate_label_file(empty_path, (100, 100))

    assert [issue.code for issue in missing] == ["missing_label"]
    assert [issue.code for issue in empty] == ["empty_label"]
