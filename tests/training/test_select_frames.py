import hashlib
import json
from pathlib import Path

import cv2
import numpy as np

from training.catalog import Catalog, SessionSpec
from training.select_frames import (
    build_selection,
    read_jsonl,
    select_session_frames,
    session_split_leaks,
)


def _write_moving_session(root: Path, session_id: str = "moving") -> Path:
    session = root / session_id
    frames = session / "frames"
    frames.mkdir(parents=True)
    rows = []
    for frame_id in range(12):
        image = np.full((180, 240, 3), 225, np.uint8)
        for offset in range(8):
            cv2.rectangle(
                image,
                (20 + offset * 20, 20 + (frame_id % 3) * 4),
                (32 + offset * 20, 150),
                (20 + offset * 15, 40, 180),
                2 if frame_id not in {4, 5} else 1,
            )
        if frame_id in {4, 5}:
            image = cv2.GaussianBlur(image, (19, 19), 6)
        rgb_rel = f"frames/{frame_id:05d}.rgb.jpg"
        depth_rel = f"frames/{frame_id:05d}.depth.npy"
        cv2.imwrite(str(session / rgb_rel), image)
        np.save(session / depth_rel, np.ones((18, 24), np.float32))
        angle = np.deg2rad(frame_id * 4.0)
        c, s = np.cos(angle), np.sin(angle)
        pose = np.array([
            [c, -s, 0, frame_id * 0.015],
            [s, c, 0, (frame_id % 4) * 0.01],
            [0, 0, 1, 0.30 + frame_id * 0.002],
            [0, 0, 0, 1],
        ])
        rows.append({
            "frame_id": frame_id,
            "timestamp": float(frame_id),
            "rgb": rgb_rel,
            "depth": depth_rel,
            "rgb_size": [180, 240],
            "depth_size": [18, 24],
            "intrinsics": {"fx": 150, "fy": 150, "cx": 120, "cy": 90},
            "pose_qt": {"qx": 0, "qy": 0, "qz": 0, "qw": 1,
                        "tx": 0, "ty": 0, "tz": 0.3},
            "pose_mat": pose.tolist(),
            "device_type": 1,
        })
    (session / "frames.jsonl").write_text(
        "".join(json.dumps(row) + "\n" for row in rows)
    )
    (session / "table_frame.json").write_text(json.dumps({
        "world_to_table": np.eye(4).tolist(),
        "extent_xy": [[-0.2, 0.2], [-0.2, 0.2]],
        "fit_stats": {"inlier_fraction": 1.0},
    }))
    return session


def _catalog(session_id: str, split: str = "train") -> Catalog:
    return Catalog(
        version=1,
        held_out_environment=None,
        sessions={
            session_id: SessionSpec(
                environment="wood",
                split=split,
                target_frames=3,
                provenance="custom_record3d",
                cohort="phase3_new",
            )
        },
    )


def test_selection_prefers_quality_and_pose_diversity(tmp_path):
    session = _write_moving_session(tmp_path / "sessions")

    chosen = select_session_frames(session, target_count=3)

    assert len(chosen) == 3
    assert len({item.frame_id for item in chosen}) == 3
    assert max(item.frame_id for item in chosen) - min(
        item.frame_id for item in chosen
    ) > 2
    assert not {item.frame_id for item in chosen}.issubset({4, 5})


def test_selection_is_deterministic(tmp_path):
    session = _write_moving_session(tmp_path / "sessions")

    first = select_session_frames(session, 4)
    second = select_session_frames(session, 4)

    assert [item.frame_id for item in first] == [
        item.frame_id for item in second
    ]


def test_build_selection_retains_provenance_and_copies_without_reencoding(
    tmp_path,
):
    capture_root = tmp_path / "sessions"
    session = _write_moving_session(capture_root)
    output = tmp_path / "selected"

    manifest_path = build_selection(
        _catalog(session.name), capture_root, output
    )
    rows = read_jsonl(manifest_path)

    assert len(rows) == 3
    assert session_split_leaks(rows) == {}
    for row in rows:
        assert row["source_session"] == session.name
        assert row["split"] == "train"
        assert row["dataset_provenance"] == "custom_record3d"
        assert row["annotation_status"] == "missing"
        source = Path(row["source_rgb"])
        selected = Path(row["selected_image"])
        assert source.is_absolute() and selected.is_absolute()
        assert source.read_bytes() == selected.read_bytes()
        assert row["source_sha256"] == hashlib.sha256(
            source.read_bytes()
        ).hexdigest()


def test_session_split_leaks_reports_each_conflicting_session():
    rows = [
        {"source_session": "same", "split": "train"},
        {"source_session": "same", "split": "val"},
        {"source_session": "safe", "split": "test"},
    ]

    assert session_split_leaks(rows) == {"same": ["train", "val"]}


def test_excluded_session_is_not_selected(tmp_path):
    capture_root = tmp_path / "sessions"
    session = _write_moving_session(capture_root)
    catalog = Catalog(
        version=1,
        held_out_environment=None,
        sessions={
            session.name: SessionSpec(
                environment="unknown",
                split="exclude",
                target_frames=0,
                provenance="custom_record3d",
                cohort="phase3_new",
                reason="not_usable",
            )
        },
    )

    manifest = build_selection(catalog, capture_root, tmp_path / "selected")

    assert read_jsonl(manifest) == []
