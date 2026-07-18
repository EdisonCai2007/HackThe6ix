import json
from pathlib import Path
from types import SimpleNamespace

import cv2
import numpy as np

from training.inventory_review_assets import write_review_bundle


def _fake_result():
    image = np.full((80, 100, 3), 220, dtype=np.uint8)
    image[25:55, 35:70] = (180, 60, 30)
    mask = np.zeros((80, 100), dtype=bool)
    mask[25:55, 35:70] = True
    observation = SimpleNamespace(
        frame_id=7,
        view_index=0,
        mask_original=mask,
        mask_canvas=mask,
        original_image=image,
        box=(35, 25, 70, 55),
    )
    instance = SimpleNamespace(observations=[observation], best=observation)
    candidate = {
        "part_id": "3001",
        "name": "Brick 2 x 4",
        "score": 0.91,
        "img_url": "https://example.test/3001.webp",
    }
    return SimpleNamespace(
        instances=[instance],
        crops=[image[19:61, 28:77].copy()],
        id_crops=[{
            "frame_id": 7,
            "box_original": [28, 19, 77, 61],
            "brickognize": {
                "part_id": "3001", "name": "Brick 2 x 4", "score": 0.91,
            },
            "brickognize_primary": {
                "part_id": "3001", "name": "Brick 2 x 4", "score": 0.91,
                "candidates": [candidate],
            },
        }],
        mosaic=image.copy(),
        views=[],
    )


def test_write_review_bundle_writes_component_assets_and_document(tmp_path):
    output = tmp_path / "analysis-run"
    path = write_review_bundle(
        _fake_result(), tmp_path / "session", output, expected_count=1,
        color_names=["blue"], render_fetch=lambda url: b"render-bytes",
    )

    document = json.loads(path.read_text())
    component = document["components"][0]
    assert document["expected_physical_count"] == 1
    assert component["prediction"] == {
        "part_id": "3001", "part_name": "Brick 2 x 4",
        "color": "blue", "score": 0.91,
    }
    for key in ("crop", "mask", "masked_crop"):
        assert (output / component["assets"]["views"][0][key]).exists()
    assert (output / component["candidates"][0]["render_path"]).read_bytes() \
        == b"render-bytes"
    assert (output / document["overview_images"][0]).exists()
    assert document["overview_size_wh"] == [100, 80]


def test_render_failure_does_not_abort_bundle(tmp_path):
    def fail(url):
        raise OSError("offline")

    path = write_review_bundle(
        _fake_result(), tmp_path / "session", tmp_path / "run", 1,
        color_names=["blue"], render_fetch=fail,
    )
    candidate = json.loads(path.read_text())["components"][0]["candidates"][0]
    assert candidate["render_path"] is None
    assert candidate["img_url"] == "https://example.test/3001.webp"


def test_overview_contains_numbered_component_overlay(tmp_path):
    output = tmp_path / "run"
    path = write_review_bundle(
        _fake_result(), tmp_path / "session", output, 1,
        color_names=["blue"], render_fetch=lambda url: b"x",
    )
    overview = cv2.imread(str(output / json.loads(path.read_text())["overview_images"][0]))
    assert overview is not None
    assert np.any(overview != 220)
