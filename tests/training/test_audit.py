import json
from pathlib import Path

import cv2
import numpy as np
import pytest

from training.audit import audit_sessions
from training.catalog import Catalog, SessionSpec


def _write_session(root: Path, session_id: str, frame_count: int) -> Path:
    session = root / session_id
    frames_dir = session / "frames"
    frames_dir.mkdir(parents=True)
    rows = []
    for frame_id in range(frame_count):
        image = np.full((120, 160, 3), 220, np.uint8)
        cv2.line(
            image,
            (10 + frame_id * 3, 20),
            (130, 90 + frame_id),
            (20, 40, 180),
            3,
        )
        rgb = f"frames/{frame_id:05d}.rgb.jpg"
        depth = f"frames/{frame_id:05d}.depth.npy"
        cv2.imwrite(str(session / rgb), image)
        np.save(session / depth, np.ones((12, 16), np.float32))
        rows.append({
            "frame_id": frame_id,
            "timestamp": 100.0 + frame_id,
            "rgb": rgb,
            "depth": depth,
            "rgb_size": [120, 160],
            "depth_size": [12, 16],
            "intrinsics": {"fx": 100.0, "fy": 100.0,
                           "cx": 80.0, "cy": 60.0},
            "pose_qt": {"qx": 0.0, "qy": 0.0, "qz": 0.0, "qw": 1.0,
                        "tx": frame_id * 0.01, "ty": 0.0, "tz": 0.3},
            "pose_mat": [[1, 0, 0, frame_id * 0.01],
                         [0, 1, 0, 0], [0, 0, 1, 0.3], [0, 0, 0, 1]],
            "device_type": 1,
        })
    (session / "frames.jsonl").write_text(
        "".join(json.dumps(row) + "\n" for row in rows)
    )
    if frame_count:
        (session / "table_frame.json").write_text(json.dumps({
            "world_to_table": np.eye(4).tolist(),
            "extent_xy": [[-0.2, 0.2], [-0.15, 0.15]],
            "fit_stats": {"inlier_fraction": 0.95, "frames_used": 3,
                          "points": 100, "inliers": 95},
        }))
    return session


def _catalog(*session_ids: str) -> Catalog:
    return Catalog(
        version=1,
        held_out_environment=None,
        sessions={
            session_id: SessionSpec(
                environment="wood",
                split="train" if session_id != "empty" else "exclude",
                target_frames=2 if session_id != "empty" else 0,
                provenance="custom_record3d",
                cohort="phase3_new",
                reason="zero_frames" if session_id == "empty" else None,
            )
            for session_id in session_ids
        },
    )


def test_audit_reports_health_metrics(tmp_path):
    capture_root = tmp_path / "sessions"
    _write_session(capture_root, "healthy", 3)

    report = audit_sessions(
        _catalog("healthy"), capture_root, tmp_path / "audit"
    )

    row = report["sessions"]["healthy"]
    assert row["status"] == "usable"
    assert row["frame_count"] == 3
    assert row["missing_rgb"] == 0
    assert row["missing_depth"] == 0
    assert row["duration_s"] == pytest.approx(2.0)
    assert row["plane_inlier_fraction"] == pytest.approx(0.95)
    assert row["sharpness"]["median"] > 0
    assert len(row["representative_frames"]) == 3


def test_audit_renders_empty_placeholder_and_artifacts(tmp_path):
    capture_root = tmp_path / "sessions"
    _write_session(capture_root, "empty", 0)

    output = tmp_path / "audit"
    report = audit_sessions(_catalog("empty"), capture_root, output)

    assert report["sessions"]["empty"]["status"] == "empty"
    assert "zero_frames" in report["sessions"]["empty"]["warnings"]
    assert (output / "session-audit.json").exists()
    assert (output / "session-audit.md").exists()
    assert list(output.glob("session-contact-sheet-*.jpg"))


def test_audit_reports_missing_session_without_crashing(tmp_path):
    output = tmp_path / "audit"

    report = audit_sessions(
        _catalog("missing"), tmp_path / "sessions", output
    )

    row = report["sessions"]["missing"]
    assert row["status"] == "missing"
    assert row["warnings"] == ["missing_session_directory"]
