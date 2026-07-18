"""Diagnostic calibrated silhouette fitting for regular LEGO parts."""
from __future__ import annotations

import json
import re
from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np


REGULAR_NAME = re.compile(r"^(Brick|Plate) (\d+) x (\d+)$")
STUD_PITCH_M = 0.008
BRICK_HEIGHT_M = 0.0096
PLATE_HEIGHT_M = 0.0032


@dataclass(frozen=True)
class FrameCalibration:
    frame_id: int
    intrinsics: tuple[float, float, float, float]
    # Original RGB dimensions in (width, height) order.
    rgb_size: tuple[int, int]
    camera_to_world: np.ndarray
    world_to_table: np.ndarray
    view_tilt_deg: float | None = None


@dataclass(frozen=True)
class RegularModel:
    part_id: str
    name: str
    family: str
    studs: tuple[int, int]
    dimensions_xyz: tuple[float, float, float]

    @classmethod
    def from_identification(cls, part_id, name):
        if part_id is None or not isinstance(name, str):
            return None
        match = REGULAR_NAME.fullmatch(name)
        if match is None:
            return None
        family, first, second = match.groups()
        studs = (int(first), int(second))
        height = BRICK_HEIGHT_M if family == "Brick" else PLATE_HEIGHT_M
        return cls(
            part_id=str(part_id),
            name=name,
            family=family,
            studs=studs,
            dimensions_xyz=(
                studs[0] * STUD_PITCH_M,
                studs[1] * STUD_PITCH_M,
                height,
            ),
        )


@dataclass(frozen=True)
class RestingOrientation:
    label: str
    dimensions_xyz: tuple[float, float, float]


def resting_orientations(model: RegularModel):
    """Enumerate physical vertical axes, deduplicating x/y yaw symmetry."""
    dimensions = model.dimensions_xyz
    orientations = []
    seen = set()
    axis_names = ("stud_width_up", "stud_length_up", "element_height_up")
    for vertical_axis in range(3):
        horizontal = sorted(
            dimensions[index] for index in range(3) if index != vertical_axis
        )
        oriented = (horizontal[0], horizontal[1], dimensions[vertical_axis])
        key = tuple(round(value, 9) for value in oriented)
        if key in seen:
            continue
        seen.add(key)
        orientations.append(RestingOrientation(
            label=axis_names[vertical_axis], dimensions_xyz=oriented
        ))
    return tuple(orientations)


def cuboid_vertices(center_xy, yaw_deg, dimensions_xyz):
    """Return eight table-frame vertices for a cuboid resting at z=0."""
    width, length, height = (float(value) for value in dimensions_xyz)
    local = np.array([
        [x, y, z]
        for z in (0.0, height)
        for y in (-length / 2.0, length / 2.0)
        for x in (-width / 2.0, width / 2.0)
    ])
    angle = np.deg2rad(float(yaw_deg))
    cosine, sine = np.cos(angle), np.sin(angle)
    rotation = np.array([[cosine, -sine], [sine, cosine]])
    local[:, :2] = local[:, :2] @ rotation.T
    local[:, :2] += np.asarray(center_xy, dtype=np.float64)
    return local


def render_cuboid(mask_shape, calibration, vertices):
    """Rasterize the convex projected silhouette in original RGB space."""
    height, width = (int(value) for value in mask_shape[:2])
    mask = np.zeros((height, width), dtype=np.uint8)
    pixels, valid = project_table_points(vertices, calibration)
    if len(pixels) < 4 or not np.all(valid):
        return mask.astype(bool)
    hull = cv2.convexHull(np.rint(pixels).astype(np.int32))
    if hull is not None and len(hull) >= 3:
        cv2.fillConvexPoly(mask, hull, 1)
    return mask.astype(bool)


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
