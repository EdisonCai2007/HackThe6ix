"""Fuse LEGO observations from clean rectified views on one table canvas."""
from __future__ import annotations

import json
import time
from dataclasses import dataclass, field
from pathlib import Path

import cv2
import numpy as np

from pipeline.color import (
    PALETTE,
    LegoColor,
    dominant_rgb,
    dominant_rgb_masked,
    match_color,
    normalize_illumination,
)
from pipeline.detect import Box, crop_box, detect
from pipeline.dimensions import resolve_dimensions
from pipeline.footprint import aggregate_measurements, measure_observation
from pipeline.identify import MIN_SCORE, identify_all, identify_crop
from pipeline.inventory import build_inventory
from pipeline.studs import advise, analyze_studs, stud_radius_px

SECOND_CHANCE_MAX_ALTERNATES = 3
SEG_SINGLETON_MIN_CONFIDENCE = 0.50
SEG_ID_REVIEW_SCORE = 0.85


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
    detector: str = "cv"
    confidence: float | None = None
    source_instance_id: str | None = None
    box_original: Box | None = None
    mask_original: np.ndarray | None = field(
        default=None, repr=False, compare=False
    )
    mask_canvas: np.ndarray | None = field(
        default=None, repr=False, compare=False
    )
    polygons_canvas: tuple[np.ndarray, ...] = field(
        default=(), repr=False, compare=False
    )
    original_image: np.ndarray | None = field(
        default=None, repr=False, compare=False
    )
    gate_provenance: dict | None = field(
        default=None, repr=False, compare=False
    )


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
    # Bridge geometry (manifest v2, optional): canvas px -> original px.
    homography: np.ndarray | None = None
    rgb: str | None = None
    rgb_size: tuple[int, int] | None = None
    raise_uv_per_cm: tuple[float, float] = (0.0, 0.0)
    topdownness: float | None = None
    sharpness_score: float | None = None
    camera_position_table_xyz: tuple[float, float, float] | None = None
    camera_bearing_deg: float | None = None
    viewing_ray_table_xyz: tuple[float, float, float] | None = None
    view_tilt_deg: float | None = None


@dataclass
class MultiViewScanResult:
    inventory: list[dict]
    instances: list[FusedInstance]
    labels: list[str]
    mosaic: np.ndarray
    manifest: dict
    id_crops: list[dict] = field(default_factory=list)
    crops: list[np.ndarray] = field(default_factory=list)
    views: list["RectifiedView"] = field(default_factory=list)
    segmentation_detections: list = field(default_factory=list)
    timings_s: dict[str, float] = field(default_factory=dict)


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
    areas = (_box_area(first.box), _box_area(second.box))
    min_area_ratio = 0.40 if first.complete and second.complete else 0.20
    if min(areas) / max(1, max(areas)) < min_area_ratio:
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
    same_family = first_family == second_family
    warm_shift = (
        first_family in {"red", "orange", "yellow"}
        and second_family in {"red", "orange", "yellow"}
        and (iou >= 0.08 or normalized_distance <= 0.35)
    )
    neutral_partial_shift = (
        first_family in {"light-neutral", "dark-neutral"}
        and second_family in {"light-neutral", "dark-neutral"}
        and not first.complete and not second.complete
        and (iou >= 0.08 or normalized_distance <= 0.35)
    )
    # Color is supporting evidence, not identity.  The same neutral plate can
    # shift blue/gray under changing white balance; near-identical table-space
    # geometry is stronger than that cross-family color disagreement.
    strong_geometric_match = iou >= 0.60 and normalized_distance <= 0.15
    if not (
        same_family or warm_shift or neutral_partial_shift
        or strong_geometric_match
    ):
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


def consensus_color(instance: FusedInstance) -> LegoColor:
    """Choose color across views instead of trusting one shadow-prone crop."""
    votes: dict[str, int] = {}
    for observation in instance.observations:
        name = observation.color.name
        votes[name] = votes.get(name, 0) + 1
    best_name = instance.best.color.name
    winner = max(votes, key=lambda name: (votes[name], name == best_name))
    return next(color for color in PALETTE if color.name == winner)


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


def filter_unconfirmed_instances(
    instances: list[FusedInstance], views: list[RectifiedView]
) -> list[FusedInstance]:
    """Drop one-view detections contradicted by another usable observation.

    A singleton is retained when no other selected frame covers its table
    location; that is a genuinely single-view/partial piece. Only two or more
    clean views that cover the center without a corresponding object can
    reject it as a per-view shadow/stud artifact.
    """
    kept = []
    for instance in instances:
        if len(views) <= 1:
            kept.append(instance)
            continue
        if len(instance.observations) > 1:
            segmentation = all(
                observation.detector == "seg"
                for observation in instance.observations
            )
            boundary_only = all(
                not observation.complete
                for observation in instance.observations
            )
            if (
                segmentation
                and len(views) >= 3
                and boundary_only
                and len(instance.observations) <= len(views) // 2
            ):
                continue
            kept.append(instance)
            continue
        observation = instance.best
        # With three or more independent segmentation views, a mask seen only
        # once at a workspace/frame boundary is weak evidence, not a countable
        # piece.  The same applies to a very weak complete singleton.  Strong,
        # fully-contained singletons remain valid when other views genuinely
        # do not cover their location.  Keep the classical detector's legacy
        # behavior unchanged.
        if (
            len(views) >= 3
            and observation.detector == "seg"
            and (
                not observation.complete
                or (
                    observation.confidence is not None
                    and observation.confidence < SEG_SINGLETON_MIN_CONFIDENCE
                )
            )
        ):
            continue
        cx = int(round((observation.box[0] + observation.box[2]) / 2))
        cy = int(round((observation.box[1] + observation.box[3]) / 2))
        contradicting_views = sum(
            view.view_index != observation.view_index
            and 0 <= cy < view.valid_mask.shape[0]
            and 0 <= cx < view.valid_mask.shape[1]
            and view.valid_mask[cy, cx] > 0
            for view in views
        )
        if contradicting_views < 2:
            kept.append(instance)
    return kept


def _background_rgb(image: np.ndarray) -> tuple[int, int, int]:
    thumb = cv2.resize(image, (200, 200))
    b, g, r = np.median(thumb.reshape(-1, 3), axis=0).astype(int)
    return int(r), int(g), int(b)


def load_views(manifest_path) -> tuple[dict, list[RectifiedView]]:
    manifest_path = Path(manifest_path)
    manifest = json.loads(manifest_path.read_text())
    if manifest.get("version") not in (1, 2, 3):
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
        homography = view.get("homography")
        camera_position = view.get("camera_position_table_xyz")
        viewing_ray = view.get("viewing_ray_table_xyz")
        views.append(RectifiedView(
            frame_id=int(view["frame_id"]),
            view_index=view_index,
            image=image,
            valid_mask=valid_mask,
            quality=float(view["quality"]),
            homography=None if homography is None else np.array(homography),
            rgb=view.get("rgb"),
            rgb_size=tuple(view["rgb_size"]) if view.get("rgb_size") else None,
            raise_uv_per_cm=tuple(view.get("raise_uv_per_cm", (0.0, 0.0))),
            topdownness=(
                None if view.get("topdownness") is None
                else float(view["topdownness"])
            ),
            sharpness_score=(
                None if view.get("sharpness") is None
                else float(view["sharpness"])
            ),
            camera_position_table_xyz=(
                None if camera_position is None
                else tuple(float(value) for value in camera_position)
            ),
            camera_bearing_deg=(
                None if view.get("camera_bearing_deg") is None
                else float(view["camera_bearing_deg"])
            ),
            viewing_ray_table_xyz=(
                None if viewing_ray is None
                else tuple(float(value) for value in viewing_ray)
            ),
            view_tilt_deg=(
                None if view.get("view_tilt_deg") is None
                else float(view["view_tilt_deg"])
            ),
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
                dominant_rgb(crop), background_rgb, neutral_tolerance=45
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


def observations_from_segmentations(
    detections, views: list[RectifiedView]
) -> list[Observation]:
    """Convert accepted original-frame masks into table-canvas observations."""
    by_index = {view.view_index: view for view in views}
    observations = []
    for detection in detections:
        if not detection.accepted:
            continue
        view = by_index[detection.view_index]
        original = detection.image_original
        background_rgb = _background_rgb(original)
        color = match_color(normalize_illumination(
            dominant_rgb_masked(original, detection.mask_original),
            background_rgb,
            neutral_tolerance=45,
        ))
        gate = detection.gate
        observations.append(Observation(
            frame_id=detection.frame_id,
            view_index=detection.view_index,
            box=detection.box_canvas,
            color=color,
            complete=not gate.boundary_zone,
            boundary_clearance=(
                0.0 if gate.boundary_zone
                else _boundary_clearance(detection.box_canvas, view.valid_mask)
            ),
            quality=view.quality,
            image=view.image,
            valid_mask=view.valid_mask,
            detector="seg",
            confidence=detection.confidence,
            source_instance_id=detection.source_instance_id,
            box_original=detection.box_original,
            mask_original=detection.mask_original,
            mask_canvas=detection.mask_canvas,
            polygons_canvas=detection.polygons_canvas,
            original_image=original,
            gate_provenance={
                "accepted": gate.accepted,
                "reason": gate.reason,
                "workspace_overlap": gate.workspace_overlap,
                "outside_fraction": gate.outside_fraction,
                "centroid_inside": gate.centroid_inside,
                "boundary_zone": gate.boundary_zone,
            },
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
    """Keep one clean base view and supplement only what it cannot see."""
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
    base = max(
        views,
        key=lambda view: (np.count_nonzero(view.valid_mask), view.quality),
    )
    accum = np.zeros((height, width, 3), dtype=np.float64)
    weight_sum = np.zeros((height, width), dtype=np.float64)
    for view in views:
        if view.view_index == base.view_index:
            continue
        distance = cv2.distanceTransform(
            (view.valid_mask > 0).astype(np.uint8), cv2.DIST_L2, 5
        )
        weight = np.clip(distance / 20.0, 0.0, 1.0)
        accum += normalized[view.view_index].astype(np.float64) * weight[..., None]
        weight_sum += weight
    supplement = np.empty((height, width, 3), dtype=np.uint8)
    supplemented = weight_sum > 0
    supplement[supplemented] = np.clip(
        accum[supplemented] / weight_sum[supplemented, None], 0, 255
    ).astype(np.uint8)
    supplement[~supplemented] = target_bgr.astype(np.uint8)
    base_distance = cv2.distanceTransform(
        (base.valid_mask > 0).astype(np.uint8), cv2.DIST_L2, 5
    )
    base_alpha = np.clip(base_distance / 12.0, 0.0, 1.0)[..., None]
    mosaic = np.clip(
        normalized[base.view_index].astype(np.float32) * base_alpha
        + supplement.astype(np.float32) * (1.0 - base_alpha),
        0,
        255,
    ).astype(np.uint8)

    # A complete base-view observation needs no patch at all. For an object
    # visible only partially (or not at all) in the base, copy the best source
    # using a content-shaped alpha mask so rectangular crop edges stay hidden.
    for instance in sorted(instances, key=lambda item: _box_area(item.best.box),
                           reverse=True):
        base_observation = next(
            (observation for observation in instance.observations
             if observation.view_index == base.view_index),
            None,
        )
        if base_observation is not None and base_observation.complete:
            continue
        observation = instance.best
        if observation.view_index == base.view_index:
            continue
        source = normalized[observation.view_index]
        x0, y0, x1, y1 = _expanded_box(observation.box, 6, width, height)
        patch_height, patch_width = y1 - y0, x1 - x0
        if patch_height <= 0 or patch_width <= 0:
            continue
        destination = mosaic[y0:y1, x0:x1].astype(np.float32)
        source_patch = source[y0:y1, x0:x1].astype(np.float32)
        core = np.zeros((patch_height, patch_width), dtype=np.uint8)
        bx0 = max(0, observation.box[0] - x0)
        by0 = max(0, observation.box[1] - y0)
        bx1 = min(patch_width, observation.box[2] - x0)
        by1 = min(patch_height, observation.box[3] - y0)
        core[by0:by1, bx0:bx1] = 1
        ring_pixels = source_patch[core == 0]
        local_background = (
            np.median(ring_pixels, axis=0)
            if len(ring_pixels) else target_bgr
        )
        difference = np.linalg.norm(source_patch - local_background, axis=2)
        foreground = ((difference > 22) & (core > 0)).astype(np.uint8) * 255
        foreground = cv2.morphologyEx(
            foreground, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8)
        )
        foreground = cv2.morphologyEx(
            foreground, cv2.MORPH_CLOSE, np.ones((7, 7), np.uint8)
        )
        alpha = cv2.GaussianBlur(foreground, (9, 9), 0).astype(np.float32)
        alpha = (alpha / 255.0)[..., None]
        mosaic[y0:y1, x0:x1] = np.clip(
            source_patch * alpha + destination * (1.0 - alpha), 0, 255
        ).astype(np.uint8)
    return mosaic


def _ranked_id_observations(
    instance: FusedInstance, views: list[RectifiedView]
) -> list[tuple[Observation, list[int]]]:
    """Observations usable for ORIGINAL-frame ID crops, best first.

    Ranking follows the Bridge spec: least obliquity and sharpness (the
    view's quality) first, canvas completeness after — a piece clipped by
    the workspace canvas is usually whole in the original frame. A view
    whose mapped crop runs off the original image is ranked below all
    fitting ones.
    """
    from pipeline.original_crop import original_box_and_fit

    ranked = []
    for observation in instance.observations:
        view = views[observation.view_index]
        if view.homography is None or view.rgb is None or view.rgb_size is None:
            continue
        if observation.mask_original is not None:
            ys, xs = np.nonzero(observation.mask_original)
            if not len(xs):
                continue
            x0, y0 = int(xs.min()), int(ys.min())
            x1, y1 = int(xs.max()) + 1, int(ys.max()) + 1
            pad_x = max(2, round((x1 - x0) * 0.20))
            pad_y = max(2, round((y1 - y0) * 0.20))
            height, width = observation.mask_original.shape
            fits = (
                x0 - pad_x >= 0 and y0 - pad_y >= 0
                and x1 + pad_x <= width and y1 + pad_y <= height
            )
            box = (
                max(0, x0 - pad_x), max(0, y0 - pad_y),
                min(width, x1 + pad_x), min(height, y1 + pad_y),
            )
        else:
            box, fits = original_box_and_fit(
                observation.box, view.homography, view.rgb_size,
                view.raise_uv_per_cm,
            )
        ranked.append((
            (fits, view.quality, observation.complete,
             observation.boundary_clearance, -observation.frame_id),
            observation, list(box),
        ))
    ranked.sort(key=lambda item: item[0], reverse=True)
    return [(observation, box) for _, observation, box in ranked]


def _identification_observation(
    instance: FusedInstance, views: list[RectifiedView]
) -> tuple[Observation, list[int] | None]:
    ranked = _ranked_id_observations(instance, views)
    if not ranked:
        return instance.best, None
    return ranked[0]


def _identification_crops(
    instances: list[FusedInstance], views: list[RectifiedView],
    session_dir: Path,
) -> tuple[list[np.ndarray], list[dict]]:
    """Cut each instance's ID crop from its chosen view's ORIGINAL frame.

    Rectification is exact only for the table plane; raised pieces get
    stretched in rectified views, which corrupts Brickognize IDs. Falls back
    to the rectified crop for v1 manifests without bridge geometry.
    """
    originals: dict[int, np.ndarray] = {}
    crops, provenance = [], []
    for instance in instances:
        observation, box = _identification_observation(instance, views)
        view = views[observation.view_index]
        if box is None:
            crops.append(crop_box(observation.image, observation.box))
            provenance.append({
                "frame_id": observation.frame_id, "rgb": None,
                "box_original": None, "source": "rectified-fallback",
            })
            continue
        if observation.original_image is not None:
            original = observation.original_image
        elif view.frame_id not in originals:
            original = cv2.imread(str(session_dir / view.rgb))
            if original is None:
                raise ValueError(f"missing original frame {view.rgb}")
            originals[view.frame_id] = original
        else:
            original = originals[view.frame_id]
        if observation.mask_original is not None:
            from pipeline.original_crop import masked_instance_crop

            box, crop = masked_instance_crop(
                original, observation.mask_original
            )
            source = "yolo-instance-mask"
        else:
            from pipeline.original_crop import masked_crop

            box, crop = masked_crop(
                original, observation.box, view.homography,
                original.shape[:2], view.raise_uv_per_cm,
            )
            source = "original-masked"
        crops.append(crop)
        info = {
            "frame_id": observation.frame_id, "rgb": view.rgb,
            "box_original": list(box), "source": source,
        }
        if observation.mask_original is not None:
            info.update({
                "source_instance_id": observation.source_instance_id,
                "segmentation_confidence": observation.confidence,
                "gate": observation.gate_provenance,
            })
        provenance.append(info)
    return crops, provenance


def _isolated_context_crop(
    instance, observation, instances, original, box
):
    """Return real padded context only when no other instance enters it."""
    x0, y0, x1, y1 = box
    for other in instances:
        if other is instance:
            continue
        for candidate in other.observations:
            if (
                candidate.view_index == observation.view_index
                and candidate.mask_original is not None
                and np.any(candidate.mask_original[y0:y1, x0:x1])
            ):
                return None
    return original[y0:y1, x0:x1].copy()


def _second_chance(
    instances, views, session_dir, identifications, crops, id_crops, cache_dir
):
    """Weak chosen-crop IDs get one more try from alternate observations.

    Evidence (234326 orange beam): the top-ranked view's crop identified as
    unknown 0.59 while the next view's crop identified as Brick 1x8 0.84.
    """
    from pipeline.original_crop import masked_crop, masked_instance_crop

    originals: dict[int, np.ndarray] = {}
    for index, instance in enumerate(instances):
        segmentation_review = (
            instance.best.detector == "seg"
            and identifications[index].score < SEG_ID_REVIEW_SCORE
        )
        if (
            identifications[index].score >= MIN_SCORE
            and not segmentation_review
        ):
            continue
        ranked = _ranked_id_observations(instance, views)
        # Evaluate ALL alternates and keep the highest-scoring acceptance:
        # a canvas-clipped alternate can produce a confident-but-wrong ID
        # (a cut-off beam reads as a wedge), so first-accept is unsafe.
        best = None
        best_score = identifications[index].score
        candidates = (
            ranked[:SECOND_CHANCE_MAX_ALTERNATES]
            if segmentation_review
            else ranked[1:1 + SECOND_CHANCE_MAX_ALTERNATES]
        )
        for observation, _ in candidates:
            view = views[observation.view_index]
            if observation.original_image is not None:
                original = observation.original_image
            elif view.frame_id not in originals:
                image = cv2.imread(str(session_dir / view.rgb))
                if image is None:
                    continue
                originals[view.frame_id] = image
                original = image
            else:
                original = originals[view.frame_id]
            if observation.mask_original is not None:
                box, crop = masked_instance_crop(
                    original, observation.mask_original
                )
                variants = [(crop, "yolo-instance-mask-second-chance")]
                context = _isolated_context_crop(
                    instance, observation, instances, original, box
                )
                if context is not None:
                    variants.append((
                        context, "yolo-instance-context-second-chance"
                    ))
            else:
                box, crop = masked_crop(
                    original, observation.box, view.homography,
                    original.shape[:2], view.raise_uv_per_cm,
                )
                variants = [(crop, "original-masked-second-chance")]
            for variant, source in variants:
                candidate = identify_crop(variant, cache_dir=cache_dir)
                if candidate.score >= MIN_SCORE and candidate.score > best_score:
                    best_score = candidate.score
                    best = (
                        candidate, observation, view, box, variant, source
                    )
        if best is not None:
            candidate, observation, view, box, crop, source = best
            identifications[index] = candidate
            crops[index] = crop
            update = {
                "frame_id": observation.frame_id, "rgb": view.rgb,
                "box_original": list(box),
                "source": source,
            }
            if observation.mask_original is not None:
                update.update({
                    "source_instance_id": observation.source_instance_id,
                    "segmentation_confidence": observation.confidence,
                    "gate": observation.gate_provenance,
                })
            id_crops[index].update(update)
    return identifications, crops, id_crops


def _apply_stud_advisory(instances, views, identifications, crops, id_crops,
                         px_per_m):
    for index, instance in enumerate(instances):
        info = id_crops[index]
        ident = identifications[index]
        if info.get("box_original") is None:
            info["stud"] = {
                "count": None,
                "reliability": "unavailable",
                "visibility": "not_visible",
                "action": "no-geometry",
                "reason": "identification crop has no original-frame geometry",
            }
            continue
        matches = [
            observation for observation in instance.observations
            if observation.frame_id == info.get("frame_id")
            and (
                info.get("source_instance_id") is None
                or observation.source_instance_id == info["source_instance_id"]
            )
        ]
        observation = (
            matches[0] if matches
            else _identification_observation(instance, views)[0]
        )
        radius = stud_radius_px(observation.box, info["box_original"], px_per_m)
        local_mask = None
        if observation.mask_original is not None:
            x0, y0, x1, y1 = info["box_original"]
            local_mask = observation.mask_original[y0:y1, x0:x1]
        evidence = analyze_studs(crops[index], radius, mask=local_mask)
        adjusted, action = advise(ident, evidence)
        info["stud"] = evidence.to_dict()
        info["stud"].update({
            "radius_px": round(radius, 1),
            "action": action,
        })
        if adjusted is not ident:
            info["stud"]["was"] = f"{ident.name} ({ident.score:.2f})"
            identifications[index] = adjusted
    return identifications


def _attach_metric_silhouettes(instances, views, id_crops, px_per_m):
    """Serialize polygon measurements without changing identification."""
    by_index = {view.view_index: view for view in views}
    aggregates = []
    for instance, info in zip(instances, id_crops):
        measurements = [
            measure_observation(
                observation,
                px_per_m,
                view=by_index.get(observation.view_index),
            )
            for observation in instance.observations
        ]
        aggregate = aggregate_measurements(measurements)
        aggregates.append(aggregate)
        info["metric_silhouette"] = {
            "action": "shadow_only",
            "evidence": aggregate.to_dict(),
        }
    return aggregates


def _apply_dimension_consistency(
    identifications, metric_silhouettes, id_crops, manifest
):
    selection = manifest.get("selection") or {}
    angle_diverse = selection.get("angle_diverse")
    for index, (identification, metric, info) in enumerate(zip(
        identifications, metric_silhouettes, id_crops
    )):
        decision = resolve_dimensions(identification, metric)
        info["metric_silhouette"]["action"] = decision.action
        info["metric_silhouette"]["decision"] = decision.to_dict()
        flags = []
        if decision.flag is not None:
            flags.append(decision.flag)
        if angle_diverse is False:
            flags.append("insufficient_view_diversity")
        elif angle_diverse is None:
            flags.append("view_diversity_unknown")
        info["flags"] = flags
        identifications[index] = decision.identification
    return identifications


def scan_manifest(
    manifest_path, detector: str = "cv", cache_dir: Path = Path(".cache"),
    seg_model=None, gate_config=None,
) -> MultiViewScanResult:
    started = time.perf_counter()
    manifest, views = load_views(manifest_path)
    loaded = time.perf_counter()
    segmentation_detections = []
    if detector == "seg":
        from pipeline.segdetect import (
            GateConfig,
            YoloSegModel,
            detect_original_instances,
        )

        gate_config = gate_config or GateConfig()
        seg_model = seg_model or YoloSegModel(
            confidence=gate_config.inference_confidence
        )
        segmentation_detections = detect_original_instances(
            manifest, views, seg_model, gate_config
        )
        observations = observations_from_segmentations(
            segmentation_detections, views
        )
    else:
        observations = observations_from_views(views, detector=detector)
    detected = time.perf_counter()
    instances = filter_unconfirmed_instances(
        fuse_observations(observations), views
    )
    fused = time.perf_counter()
    session_dir = Path(manifest["session_dir"])
    crops, id_crops = _identification_crops(instances, views, session_dir)
    identifications = identify_all(crops, cache_dir=cache_dir)
    identifications, crops, id_crops = _second_chance(
        instances, views, session_dir, identifications, crops, id_crops,
        cache_dir,
    )
    for crop_info, identification in zip(id_crops, identifications):
        crop_info["brickognize_raw"] = {
            "part_id": identification.part_id,
            "name": identification.name,
            "score": identification.score,
            "candidates": [dict(candidate)
                           for candidate in identification.candidates],
        }
    identified = time.perf_counter()
    metric_silhouettes = _attach_metric_silhouettes(
        instances, views, id_crops, manifest["px_per_m"]
    )
    identifications = _apply_dimension_consistency(
        identifications, metric_silhouettes, id_crops, manifest
    )
    identifications = _apply_stud_advisory(
        instances, views, identifications, crops, id_crops,
        manifest["px_per_m"],
    )
    evidenced = time.perf_counter()
    for crop_info, identification in zip(id_crops, identifications):
        crop_info["brickognize"] = {
            "part_id": identification.part_id,
            "name": identification.name,
            "score": identification.score,
        }
    colors = [consensus_color(instance) for instance in instances]
    labels = [
        f"{identification.name} | {color.name} | {identification.score:.2f}"
        for identification, color in zip(identifications, colors)
    ]
    inventory = build_inventory(list(zip(identifications, colors)))
    mosaic = compose_object_aware_mosaic(views, instances)
    completed = time.perf_counter()
    return MultiViewScanResult(
        inventory=inventory,
        instances=instances,
        labels=labels,
        mosaic=mosaic,
        manifest=manifest,
        id_crops=id_crops,
        crops=crops,
        views=views,
        segmentation_detections=segmentation_detections,
        timings_s={
            "load": loaded - started,
            "detect": detected - loaded,
            "fuse": fused - detected,
            "identify": identified - fused,
            "evidence": evidenced - identified,
            "color_inventory": completed - evidenced,
            "total": completed - started,
        },
    )
