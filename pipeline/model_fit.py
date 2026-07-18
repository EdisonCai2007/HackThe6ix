"""Diagnostic calibrated silhouette fitting for regular LEGO parts."""
from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

import numpy as np


@dataclass(frozen=True)
class FrameCalibration:
    frame_id: int
    intrinsics: tuple[float, float, float, float]
    # Original RGB dimensions in (width, height) order.
    rgb_size: tuple[int, int]
    camera_to_world: np.ndarray
    world_to_table: np.ndarray
    view_tilt_deg: float | None = None


def _view_value(view, name):
    if isinstance(view, dict):
        return view.get(name)
    return getattr(view, name, None)


def load_frame_calibrations(session_dir, views) -> dict[int, FrameCalibration]:
    """Load selected ARKit frame calibration in explicit matrix conventions."""
    session_dir = Path(session_dir)
    table_path = session_dir / "table_frame.json"
    frames_path = session_dir / "frames.jsonl"
    if not table_path.exists() or not frames_path.exists():
        return {}
    world_to_table = np.asarray(
        json.loads(table_path.read_text())["world_to_table"], dtype=np.float64
    )
    selected = {
        int(_view_value(view, "frame_id")): view for view in views
    }
    records = {}
    for line in frames_path.read_text().splitlines():
        if not line.strip():
            continue
        record = json.loads(line)
        frame_id = int(record["frame_id"])
        if frame_id in selected:
            records[frame_id] = record
    calibrations = {}
    for frame_id, view in selected.items():
        record = records.get(frame_id)
        if record is None:
            continue
        intrinsics = record["intrinsics"]
        # Stored RGB size follows NumPy (height, width) order.
        height, width = (int(value) for value in record["rgb_size"])
        calibrations[frame_id] = FrameCalibration(
            frame_id=frame_id,
            intrinsics=(
                float(intrinsics["fx"]),
                float(intrinsics["fy"]),
                float(intrinsics["cx"]),
                float(intrinsics["cy"]),
            ),
            rgb_size=(width, height),
            camera_to_world=np.asarray(record["pose_mat"], dtype=np.float64),
            world_to_table=world_to_table,
            view_tilt_deg=(
                None
                if _view_value(view, "view_tilt_deg") is None
                else float(_view_value(view, "view_tilt_deg"))
            ),
        )
    return calibrations


def project_table_points(points_table_xyz, calibration: FrameCalibration):
    """Project table-frame metres into original RGB pixels."""
    points = np.asarray(points_table_xyz, dtype=np.float64)
    if points.ndim != 2 or points.shape[1] != 3:
        raise ValueError("table points must have shape (N, 3)")
    homogeneous = np.column_stack([points, np.ones(len(points))])
    table_to_world = np.linalg.inv(calibration.world_to_table)
    world_to_camera = np.linalg.inv(calibration.camera_to_world)
    camera = (world_to_camera @ (table_to_world @ homogeneous.T)).T
    depth = -camera[:, 2]
    fx, fy, cx, cy = calibration.intrinsics
    with np.errstate(divide="ignore", invalid="ignore"):
        u = fx * camera[:, 0] / depth + cx
        v = fy * -camera[:, 1] / depth + cy
    pixels = np.column_stack([u, v])
    width, height = calibration.rgb_size
    valid = (
        (depth > 0)
        & np.isfinite(pixels).all(axis=1)
        & (u >= -0.5)
        & (u < width - 0.5)
        & (v >= -0.5)
        & (v < height - 0.5)
    )
    return pixels, valid
