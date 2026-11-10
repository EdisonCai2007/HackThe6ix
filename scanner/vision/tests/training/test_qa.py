import json
from pathlib import Path

import cv2
import numpy as np

from training.qa import build_qa


def test_qa_prioritizes_unverified_touching_instances(tmp_path):
    image_path = (tmp_path / "piece.jpg").resolve()
    cv2.imwrite(str(image_path), np.full((100, 120, 3), 230, np.uint8))
    selection = tmp_path / "manifest.jsonl"
    selection.write_text(json.dumps({
        "dataset_id": "piece",
        "source_session": "session",
        "source_frame": 4,
        "selected_image": str(image_path),
        "split": "train",
        "environment": "wood",
        "dataset_provenance": "custom_record3d",
        "touching_priority": True,
    }) + "\n")
    labels = tmp_path / "labels"
    labels.mkdir()
    (labels / "piece.txt").write_text(
        "0 .1 .1 .4 .1 .4 .5 .1 .5\n"
        "0 .4 .1 .7 .1 .7 .5 .4 .5\n"
    )
    (labels / "piece.review.json").write_text(json.dumps({
        "status": "unverified",
        "annotation_source": "sam2.1_s",
    }))

    report_path = build_qa(selection, labels, tmp_path / "qa")
    report = json.loads(report_path.read_text())

    item = report["items"][0]
    assert item["instance_count"] == 2
    assert item["touching_or_overlapping"]
    assert item["review_status"] == "unverified"
    assert item["priority_score"] > 0
    assert Path(item["overlay"]).exists()
    assert list((tmp_path / "qa").glob("qa-contact-sheet-*.jpg"))
