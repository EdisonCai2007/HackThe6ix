"""Scene-state export: stable IDs, per-observation timing, table geometry."""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np

from pipeline.color import LegoColor
from pipeline.multiview import FusedInstance, Observation
from pipeline.scene_state import (
    SCENE_STATE_VERSION,
    build_scene_state,
    canvas_to_table_xy,
)


def _obs(frame_id, view_index, box_canvas, box_original, *, confidence=0.8,
         complete=True, detector="seg", polygons_canvas=()):
    return Observation(
        frame_id=frame_id,
        view_index=view_index,
        box=box_canvas,
        color=LegoColor(4, "red", (201, 26, 9)),
        complete=complete,
        boundary_clearance=12.0,
        quality=5.0,
        detector=detector,
        confidence=confidence,
        source_instance_id=f"yolo-{view_index:03d}",
        box_original=box_original,
        polygons_canvas=polygons_canvas,
        identification_focus=9.5,
    )


def _manifest(session_dir):
    return {
        "version": 3,
        "session_dir": str(session_dir),
        "origin_xy": [-0.10, -0.20],
        "px_per_m": 2000.0,
        "size_wh": [400, 300],
        "selected_coverage": 0.93,
        "union_coverage": 0.95,
        "selection": {"coverage_complete": False, "angle_diverse": True},
        "workspace_geometry": {
            "hard_bounds_table_xy": [[-0.10, 0.10], [-0.20, 0.10]],
            "hard_contours_table_xy": [[[-0.1, -0.2], [0.1, -0.2], [0.1, 0.1]]],
        },
    }


class _Result:
    def __init__(self, instances, manifest, id_crops, timings):
        self.instances = instances
        self.manifest = manifest
        self.id_crops = id_crops
        self.timings_s = timings
        self.views = []


def _write_session(tmp_path):
    session = tmp_path / "session"
    session.mkdir()
    # table_frame.json: identity world<->table so projection math is checkable.
    (session / "table_frame.json").write_text(json.dumps({
        "world_to_table": np.eye(4).tolist(),
        "extent_xy": [[-0.1, 0.1], [-0.2, 0.1]],
    }))
    # frames.jsonl: two frames with timestamps.
    lines = []
    for fid, ts in [(10, 100.0), (111, 100.5)]:
        lines.append(json.dumps({
            "frame_id": fid, "timestamp": ts,
            "rgb": f"frames/{fid:05d}.rgb.jpg", "depth": "d.npy",
            "rgb_size": [1920, 1440], "depth_size": [192, 256],
            "intrinsics": {"fx": 700, "fy": 700, "cx": 720, "cy": 960},
            "pose_mat": np.eye(4).tolist(), "device_type": 1,
        }))
    (session / "frames.jsonl").write_text("\n".join(lines) + "\n")
    return session


def test_canvas_to_table_xy_is_linear():
    # canvas px -> table metres: table = origin + canvas / px_per_m
    xy = canvas_to_table_xy([[0.0, 0.0], [200.0, 100.0]],
                            origin_xy=(-0.10, -0.20), px_per_m=2000.0)
    np.testing.assert_allclose(xy[0], [-0.10, -0.20])
    np.testing.assert_allclose(xy[1], [0.0, -0.15])


def test_build_scene_state_structure_and_ids(tmp_path):
    session = _write_session(tmp_path)
    manifest = _manifest(session)
    poly = (np.array([[0, 0], [80, 0], [80, 60], [0, 60]], dtype=np.float32),)
    inst0 = FusedInstance(
        [_obs(111, 0, (10, 10, 90, 70), (100, 120, 260, 240),
              polygons_canvas=poly),
         _obs(10, 1, (12, 11, 92, 69), (90, 118, 250, 236))],
        best=_obs(111, 0, (10, 10, 90, 70), (100, 120, 260, 240),
                  polygons_canvas=poly),
    )
    inst1 = FusedInstance(
        [_obs(10, 1, (200, 150, 260, 210), (600, 700, 760, 820))],
        best=_obs(10, 1, (200, 150, 260, 210), (600, 700, 760, 820)),
    )
    id_crops = [
        {"brickognize": {"part_id": "3001", "name": "Brick 2 x 4",
                         "score": 0.89}, "flags": ["family_reviewed"]},
        {"brickognize": {"part_id": None, "name": "unknown brick",
                         "score": 0.4}, "flags": []},
    ]
    result = _Result([inst0, inst1], manifest, id_crops,
                     {"detect": 5.0, "identify": 4.0, "total": 10.0})

    state = build_scene_state(result, session, detector="seg",
                              predicted_colors=["red", "white"])

    assert state["version"] == SCENE_STATE_VERSION
    assert state["detector"] == "seg"
    assert len(state["instances"]) == 2
    # Stable, contiguous instance ids.
    assert [i["instance_id"] for i in state["instances"]] == [0, 1]

    a = state["instances"][0]
    assert a["part_id"] == "3001" and a["part_name"] == "Brick 2 x 4"
    assert a["id_score"] == 0.89
    assert a["color"] == "red"
    assert a["flags"] == ["family_reviewed"]
    # Two observations, each carrying frame id + joined timestamp + image bbox.
    assert len(a["observations"]) == 2
    obs_by_frame = {o["frame_id"]: o for o in a["observations"]}
    assert obs_by_frame[111]["timestamp"] == 100.5
    assert obs_by_frame[10]["timestamp"] == 100.0
    assert obs_by_frame[111]["box_original"] == [100, 120, 260, 240]
    assert obs_by_frame[111]["centroid_original"] == [180.0, 180.0]
    assert obs_by_frame[111]["confidence"] == 0.8
    assert obs_by_frame[111]["complete"] is True
    # Table-space footprint present and inside the workspace scale.
    assert a["table_box_xy"] is not None
    assert a["table_centroid_xy"] is not None
    # Best-observation polygon converted to table metres (identity table frame).
    np.testing.assert_allclose(a["table_polygon_xy"][0], [-0.10, -0.20],
                               atol=1e-9)


def test_coverage_block_uses_real_manifest_numbers(tmp_path):
    session = _write_session(tmp_path)
    manifest = _manifest(session)
    result = _Result([], manifest, [], {"total": 1.0})
    state = build_scene_state(result, session, detector="seg",
                              predicted_colors=[])
    cov = state["coverage"]
    assert cov["spatial_fraction"] == 0.93
    assert cov["union_fraction"] == 0.95
    assert cov["coverage_complete"] is False
    assert cov["workspace_bounds_table_xy"] == [[-0.10, 0.10], [-0.20, 0.10]]
    assert cov["workspace_contours_table_xy"]  # non-empty
    assert state["table"]["world_to_table"] == np.eye(4).tolist()
    assert state["table"]["px_per_m"] == 2000.0


def test_cv_detector_confidence_is_null_not_faked(tmp_path):
    session = _write_session(tmp_path)
    manifest = _manifest(session)
    inst = FusedInstance(
        [_obs(10, 0, (10, 10, 90, 70), (100, 120, 260, 240),
              detector="cv", confidence=None)],
        best=_obs(10, 0, (10, 10, 90, 70), (100, 120, 260, 240),
                  detector="cv", confidence=None),
    )
    id_crops = [{"brickognize": {"part_id": "3001", "name": "Brick 2 x 4",
                                 "score": 0.9}, "flags": []}]
    result = _Result([inst], manifest, id_crops, {"total": 1.0})
    state = build_scene_state(result, session, detector="cv",
                              predicted_colors=["red"])
    obs = state["instances"][0]["observations"][0]
    # No invented confidence: the classical detector genuinely has none.
    assert obs["confidence"] is None
    assert obs["detector"] == "cv"


def test_missing_table_frame_degrades_without_crash(tmp_path):
    session = tmp_path / "session"
    session.mkdir()
    (session / "frames.jsonl").write_text(
        json.dumps({"frame_id": 10, "timestamp": 5.0, "rgb": "f.jpg",
                    "depth": "d.npy", "rgb_size": [100, 100],
                    "depth_size": [10, 10],
                    "intrinsics": {"fx": 1, "fy": 1, "cx": 1, "cy": 1},
                    "pose_mat": np.eye(4).tolist(), "device_type": 1}) + "\n"
    )
    manifest = _manifest(session)
    inst = FusedInstance(
        [_obs(10, 0, (10, 10, 90, 70), (5, 5, 40, 40))],
        best=_obs(10, 0, (10, 10, 90, 70), (5, 5, 40, 40)),
    )
    id_crops = [{"brickognize": {"part_id": "3001", "name": "Brick 2 x 4",
                                 "score": 0.9}, "flags": []}]
    result = _Result([inst], manifest, id_crops, {"total": 1.0})
    state = build_scene_state(result, session, detector="seg",
                              predicted_colors=["red"])
    # world_to_table unavailable -> reported as None, still valid table box.
    assert state["table"]["world_to_table"] is None
    assert state["instances"][0]["table_box_xy"] is not None
