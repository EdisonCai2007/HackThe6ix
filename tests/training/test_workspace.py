import json
from pathlib import Path

import cv2
import numpy as np

from training.workspace import workspace_crop_for_row


def _write_workspace_session(root: Path):
    session = root / "session"
    frames = session / "frames"
    frames.mkdir(parents=True)
    image = np.full((100, 100, 3), 220, np.uint8)
    cv2.rectangle(image, (35, 35), (65, 65), (20, 30, 180), -1)
    rgb = frames / "00000.rgb.jpg"
    cv2.imwrite(str(rgb), image)
    pose = np.eye(4)
    pose[2, 3] = 1.0
    record = {
        "frame_id": 0,
        "timestamp": 0.0,
        "rgb": "frames/00000.rgb.jpg",
        "depth": "frames/00000.depth.npy",
        "rgb_size": [100, 100],
        "depth_size": [10, 10],
        "intrinsics": {"fx": 80.0, "fy": 80.0, "cx": 50.0, "cy": 50.0},
        "pose_qt": {"qx": 0, "qy": 0, "qz": 0, "qw": 1,
                    "tx": 0, "ty": 0, "tz": 1},
        "pose_mat": pose.tolist(),
        "device_type": 1,
    }
    (session / "frames.jsonl").write_text(json.dumps(record) + "\n")
    (session / "table_frame.json").write_text(json.dumps({
        "world_to_table": np.eye(4).tolist(),
        "extent_xy": [[-0.4, 0.4], [-0.4, 0.4]],
        "fit_stats": {"inlier_fraction": 1.0},
    }))
    seen = np.zeros((8, 8), np.uint16)
    seen[1:7, 1:7] = 3
    np.savez_compressed(
        session / "coverage.npz",
        seen_count=seen,
        angle_bins=np.zeros_like(seen, dtype=np.uint8),
        cell_m=0.1,
        bounds=np.array([[-0.4, 0.4], [-0.4, 0.4]]),
    )
    row = {
        "dataset_id": "session__f00000",
        "source_session": "session",
        "source_frame": 0,
        "source_rgb": str(rgb.resolve()),
        "selected_image": str(rgb.resolve()),
    }
    return row


def test_workspace_crop_projects_repeated_plane_into_original_frame(tmp_path):
    row = _write_workspace_session(tmp_path)

    crop = workspace_crop_for_row(row, pad_fraction=0.0)

    assert crop.image.size > 0
    assert crop.workspace_mask.shape == crop.image.shape[:2]
    assert crop.workspace_mask.any()
    assert 0 <= crop.box_original[0] < crop.box_original[2] <= 100
    assert 0 <= crop.box_original[1] < crop.box_original[3] <= 100
    assert len(crop.contours_table_xy) == 1
    assert crop.hard_source == "depth_observed_plane_component"


def test_workspace_crop_requires_coverage_geometry(tmp_path):
    row = _write_workspace_session(tmp_path)
    Path(row["source_rgb"]).parent.parent.joinpath("coverage.npz").unlink()

    try:
        workspace_crop_for_row(row)
    except FileNotFoundError as exc:
        assert "coverage.npz" in str(exc)
    else:
        raise AssertionError("missing coverage geometry must not scan full room")
