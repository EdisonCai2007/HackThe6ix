"""Fuse LEGO observations from clean rectified views on one table canvas."""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path

import cv2
import numpy as np

from pipeline.color import LegoColor, dominant_rgb, match_color, normalize_illumination
from pipeline.detect import Box, crop_box, detect
from pipeline.identify import identify_all
from pipeline.inventory import build_inventory


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


@dataclass
class RectifiedView:
    frame_id: int
    view_index: int
    image: np.ndarray
    valid_mask: np.ndarray
    quality: float


@dataclass
class MultiViewScanResult:
    inventory: list[dict]
    instances: list[FusedInstance]
    labels: list[str]
    mosaic: np.ndarray
    manifest: dict


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


def load_views(manifest_path) -> tuple[dict, list[RectifiedView]]:
    manifest_path = Path(manifest_path)
    manifest = json.loads(manifest_path.read_text())
    if manifest.get("version") != 1:
        raise ValueError(f"unsupported multiview manifest version: {manifest.get('version')}")
    session_dir = Path(manifest["session_dir"])
    views = []
    for view_index, view in enumerate(manifest["views"]):
        image = cv2.imread(str(session_dir / view["image"]))
        valid_mask = cv2.imread(
            str(session_dir / view["mask"]), cv2.IMREAD_GRAYSCALE
        )
        if image is None or valid_mask is None:
            raise ValueError(f"missing multiview image or mask for frame {view['frame_id']}")
        views.append(RectifiedView(
            frame_id=int(view["frame_id"]),
            view_index=view_index,
            image=image,
            valid_mask=valid_mask,
            quality=float(view["quality"]),
        ))
    return manifest, views


def observations_from_views(
    views: list[RectifiedView], detector: str = "cv"
) -> list[Observation]:
    observations: list[Observation] = []
    for view in views:
        image, valid_mask = view.image, view.valid_mask
        background_rgb = _background_rgb(image)
        detections = detect(image, method=detector)
        for box in detections.boxes:
            crop = crop_box(image, box)
            color = match_color(normalize_illumination(
                dominant_rgb(crop), background_rgb
            ))
            observations.append(Observation(
                frame_id=view.frame_id,
                view_index=view.view_index,
                box=box,
                color=color,
                complete=box_is_complete(box, valid_mask),
                boundary_clearance=_boundary_clearance(box, valid_mask),
                quality=view.quality,
                image=image,
                valid_mask=valid_mask,
            ))
    return observations


def load_observations(manifest_path, detector: str = "cv") -> list[Observation]:
    _, views = load_views(manifest_path)
    return observations_from_views(views, detector=detector)


def _normalized_view(view: RectifiedView, target_bgr: np.ndarray) -> np.ndarray:
    valid_pixels = view.image[view.valid_mask > 0]
    background = (np.median(valid_pixels, axis=0) if len(valid_pixels)
                  else np.ones(3) * 128)
    gain = np.clip(target_bgr / np.maximum(background, 1), 0.75, 1.35)
    return np.clip(view.image.astype(np.float32) * gain, 0, 255).astype(np.uint8)


def _expanded_box(box: Box, pad: int, width: int, height: int) -> Box:
    return (max(0, box[0] - pad), max(0, box[1] - pad),
            min(width, box[2] + pad), min(height, box[3] + pad))


def compose_object_aware_mosaic(
    views: list[RectifiedView], instances: list[FusedInstance]
) -> np.ndarray:
    """Blend table pixels, then insert each selected piece from one view."""
    if not views:
        raise ValueError("cannot compose a mosaic without rectified views")
    height, width = views[0].image.shape[:2]
    medians = [
        np.median(view.image[view.valid_mask > 0], axis=0)
        for view in views if np.any(view.valid_mask > 0)
    ]
    target_bgr = np.median(np.stack(medians), axis=0)
    normalized = {
        view.view_index: _normalized_view(view, target_bgr) for view in views
    }
    protected = {
        view.view_index: np.zeros((height, width), dtype=np.uint8)
        for view in views
    }
    for instance in instances:
        for observation in instance.observations:
            x0, y0, x1, y1 = _expanded_box(
                observation.box, 8, width, height
            )
            protected[observation.view_index][y0:y1, x0:x1] = 255

    accum = np.zeros((height, width, 3), dtype=np.float64)
    weight_sum = np.zeros((height, width), dtype=np.float64)
    for view in views:
        background_valid = (
            (view.valid_mask > 0) & (protected[view.view_index] == 0)
        ).astype(np.uint8)
        distance = cv2.distanceTransform(background_valid, cv2.DIST_L2, 5)
        weight = np.clip(distance / 20.0, 0.0, 1.0)
        accum += normalized[view.view_index].astype(np.float64) * weight[..., None]
        weight_sum += weight
    mosaic = np.empty((height, width, 3), dtype=np.uint8)
    covered = weight_sum > 0
    mosaic[covered] = np.clip(
        accum[covered] / weight_sum[covered, None], 0, 255
    ).astype(np.uint8)
    mosaic[~covered] = target_bgr.astype(np.uint8)

    # Copy each chosen object observation as one indivisible patch. Only the
    # outer table-colored padding is feathered; no source seam crosses a box.
    for instance in sorted(instances, key=lambda item: _box_area(item.best.box),
                           reverse=True):
        observation = instance.best
        source = normalized[observation.view_index]
        x0, y0, x1, y1 = _expanded_box(observation.box, 6, width, height)
        patch_height, patch_width = y1 - y0, x1 - x0
        if patch_height <= 0 or patch_width <= 0:
            continue
        yy, xx = np.mgrid[:patch_height, :patch_width]
        edge_distance = np.minimum.reduce([
            yy + 1, xx + 1, patch_height - yy, patch_width - xx
        ]).astype(np.float32)
        alpha = np.clip(edge_distance / 5.0, 0.0, 1.0)[..., None]
        destination = mosaic[y0:y1, x0:x1].astype(np.float32)
        source_patch = source[y0:y1, x0:x1].astype(np.float32)
        mosaic[y0:y1, x0:x1] = np.clip(
            source_patch * alpha + destination * (1.0 - alpha), 0, 255
        ).astype(np.uint8)
    return mosaic


def scan_manifest(
    manifest_path, detector: str = "cv", cache_dir: Path = Path(".cache")
) -> MultiViewScanResult:
    manifest, views = load_views(manifest_path)
    observations = observations_from_views(views, detector=detector)
    instances = fuse_observations(observations)
    crops = [crop_box(instance.best.image, instance.best.box)
             for instance in instances]
    identifications = identify_all(crops, cache_dir=cache_dir)
    colors = [instance.best.color for instance in instances]
    labels = [
        f"{identification.name} | {color.name} | {identification.score:.2f}"
        for identification, color in zip(identifications, colors)
    ]
    return MultiViewScanResult(
        inventory=build_inventory(list(zip(identifications, colors))),
        instances=instances,
        labels=labels,
        mosaic=compose_object_aware_mosaic(views, instances),
        manifest=manifest,
    )
