import json

import cv2
import numpy as np

import pipeline.multiview
import session_cli
from pipeline.identify import Identification


def test_auto_falls_back_to_cv_without_segmentation_weights(tmp_path):
    assert session_cli.resolve_detector(
        "auto", model_path=tmp_path / "missing.pt"
    ) == "cv"


def test_auto_prefers_installed_segmentation_weights(tmp_path):
    weights = tmp_path / "lego_seg.pt"
    weights.write_bytes(b"fixture")

    assert session_cli.resolve_detector("auto", model_path=weights) == "seg"


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
    # Boxes are never drawn on the mosaic; debug moved to debug/.
    assert not (session / "debug.jpg").exists()
    assert (session / "debug" / "crop_gallery.jpg").exists()
    result = json.loads((session / "multiview_result.json").read_text())
    assert result["instance_count"] == 1
    assert result["instances"][0]["id_crop"]["source"] == "rectified-fallback"


def test_session_cli_writes_frame_overlays_for_v2(tmp_path, monkeypatch):
    from tests.test_multiview_bridge import _write_session

    session = tmp_path / "session"
    manifest = _write_session(session, with_bridge=True)

    def fake_identify(crops, **kwargs):
        return [Identification("3001", "Brick 2 x 4", "Bricks", 0.9)
                for _ in crops]

    monkeypatch.setattr(pipeline.multiview, "identify_all", fake_identify)
    session_cli.main([str(manifest), "--detector", "cv"])

    assert (session / "debug" / "crop_gallery.jpg").exists()
    assert (session / "debug" / "frame_00001_overlay.jpg").exists()
    result = json.loads((session / "multiview_result.json").read_text())
    id_crop = result["instances"][0]["id_crop"]
    assert id_crop["source"] == "original-masked"
    assert id_crop["rgb"] == "frames/00001.rgb.jpg"
    assert id_crop["brickognize"]["part_id"] == "3001"


def test_seg_debug_writes_workspace_and_gate_overlays(tmp_path, monkeypatch):
    import pipeline.segdetect
    from tests.test_segdetect import _FakeModel, _write_v3_fixture

    manifest = _write_v3_fixture(tmp_path)
    path = tmp_path / "session/multiview/manifest.json"
    path.write_text(json.dumps(manifest))
    monkeypatch.setattr(
        pipeline.segdetect, "YoloSegModel", lambda **kwargs: _FakeModel()
    )
    monkeypatch.setattr(
        pipeline.multiview, "identify_all",
        lambda crops, **kwargs: [
            Identification("3001", "Brick 2 x 4", "Bricks", 0.9)
            for _ in crops
        ],
    )
    monkeypatch.setattr(pipeline.multiview, "count_studs", lambda *args: 0)

    session_cli.main([str(path), "--detector", "seg"])

    debug = tmp_path / "session/debug"
    assert (debug / "frame_00001_seg_gate.jpg").exists()
    result = json.loads(
        (tmp_path / "session/multiview_result.json").read_text()
    )
    assert result["detector"] == "seg"
    assert result["segmentation"]["accepted"] == 1
    assert result["segmentation"]["rejected"] == 0
