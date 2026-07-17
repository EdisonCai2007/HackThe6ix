"""Fuse LEGO observations from clean rectified views on one table canvas."""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path

import cv2
import numpy as np

from pipeline.color import LegoColor, dominant_rgb, match_color, normalize_illumination
from pipeline.detect import Box, crop_box, detect


_COLOR_FAMILY = {
    "red": "red", "dark red": "red", "pink": "red", "magenta": "red",
    "orange": "orange", "brown": "orange", "dark brown": "orange",
    "tan": "orange",
    "yellow": "yellow", "lime": "yellow",
    "green": "green", "dark green": "green",
    "teal": "blue", "cyan": "blue", "light blue": "blue",
    "blue": "blue", "dark blue": "blue", "purple": "blue",
    "white": "light-neutral", "beige": "light-neutral",
    "light gray": "light-neutral",
    "gray": "dark-neutral", "dark gray": "dark-neutral",
    "black": "dark-neutral",
}


@dataclass
class Observation:
    frame_id: int
    view_index: int
    box: Box
    color: LegoColor
    complete: bool
    boundary_clearance: float
    quality: float
    image: np.ndarray | None = field(default=None, repr=False, compare=False)
    valid_mask: np.ndarray | None = field(default=None, repr=False, compare=False)


@dataclass
class FusedInstance:
    observations: list[Observation]
    best: Observation


def box_is_complete(box: Box, valid_mask: np.ndarray, margin: int = 8) -> bool:
    x0, y0, x1, y1 = box
    h, w = valid_mask.shape[:2]
    ax0, ay0 = x0 - margin, y0 - margin
    ax1, ay1 = x1 + margin, y1 + margin
    if ax0 < 0 or ay0 < 0 or ax1 > w or ay1 > h:
        return False
    return bool(np.all(valid_mask[ay0:ay1, ax0:ax1] > 0))


def _boundary_clearance(box: Box, valid_mask: np.ndarray) -> float:
    distance = cv2.distanceTransform(
        (valid_mask > 0).astype(np.uint8), cv2.DIST_L2, 5
    )
    x0, y0, x1, y1 = box
    region = distance[max(0, y0):y1, max(0, x0):x1]
    return float(region.min()) if region.size else 0.0


def _box_area(box: Box) -> int:
    return max(0, box[2] - box[0]) * max(0, box[3] - box[1])


def _box_iou(first: Box, second: Box) -> float:
    ix0, iy0 = max(first[0], second[0]), max(first[1], second[1])
    ix1, iy1 = min(first[2], second[2]), min(first[3], second[3])
    intersection = max(0, ix1 - ix0) * max(0, iy1 - iy0)
    union = _box_area(first) + _box_area(second) - intersection
    return intersection / union if union else 0.0


def _compatibility(first: Observation, second: Observation) -> float | None:
    if first.view_index == second.view_index:
        return None
    first_family = _COLOR_FAMILY.get(first.color.name, first.color.name)
    second_family = _COLOR_FAMILY.get(second.color.name, second.color.name)
    if first_family != second_family:
        return None
    areas = (_box_area(first.box), _box_area(second.box))
    if min(areas) / max(1, max(areas)) < 0.40:
        return None
    c1 = np.array(((first.box[0] + first.box[2]) / 2,
                   (first.box[1] + first.box[3]) / 2))
    c2 = np.array(((second.box[0] + second.box[2]) / 2,
                   (second.box[1] + second.box[3]) / 2))
    diagonal1 = np.hypot(first.box[2] - first.box[0],
                         first.box[3] - first.box[1])
    diagonal2 = np.hypot(second.box[2] - second.box[0],
                         second.box[3] - second.box[1])
    normalized_distance = float(np.linalg.norm(c1 - c2)) / max(
        1.0, (diagonal1 + diagonal2) / 2
    )
    iou = _box_iou(first.box, second.box)
    if iou < 0.05 and normalized_distance > 0.45:
        return None
    return normalized_distance - 0.5 * iou


def _best_observation(observations: list[Observation]) -> Observation:
    return max(
        observations,
        key=lambda observation: (
            observation.complete,
            observation.boundary_clearance,
            observation.quality,
            _box_area(observation.box),
            -observation.frame_id,
        ),
    )


def fuse_observations(observations: list[Observation]) -> list[FusedInstance]:
    """Associate compatible views deterministically without same-view merges."""
    if not observations:
        return []
    parents = list(range(len(observations)))
    frames = [{observation.view_index} for observation in observations]

    def find(index: int) -> int:
        while parents[index] != index:
            parents[index] = parents[parents[index]]
            index = parents[index]
        return index

    edges = []
    for first_index, first in enumerate(observations):
        for second_index in range(first_index + 1, len(observations)):
            score = _compatibility(first, observations[second_index])
            if score is not None:
                edges.append((score, first.frame_id,
                              observations[second_index].frame_id,
                              first_index, second_index))
    for _, _, _, first_index, second_index in sorted(edges):
        first_root, second_root = find(first_index), find(second_index)
        if first_root == second_root or frames[first_root] & frames[second_root]:
            continue
        parents[second_root] = first_root
        frames[first_root] |= frames[second_root]

    groups: dict[int, list[Observation]] = {}
    for index, observation in enumerate(observations):
        groups.setdefault(find(index), []).append(observation)
    instances = [
        FusedInstance(group, _best_observation(group))
        for group in groups.values()
    ]
    return sorted(
        instances,
        key=lambda instance: (
            instance.best.box[1], instance.best.box[0], instance.best.frame_id
        ),
    )


def _background_rgb(image: np.ndarray) -> tuple[int, int, int]:
    thumb = cv2.resize(image, (200, 200))
    b, g, r = np.median(thumb.reshape(-1, 3), axis=0).astype(int)
    return int(r), int(g), int(b)


def load_observations(manifest_path, detector: str = "cv") -> list[Observation]:
    manifest_path = Path(manifest_path)
    manifest = json.loads(manifest_path.read_text())
    if manifest.get("version") != 1:
        raise ValueError(f"unsupported multiview manifest version: {manifest.get('version')}")
    session_dir = Path(manifest["session_dir"])
    observations: list[Observation] = []
    for view_index, view in enumerate(manifest["views"]):
        image = cv2.imread(str(session_dir / view["image"]))
        valid_mask = cv2.imread(
            str(session_dir / view["mask"]), cv2.IMREAD_GRAYSCALE
        )
        if image is None or valid_mask is None:
            raise ValueError(f"missing multiview image or mask for frame {view['frame_id']}")
        background_rgb = _background_rgb(image)
        detections = detect(image, method=detector)
        for box in detections.boxes:
            crop = crop_box(image, box)
            color = match_color(normalize_illumination(
                dominant_rgb(crop), background_rgb
            ))
            observations.append(Observation(
                frame_id=int(view["frame_id"]),
                view_index=view_index,
                box=box,
                color=color,
                complete=box_is_complete(box, valid_mask),
                boundary_clearance=_boundary_clearance(box, valid_mask),
                quality=float(view["quality"]),
                image=image,
                valid_mask=valid_mask,
            ))
    return observations
