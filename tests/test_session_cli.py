import json

import cv2
import numpy as np

import pipeline.multiview
import session_cli
from pipeline.identify import Identification


def _write_manifest(session):
    output = session / "multiview"
    output.mkdir(parents=True)
    valid = np.ones((600, 800), dtype=np.uint8) * 255
    views = []
    for frame_id, offset in [(1, 0), (2, 3)]:
        image = np.full((600, 800, 3), 245, dtype=np.uint8)
        image[180:280, 250 + offset:370 + offset] = (9, 26, 201)
        image_path = output / f"view_{frame_id:05d}.jpg"
        mask_path = output / f"view_{frame_id:05d}.mask.png"
        cv2.imwrite(str(image_path), image)
        cv2.imwrite(str(mask_path), valid)
        views.append({
            "frame_id": frame_id,
            "quality": float(3 - frame_id),
            "image": str(image_path.relative_to(session)),
            "mask": str(mask_path.relative_to(session)),
            "size_wh": [800, 600],
        })
    manifest = {
        "version": 1,
        "session_dir": str(session),
        "px_per_m": 1000.0,
        "origin_xy": [0.0, 0.0],
        "size_wh": [800, 600],
        "edge_margin_px": 8,
        "union_coverage": 1.0,
        "selected_coverage": 1.0,
        "views": views,
    }
    path = output / "manifest.json"
    path.write_text(json.dumps(manifest))
    return path


def test_session_cli_identifies_one_best_crop_and_writes_outputs(
    tmp_path, monkeypatch
):
    session = tmp_path / "session"
    manifest = _write_manifest(session)
    calls = []

    def fake_identify(crops, **kwargs):
        calls.extend(crops)
        return [
            Identification("3003", "Brick 2 x 2", "Bricks", 0.9)
            for _ in crops
        ]

    monkeypatch.setattr(pipeline.multiview, "identify_all", fake_identify)

    session_cli.main([str(manifest), "--detector", "cv"])

    inventory = json.loads((session / "inventory.json").read_text())
    assert sum(item["quantity"] for item in inventory) == 1
    assert len(calls) == 1
    assert (session / "topdown.jpg").exists()
    assert (session / "debug.jpg").exists()
    result = json.loads((session / "multiview_result.json").read_text())
    assert result["instance_count"] == 1
