import csv
import importlib
from types import SimpleNamespace

import numpy as np


def _result_fixture():
    observation = SimpleNamespace(frame_id=7)
    best = SimpleNamespace(box=(10, 20, 40, 60))
    instance = SimpleNamespace(observations=[observation], best=best)
    return SimpleNamespace(
        instances=[instance],
        crops=[np.full((40, 30, 3), (10, 20, 200), np.uint8)],
        id_crops=[{
            "brickognize": {
                "part_id": "3001",
                "name": "Brick 2 x 4",
                "score": 0.91,
            }
        }],
    )


def test_write_color_worksheet_creates_blank_truth_rows_and_thumbnails(tmp_path):
    color_acceptance = importlib.import_module("training.color_acceptance")

    paths = color_acceptance.write_color_worksheet(
        _result_fixture(),
        tmp_path,
        session_id="20260717-233252",
        predicted_colors=["red"],
    )

    with paths.csv.open(newline="") as handle:
        rows = list(csv.DictReader(handle))
    assert len(rows) == 1
    assert rows[0]["component_id"] == "piece-000"
    assert rows[0]["box"] == "10 20 40 60"
    assert rows[0]["predicted_color"] == "red"
    assert rows[0]["truth_color"] == ""
    assert (tmp_path / rows[0]["thumbnail"]).exists()
    assert paths.markdown.exists()
    assert "Ground truth status: **unverified**" in paths.markdown.read_text()


def test_score_color_worksheet_separates_exact_ambiguous_and_confident_wrong(
    tmp_path,
):
    color_acceptance = importlib.import_module("training.color_acceptance")
    worksheet = tmp_path / "color_worksheet.csv"
    rows = [
        {
            "component_id": "piece-000", "box": "0 0 1 1",
            "part_id": "3001", "part_name": "Brick 2 x 4",
            "predicted_color": "red", "thumbnail": "a.jpg",
            "truth_color": "red", "notes": "",
        },
        {
            "component_id": "piece-001", "box": "1 0 2 1",
            "part_id": "3003", "part_name": "Brick 2 x 2",
            "predicted_color": "ambiguous(yellow/lime)",
            "thumbnail": "b.jpg", "truth_color": "yellow", "notes": "",
        },
        {
            "component_id": "piece-002", "box": "2 0 3 1",
            "part_id": "3005", "part_name": "Brick 1 x 1",
            "predicted_color": "teal", "thumbnail": "c.jpg",
            "truth_color": "green", "notes": "",
        },
    ]
    with worksheet.open("w", newline="") as handle:
        writer = csv.DictWriter(
            handle, fieldnames=color_acceptance.WORKSHEET_FIELDS
        )
        writer.writeheader()
        writer.writerows(rows)

    report = color_acceptance.score_color_worksheet(worksheet)

    assert report["labeled_count"] == 3
    assert report["exact_accuracy"] == 1 / 3
    assert report["acceptable_rate"] == 2 / 3
    assert report["confident_wrong_count"] == 1
    assert report["per_color"]["yellow"]["ambiguous_contains_truth"] == 1
    assert report["confusion"]["green"] == {"teal": 1}
