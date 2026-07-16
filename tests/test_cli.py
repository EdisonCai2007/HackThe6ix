import json

import numpy as np
import pytest

import cli
import pipeline.scan
from pipeline.identify import Identification


def make_scene():
    img = np.full((600, 800, 3), 250, dtype=np.uint8)
    img[100:180, 100:220] = (9, 26, 201)  # red
    img[120:240, 400:560] = (9, 26, 201)  # red
    img[350:480, 250:420] = (191, 85, 0)  # blue
    return img


@pytest.fixture
def fake_identify(monkeypatch):
    def fake(crops, **kwargs):
        return [Identification("3001", "Brick 2 x 4", "Bricks", 0.9) for _ in crops]

    monkeypatch.setattr(pipeline.scan, "identify_all", fake)
    return fake


def test_scan_image_builds_inventory(fake_identify):
    result = pipeline.scan.scan_image(make_scene(), detector="cv")
    assert sum(e["quantity"] for e in result.inventory) == 3
    reds = next(e for e in result.inventory if e["color"] == "red")
    assert reds == {
        "part_id": "3001", "name": "Brick 2 x 4", "color": "red",
        "color_id": 4, "quantity": 2,
    }
    assert len(result.labels) == 3
    assert result.labels[0] == "Brick 2 x 4 | red | 0.90"


def test_cli_writes_json_and_debug(tmp_path, fake_identify):
    import cv2

    photo = tmp_path / "photo.jpg"
    cv2.imwrite(str(photo), make_scene())
    out = tmp_path / "inventory.json"

    cli.main([str(photo), "-o", str(out), "--debug", "--detector", "cv"])

    inv = json.loads(out.read_text())
    assert sum(e["quantity"] for e in inv) == 3
    assert (tmp_path / "debug.jpg").exists()  # written next to the output


def test_cli_missing_photo_exits_nonzero(tmp_path):
    with pytest.raises(SystemExit):
        cli.main([str(tmp_path / "nope.jpg"), "-o", str(tmp_path / "o.json")])
