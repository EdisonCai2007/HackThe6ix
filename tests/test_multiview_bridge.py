"""Bridge tests: identification crops come from ORIGINAL frames (manifest v2)."""
import json

import cv2
import numpy as np
import pytest

import pipeline.multiview
from pipeline.identify import Identification
from pipeline.multiview import scan_manifest


RECTIFIED_BGR = (9, 26, 201)   # red-ish block in the rectified view
ORIGINAL_BGR = (201, 26, 9)    # blue-ish block in the original frame


def _write_session(session, with_bridge=True):
    """One view: canvas 800x600, original 1600x1200, H = diag(2,2,1).

    Block dimensions mirror the proven test_session_cli fixture — smaller
    synthetic blocks get fragmented by the cv detector's morphology.
    """
    output = session / "multiview"
    output.mkdir(parents=True)
    frames = session / "frames"
    frames.mkdir()

    rectified = np.full((600, 800, 3), 245, dtype=np.uint8)
    rectified[180:280, 250:370] = RECTIFIED_BGR
    original = np.full((1200, 1600, 3), 245, dtype=np.uint8)
    original[360:560, 500:740] = ORIGINAL_BGR

    cv2.imwrite(str(output / "view_00001.jpg"), rectified)
    cv2.imwrite(str(output / "view_00001.mask.png"),
                np.full((600, 800), 255, dtype=np.uint8))
    cv2.imwrite(str(frames / "00001.rgb.jpg"), original)

    view = {
        "frame_id": 1,
        "quality": 1.0,
        "image": "multiview/view_00001.jpg",
        "mask": "multiview/view_00001.mask.png",
        "size_wh": [800, 600],
    }
    version = 1
    if with_bridge:
        version = 2
        view.update({
            "homography": np.diag([2.0, 2.0, 1.0]).tolist(),
            "rgb": "frames/00001.rgb.jpg",
            "rgb_size": [1200, 1600],
            "raise_uv_per_cm": [4.0, -6.0],
        })
    manifest = {
        "version": version,
        "session_dir": str(session),
        "px_per_m": 1000.0,
        "origin_xy": [0.0, 0.0],
        "size_wh": [800, 600],
        "edge_margin_px": 8,
        "union_coverage": 1.0,
        "selected_coverage": 1.0,
        "views": [view],
    }
    path = output / "manifest.json"
    path.write_text(json.dumps(manifest))
    return path


def _fake_identify(captured):
    def fake(crops, **kwargs):
        captured.extend(crops)
        return [Identification("3001", "Brick 2 x 4", "Bricks", 0.9)
                for _ in crops]
    return fake


def test_v2_identifies_from_original_pixels(tmp_path, monkeypatch):
    manifest = _write_session(tmp_path / "session", with_bridge=True)
    captured = []
    monkeypatch.setattr(pipeline.multiview, "identify_all",
                        _fake_identify(captured))
    result = scan_manifest(manifest, detector="cv")
    assert len(result.instances) == 1
    assert len(captured) == 1
    center = captured[0][captured[0].shape[0] // 2, captured[0].shape[1] // 2]
    # The crop must contain the ORIGINAL frame's pixels, not the rectified's.
    assert np.abs(center.astype(int) - ORIGINAL_BGR).max() < 30

    prov = result.id_crops[0]
    assert prov["frame_id"] == 1
    assert prov["rgb"] == "frames/00001.rgb.jpg"
    x0, y0, x1, y1 = prov["box_original"]
    # Mapped block (500..740, 360..560) padded 20% and raise-extended.
    assert x0 <= 500 and x1 >= 740 and y0 <= 360 and y1 >= 560
    assert prov["brickognize"]["part_id"] == "3001"
    assert prov["brickognize"]["score"] == pytest.approx(0.9)


def test_v1_falls_back_to_rectified_crop(tmp_path, monkeypatch):
    manifest = _write_session(tmp_path / "session", with_bridge=False)
    captured = []
    monkeypatch.setattr(pipeline.multiview, "identify_all",
                        _fake_identify(captured))
    result = scan_manifest(manifest, detector="cv")
    assert len(result.instances) == 1
    center = captured[0][captured[0].shape[0] // 2, captured[0].shape[1] // 2]
    assert np.abs(center.astype(int) - RECTIFIED_BGR).max() < 30
    assert result.id_crops[0]["rgb"] is None  # provenance marks the fallback
