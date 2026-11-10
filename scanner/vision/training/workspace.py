"""Project the depth-derived physical workspace into a selected RGB frame."""
from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np


@dataclass(frozen=True)
class WorkspaceCrop:
    image: np.ndarray
    workspace_mask: np.ndarray
    box_original: tuple[int, int, int, int]
    contours_table_xy: list[list[list[float]]]
    contours_original_xy: list[np.ndarray]
    hard_source: str


def _admissible_contours_table_xy(
    coverage_path: Path,
    min_seen: int = 2,
    close_cells: int = 5,
    simplify_m: float = 0.005,
) -> list[list[list[float]]]:
    with np.load(coverage_path) as coverage:
        seen = coverage["seen_count"]
        bounds = coverage["bounds"].astype(float)
        cell_m = float(coverage["cell_m"])
    observed = (seen >= min_seen).astype(np.uint8)
    if not observed.any():
        return []
    pad = close_cells
    closed = cv2.morphologyEx(
        np.pad(observed, pad), cv2.MORPH_CLOSE,
        np.ones((close_cells, close_cells), np.uint8),
    )[pad:-pad, pad:-pad]
    _, labels, stats, _ = cv2.connectedComponentsWithStats(closed)
    main = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
    component = (labels == main).astype(np.uint8)
    contours, _ = cv2.findContours(
        component, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE
    )
    result = []
    epsilon_px = simplify_m / cell_m if simplify_m else 0.0
    for contour in sorted(contours, key=cv2.contourArea, reverse=True):
        if epsilon_px:
            contour = cv2.approxPolyDP(contour, epsilon_px, True)
        points = contour.reshape(-1, 2)
        if len(points) < 3:
            continue
        result.append([
            [bounds[0, 0] + (float(x) + 0.5) * cell_m,
             bounds[1, 0] + (float(y) + 0.5) * cell_m]
            for x, y in points
        ])
    return result


def _record_for_frame(session_dir: Path, frame_id: int) -> dict:
    for line in (session_dir / "frames.jsonl").read_text().splitlines():
        if not line.strip():
            continue
        record = json.loads(line)
        if int(record["frame_id"]) == frame_id:
            return record
    raise ValueError(f"frame {frame_id} not found in {session_dir}")


def _plane_homography(record: dict, world_to_table: np.ndarray) -> np.ndarray:
    intrinsics = record["intrinsics"]
    camera_matrix = np.array([
        [intrinsics["fx"], 0.0, intrinsics["cx"]],
        [0.0, intrinsics["fy"], intrinsics["cy"]],
        [0.0, 0.0, 1.0],
    ], dtype=float)
    table_to_world = np.linalg.inv(world_to_table)
    table_xy_to_world = np.zeros((4, 3), dtype=float)
    table_xy_to_world[:3, 0] = table_to_world[:3, 0]
    table_xy_to_world[:3, 1] = table_to_world[:3, 1]
    table_xy_to_world[:3, 2] = (
        table_to_world @ [0.0, 0.0, 0.0, 1.0]
    )[:3]
    table_xy_to_world[3, 2] = 1.0
    world_to_camera = np.linalg.inv(
        np.asarray(record["pose_mat"], dtype=float)
    )
    arkit_to_pinhole = np.diag([1.0, -1.0, -1.0])
    return (
        camera_matrix @ arkit_to_pinhole @ world_to_camera[:3, :]
        @ table_xy_to_world
    )


def _project_contour(homography: np.ndarray, contour) -> np.ndarray:
    points = np.asarray(contour, dtype=np.float32).reshape(1, -1, 2)
    return cv2.perspectiveTransform(points, homography)[0]


def workspace_crop_for_row(
    row: dict, pad_fraction: float = 0.04
) -> WorkspaceCrop:
    source_rgb = Path(row["source_rgb"])
    session_dir = source_rgb.parent.parent
    coverage_path = session_dir / "coverage.npz"
    if not coverage_path.exists():
        raise FileNotFoundError(
            f"missing {coverage_path}; generate detector-independent coverage "
            "before annotation"
        )
    table_path = session_dir / "table_frame.json"
    if not table_path.exists():
        raise FileNotFoundError(f"missing {table_path}")
    image = cv2.imread(str(source_rgb))
    if image is None:
        raise FileNotFoundError(source_rgb)

    contours_table = _admissible_contours_table_xy(coverage_path)
    if not contours_table:
        raise ValueError(f"no repeated physical workspace in {coverage_path}")
    table_frame = json.loads(table_path.read_text())
    record = _record_for_frame(session_dir, int(row["source_frame"]))
    homography = _plane_homography(
        record, np.asarray(table_frame["world_to_table"], dtype=float)
    )
    contours_original = [
        _project_contour(homography, contour) for contour in contours_table
    ]

    full_mask = np.zeros(image.shape[:2], dtype=np.uint8)
    integer_contours = [
        np.rint(contour).astype(np.int32) for contour in contours_original
    ]
    cv2.fillPoly(full_mask, integer_contours, 1)
    ys, xs = np.nonzero(full_mask)
    if not len(xs):
        raise ValueError(
            f"projected workspace for frame {row['source_frame']} is outside image"
        )
    pad = round(max(image.shape[:2]) * max(0.0, pad_fraction))
    x0 = max(0, int(xs.min()) - pad)
    y0 = max(0, int(ys.min()) - pad)
    x1 = min(image.shape[1], int(xs.max()) + 1 + pad)
    y1 = min(image.shape[0], int(ys.max()) + 1 + pad)
    crop_contours = [
        contour - np.array([x0, y0], dtype=np.float32)
        for contour in contours_original
    ]
    return WorkspaceCrop(
        image=image[y0:y1, x0:x1].copy(),
        workspace_mask=full_mask[y0:y1, x0:x1].astype(bool),
        box_original=(x0, y0, x1, y1),
        contours_table_xy=contours_table,
        contours_original_xy=crop_contours,
        hard_source="depth_observed_plane_component",
    )
