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


def _write_session(session, with_bridge=True, second_view=False):
    """Canvas 800x600, original 1600x1200 per view, H = diag(2,2,1).

    Block dimensions mirror the proven test_session_cli fixture — smaller
    synthetic blocks get fragmented by the cv detector's morphology.
    second_view adds a lower-quality frame 2 seeing the same block.
    """
    output = session / "multiview"
    output.mkdir(parents=True)
    frames = session / "frames"
    frames.mkdir()

    views = []
    frame_specs = [(1, 1.0, 0)] + ([(2, 0.5, 4)] if second_view else [])
    for frame_id, quality, offset in frame_specs:
        rectified = np.full((600, 800, 3), 245, dtype=np.uint8)
        rectified[180 + offset:280 + offset,
                  250 + offset:370 + offset] = RECTIFIED_BGR
        original = np.full((1200, 1600, 3), 245, dtype=np.uint8)
        original[360:560, 500:740] = ORIGINAL_BGR

        cv2.imwrite(str(output / f"view_{frame_id:05d}.jpg"), rectified)
        cv2.imwrite(str(output / f"view_{frame_id:05d}.mask.png"),
                    np.full((600, 800), 255, dtype=np.uint8))
        cv2.imwrite(str(frames / f"{frame_id:05d}.rgb.jpg"), original)

        view = {
            "frame_id": frame_id,
            "quality": quality,
            "image": f"multiview/view_{frame_id:05d}.jpg",
            "mask": f"multiview/view_{frame_id:05d}.mask.png",
            "size_wh": [800, 600],
        }
        if with_bridge:
            view.update({
                "homography": np.diag([2.0, 2.0, 1.0]).tolist(),
                "rgb": f"frames/{frame_id:05d}.rgb.jpg",
                "rgb_size": [1200, 1600],
                "raise_uv_per_cm": [4.0, -6.0],
            })
        views.append(view)
    manifest = {
        "version": 2 if with_bridge else 1,
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


def _obs(view_index, box, complete, clearance=10.0):
    from pipeline.color import PALETTE
    from pipeline.multiview import Observation
    return Observation(
        frame_id=view_index, view_index=view_index, box=box,
        color=PALETTE[0], complete=complete, boundary_clearance=clearance,
        quality=0.0,
    )


def _view(view_index, quality, rgb_size=(1200, 1600)):
    from pipeline.multiview import RectifiedView
    return RectifiedView(
        frame_id=view_index, view_index=view_index,
        image=np.zeros((600, 800, 3), np.uint8),
        valid_mask=np.full((600, 800), 255, np.uint8),
        quality=quality,
        homography=np.diag([2.0, 2.0, 1.0]),
        rgb=f"frames/{view_index:05d}.rgb.jpg",
        rgb_size=rgb_size,
        raise_uv_per_cm=(0.0, 0.0),
    )


def test_id_observation_prefers_sharp_topdown_view_over_canvas_complete():
    """A piece clipped by the CANVAS crop is usually whole in the original
    frame — the sharp top-down view must win over an oblique complete one."""
    from pipeline.multiview import FusedInstance, _identification_observation

    views = [_view(0, quality=8.0), _view(1, quality=1.0)]
    # In view 0 (sharp, top-down) the observation is canvas-incomplete;
    # in view 1 (oblique) it is complete. Both fit the original frame.
    sharp = _obs(0, (600, 400, 690, 490), complete=False)
    oblique = _obs(1, (100, 100, 190, 190), complete=True)
    instance = FusedInstance([sharp, oblique], best=oblique)
    chosen, box = _identification_observation(instance, views)
    assert chosen is sharp
    assert box is not None


def test_id_observation_rejects_view_clipped_in_original_frame():
    """If the mapped crop runs off the original image, that view loses."""
    from pipeline.multiview import FusedInstance, _identification_observation

    # Tiny original: the mapped box (plus padding) cannot fit.
    views = [_view(0, quality=8.0, rgb_size=(300, 300)), _view(1, quality=1.0)]
    clipped = _obs(0, (700, 500, 790, 590), complete=False)
    safe = _obs(1, (100, 100, 190, 190), complete=True)
    instance = FusedInstance([clipped, safe], best=safe)
    chosen, _ = _identification_observation(instance, views)
    assert chosen is safe


def test_stud_advisory_corrects_contradicted_id(tmp_path, monkeypatch):
    manifest = _write_session(tmp_path / "session", with_bridge=True)

    def fake_identify(crops, **kwargs):
        return [Identification("3008", "Brick 1 x 8", None, 0.79, candidates=(
            {"part_id": "3008", "name": "Brick 1 x 8", "score": 0.79},
            {"part_id": "3028", "name": "Plate 6 x 12", "score": 0.55},
        )) for _ in crops]

    monkeypatch.setattr(pipeline.multiview, "identify_all", fake_identify)
    monkeypatch.setattr(pipeline.multiview, "count_studs",
                        lambda crop, radius_px: 30)
    result = scan_manifest(manifest, detector="cv")
    assert result.id_crops[0]["stud"]["action"] == "corrected"
    assert result.id_crops[0]["brickognize"]["part_id"] == "3028"
    assert result.inventory[0]["part_id"] == "3028"


def test_stud_advisory_skips_when_studs_invisible(tmp_path, monkeypatch):
    manifest = _write_session(tmp_path / "session", with_bridge=True)

    def fake_identify(crops, **kwargs):
        return [Identification("3007", "Brick 2 x 8", None, 0.79)
                for _ in crops]

    monkeypatch.setattr(pipeline.multiview, "identify_all", fake_identify)
    monkeypatch.setattr(pipeline.multiview, "count_studs",
                        lambda crop, radius_px: 1)
    result = scan_manifest(manifest, detector="cv")
    assert result.id_crops[0]["stud"]["action"] == "skipped"
    assert result.id_crops[0]["brickognize"]["part_id"] == "3007"


def test_second_chance_uses_alternate_view_for_weak_id(tmp_path, monkeypatch):
    # Two views of the same block; the chosen view's crop IDs weakly, the
    # alternate strongly — the strong one must win and be recorded.
    session = tmp_path / "session"
    manifest = _write_session(session, with_bridge=True, second_view=True)

    def fake_identify_all(crops, **kwargs):
        return [Identification(None, "unknown brick", None, 0.55)
                for _ in crops]

    def fake_identify_crop(crop, **kwargs):
        return Identification("3008", "Brick 1 x 8", None, 0.84)

    monkeypatch.setattr(pipeline.multiview, "identify_all", fake_identify_all)
    monkeypatch.setattr(pipeline.multiview, "identify_crop",
                        fake_identify_crop)
    monkeypatch.setattr(pipeline.multiview, "count_studs",
                        lambda crop, radius_px: 0)
    result = scan_manifest(manifest, detector="cv")
    assert len(result.instances) == 1
    prov = result.id_crops[0]
    assert prov["source"] == "original-masked-second-chance"
    assert prov["brickognize"]["part_id"] == "3008"
