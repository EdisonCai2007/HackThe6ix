#!/usr/bin/env python3
"""Import immutable human-reviewed inventory masks for final validation."""
from __future__ import annotations

import hashlib
import json
import shutil
import gc
from copy import deepcopy
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

import cv2
import numpy as np

from pipeline.color import INVENTORY_PALETTE, dominant_rgb_masked, match_color
from pipeline.multiview import (
    FusedInstance,
    Observation,
    _masked_focus_score,
    fuse_observations,
)
from pipeline.segdetect import map_instance
from training.inventory_review import atomic_write_json, new_review_document
from training.inventory_review_assets import _write_component_views
from training.inventory_segmentation_labelme import (
    INVENTORY_SESSION_COUNTS,
    validate_inventory_count_contract,
)


Box = tuple[int, int, int, int]


@dataclass
class ReviewedShape:
    shape_id: str
    session_id: str
    frame_id: int
    view_index: int
    group_id: int | None
    source_json: Path
    image_path: Path
    image: np.ndarray = field(repr=False, compare=False)
    mask_original: np.ndarray = field(repr=False, compare=False)
    box_original: Box
    mask_canvas: np.ndarray = field(repr=False, compare=False)
    box_canvas: Box
    polygons_canvas: tuple[np.ndarray, ...] = field(
        default=(), repr=False, compare=False
    )


@dataclass
class ReviewedSession:
    session_id: str
    expected_count: int
    manifest_path: Path
    canvas_wh: tuple[int, int]
    shapes: list[ReviewedShape]


@dataclass(frozen=True)
class OverlapConflict:
    frame_id: int
    shape_ids: tuple[str, str]
    iou: float
    containment: float


@dataclass
class AssociationResult:
    by_anchor: dict[int, list[ReviewedShape]]
    unmatched: list[ReviewedShape]


def _read_json(path: Path) -> dict:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ValueError(f"invalid JSON: {path}") from exc


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _polygon_mask(points, image_wh: tuple[int, int], source: Path) -> np.ndarray:
    width, height = image_wh
    array = np.asarray(points, dtype=np.float32)
    if array.ndim != 2 or array.shape[1:] != (2,) or len(array) < 3:
        raise ValueError(f"invalid polygon points in {source}")
    if not np.isfinite(array).all():
        raise ValueError(f"non-finite polygon point in {source}")
    if (
        np.any(array[:, 0] < 0)
        or np.any(array[:, 0] > width)
        or np.any(array[:, 1] < 0)
        or np.any(array[:, 1] > height)
    ):
        raise ValueError(f"polygon point outside image in {source}")
    mask = np.zeros((height, width), dtype=np.uint8)
    cv2.fillPoly(mask, [np.rint(array).astype(np.int32)], 1)
    if not mask.any():
        raise ValueError(f"empty polygon in {source}")
    return mask.astype(bool)


def _validate_count_rows(sessions: list[dict], require_all: bool) -> None:
    rows = [
        {
            "session_id": row.get("session_id"),
            "expected_count": row.get("expected_physical_count"),
        }
        for row in sessions
    ]
    validate_inventory_count_contract(rows, require_all=require_all)


def load_reviewed_bundle(
    bundle_path: Path, *, require_all_counts: bool = True,
    session_ids: set[str] | None = None,
) -> dict[str, ReviewedSession]:
    """Validate and project completed LabelMe polygons without mutating them."""
    bundle_path = Path(bundle_path).resolve()
    bundle = _read_json(bundle_path)
    if bundle.get("image_mode") != "original":
        raise ValueError("reviewed inventory bundle must use original images")
    session_rows = bundle.get("sessions") or []
    _validate_count_rows(session_rows, require_all_counts)
    if require_all_counts and int(bundle.get("expected_physical_total", 0)) != 780:
        raise ValueError("reviewed inventory bundle must total 780 pieces")
    review_root = bundle_path.parent / "review"
    result = {}
    for session_row in session_rows:
        session_id = str(session_row["session_id"])
        if session_ids is not None and session_id not in session_ids:
            continue
        expected_count = int(session_row["expected_physical_count"])
        manifest_path = Path(session_row["manifest"]).resolve()
        manifest = _read_json(manifest_path)
        canvas_wh = tuple(map(int, manifest["size_wh"]))
        manifest_views = manifest.get("views") or []
        shapes = []
        for frame_row in session_row.get("selected_frames") or []:
            frame_id = int(frame_row["frame_id"])
            view_index = int(frame_row["view_index"])
            if not (0 <= view_index < len(manifest_views)):
                raise ValueError(f"invalid view index for {session_id}/{frame_id}")
            view_record = manifest_views[view_index]
            if int(view_record["frame_id"]) != frame_id:
                raise ValueError(f"frame/view mismatch for {session_id}/{frame_id}")
            homography = np.asarray(view_record["homography"], dtype=np.float64)
            image_path = review_root / frame_row["image"]
            source_path = Path(frame_row["source_rgb"]).resolve()
            annotation_path = review_root / frame_row["annotation"]
            expected_hash = str(frame_row["source_sha256"])
            if (
                _sha256(source_path) != expected_hash
                or _sha256(image_path) != expected_hash
            ):
                raise ValueError(
                    f"review image is not byte-identical to source: {image_path}"
                )
            image = cv2.imread(str(image_path))
            if image is None:
                raise ValueError(f"unreadable review image: {image_path}")
            height, width = image.shape[:2]
            document = _read_json(annotation_path)
            if document.get("flags", {}).get("reviewed") is not True:
                raise ValueError(f"reviewed flag is not checked: {annotation_path}")
            if (
                document.get("imageWidth") != width
                or document.get("imageHeight") != height
            ):
                raise ValueError(f"image dimensions changed: {annotation_path}")
            metadata = document.get("session") or {}
            if (
                str(metadata.get("session_id")) != session_id
                or int(metadata.get("frame_id", -1)) != frame_id
                or int(metadata.get("expected_physical_count", -1))
                != expected_count
            ):
                raise ValueError(f"session metadata changed: {annotation_path}")
            for index, shape in enumerate(document.get("shapes") or [], start=1):
                if shape.get("label") != "lego_piece":
                    raise ValueError(f"invalid shape label in {annotation_path}")
                if shape.get("shape_type") != "polygon":
                    raise ValueError(f"invalid shape type in {annotation_path}")
                mask = _polygon_mask(
                    shape.get("points"), (width, height), annotation_path
                )
                mapped = map_instance(mask, homography, canvas_wh)
                shapes.append(ReviewedShape(
                    shape_id=f"{frame_id:05d}:{index:03d}",
                    session_id=session_id,
                    frame_id=frame_id,
                    view_index=view_index,
                    group_id=(
                        None if shape.get("group_id") is None
                        else int(shape["group_id"])
                    ),
                    source_json=annotation_path,
                    image_path=image_path,
                    image=image,
                    mask_original=mask,
                    box_original=mapped.box_original,
                    mask_canvas=mapped.mask_canvas,
                    box_canvas=mapped.box_canvas,
                    polygons_canvas=mapped.polygons_canvas,
                ))
        result[session_id] = ReviewedSession(
            session_id=session_id,
            expected_count=expected_count,
            manifest_path=manifest_path,
            canvas_wh=canvas_wh,
            shapes=shapes,
        )
    return result


def _box_iou(first: Box, second: Box) -> float:
    ix0, iy0 = max(first[0], second[0]), max(first[1], second[1])
    ix1, iy1 = min(first[2], second[2]), min(first[3], second[3])
    intersection = max(0, ix1 - ix0) * max(0, iy1 - iy0)
    first_area = max(0, first[2] - first[0]) * max(0, first[3] - first[1])
    second_area = max(0, second[2] - second[0]) * max(0, second[3] - second[1])
    union = first_area + second_area - intersection
    return intersection / union if union else 0.0


def _association_edge(first: Box, second: Box):
    first_center = np.asarray(
        [(first[0] + first[2]) / 2, (first[1] + first[3]) / 2]
    )
    second_center = np.asarray(
        [(second[0] + second[2]) / 2, (second[1] + second[3]) / 2]
    )
    first_diagonal = np.hypot(first[2] - first[0], first[3] - first[1])
    second_diagonal = np.hypot(second[2] - second[0], second[3] - second[1])
    normalized_distance = float(np.linalg.norm(first_center - second_center)) / max(
        1.0, (first_diagonal + second_diagonal) / 2
    )
    overlap = _box_iou(first, second)
    if overlap < 0.03 and normalized_distance > 0.55:
        return None
    return normalized_distance - 0.5 * overlap, -overlap, normalized_distance


def associate_reviewed_shapes(
    anchor_boxes: list[Box], shapes: list[ReviewedShape]
) -> AssociationResult:
    """Assign at most one reviewed shape per anchor and source frame."""
    by_anchor = {index: [] for index in range(len(anchor_boxes))}
    matched_shape_ids = set()
    frame_ids = sorted({shape.frame_id for shape in shapes})
    for frame_id in frame_ids:
        frame_shapes = [shape for shape in shapes if shape.frame_id == frame_id]
        edges = []
        for anchor_index, anchor in enumerate(anchor_boxes):
            for shape_index, shape in enumerate(frame_shapes):
                edge = _association_edge(anchor, shape.box_canvas)
                if edge is not None:
                    edges.append((*edge, anchor_index, shape_index))
        used_anchors = set()
        used_shapes = set()
        for _, _, _, anchor_index, shape_index in sorted(edges):
            if anchor_index in used_anchors or shape_index in used_shapes:
                continue
            shape = frame_shapes[shape_index]
            by_anchor[anchor_index].append(shape)
            matched_shape_ids.add(shape.shape_id)
            used_anchors.add(anchor_index)
            used_shapes.add(shape_index)
    return AssociationResult(
        by_anchor=by_anchor,
        unmatched=[
            shape for shape in shapes if shape.shape_id not in matched_shape_ids
        ],
    )


def find_same_frame_overlap_conflicts(
    shapes: list[ReviewedShape], *, iou_threshold: float = 0.75,
    containment_threshold: float = 0.90,
) -> list[OverlapConflict]:
    """Report nested/duplicate candidates without mutating reviewed shapes."""
    conflicts = []
    for first_index, first in enumerate(shapes):
        for second in shapes[first_index + 1:]:
            if first.frame_id != second.frame_id:
                continue
            first_mask = np.asarray(first.mask_original, dtype=bool)
            second_mask = np.asarray(second.mask_original, dtype=bool)
            if first_mask.shape != second_mask.shape:
                continue
            intersection = int((first_mask & second_mask).sum())
            if not intersection:
                continue
            first_area = int(first_mask.sum())
            second_area = int(second_mask.sum())
            union = first_area + second_area - intersection
            iou = intersection / max(1, union)
            containment = intersection / max(1, min(first_area, second_area))
            if iou >= iou_threshold or containment >= containment_threshold:
                conflicts.append(OverlapConflict(
                    frame_id=first.frame_id,
                    shape_ids=(first.shape_id, second.shape_id),
                    iou=float(iou),
                    containment=float(containment),
                ))
    return conflicts


def _shape_observation(shape: ReviewedShape, quality: float) -> Observation:
    color = match_color(
        dominant_rgb_masked(shape.image, shape.mask_original),
        colors=INVENTORY_PALETTE,
    )
    return Observation(
        frame_id=shape.frame_id,
        view_index=shape.view_index,
        box=shape.box_canvas,
        color=color,
        complete=True,
        boundary_clearance=0.0,
        quality=float(quality),
        detector="human_labelme",
        confidence=1.0,
        source_instance_id=shape.shape_id,
        box_original=shape.box_original,
        mask_original=shape.mask_original,
        mask_canvas=shape.mask_canvas,
        polygons_canvas=shape.polygons_canvas,
        original_image=shape.image,
        gate_provenance={
            "accepted": True,
            "reason": "human_reviewed_labelme",
            "source_json": str(shape.source_json),
        },
        identification_focus=_masked_focus_score(
            shape.image, shape.mask_original
        ),
    )


def _fallback_crop(shape: ReviewedShape) -> np.ndarray:
    x0, y0, x1, y1 = shape.box_original
    return shape.image[y0:y1, x0:x1].copy()


def _instance_for_shapes(
    shapes: list[ReviewedShape], quality_by_view: dict[int, float]
) -> FusedInstance:
    observations = [
        _shape_observation(shape, quality_by_view.get(shape.view_index, 1.0))
        for shape in shapes
    ]
    best = max(
        observations,
        key=lambda observation: (
            observation.identification_focus or 0.0,
            int(np.asarray(observation.mask_original).sum()),
            -observation.frame_id,
        ),
    )
    return FusedInstance(observations, best)


def _copied_candidate(candidate: dict) -> dict:
    return deepcopy(candidate)


def build_validation_workspace(
    bundle_path: Path,
    workspace_dir: Path,
    *,
    require_all_counts: bool = True,
    run_name: str = "inventory-validation-v2",
) -> Path:
    """Create new count-gated identity/color review docs from human masks."""
    bundle_path = Path(bundle_path).resolve()
    workspace_dir = Path(workspace_dir).resolve()
    if workspace_dir.exists() and any(workspace_dir.iterdir()):
        raise ValueError(f"validation workspace must be empty: {workspace_dir}")
    bundle = _read_json(bundle_path)
    session_rows = bundle.get("sessions") or []
    _validate_count_rows(session_rows, require_all_counts)
    if require_all_counts and int(bundle.get("expected_physical_total", 0)) != 780:
        raise ValueError("reviewed inventory bundle must total 780 pieces")
    workspace_dir.mkdir(parents=True, exist_ok=True)
    workspace_rows = []
    audit_rows = []
    for bundle_session_row in session_rows:
        session_id = str(bundle_session_row["session_id"])
        session = load_reviewed_bundle(
            bundle_path,
            require_all_counts=require_all_counts,
            session_ids={session_id},
        )[session_id]
        manifest = _read_json(session.manifest_path)
        session_dir = Path(manifest["session_dir"]).resolve()
        old_run = session_dir / "analysis-runs" / "inventory-annotation-v1"
        old_review_path = old_run / "review.json"
        if not old_review_path.is_file():
            raise FileNotFoundError(
                f"missing production prediction anchors: {old_review_path}"
            )
        old_document = _read_json(old_review_path)
        if (
            old_document.get("session_id") != session_id
            or int(old_document.get("expected_physical_count", -1))
            != session.expected_count
        ):
            raise ValueError(f"prediction anchor metadata mismatch: {session_id}")
        output_dir = session_dir / "analysis-runs" / run_name
        if output_dir.exists() and any(output_dir.iterdir()):
            raise ValueError(f"validation run must be empty: {output_dir}")
        output_dir.mkdir(parents=True, exist_ok=True)
        old_assets = old_run / "review-assets"
        if old_assets.is_dir():
            shutil.copytree(old_assets, output_dir / "review-assets")

        old_components = old_document.get("components") or []
        anchor_boxes = [
            tuple(map(int, component["source_anchor"]["box_canvas"]))
            for component in old_components
        ]
        association = associate_reviewed_shapes(anchor_boxes, session.shapes)
        conflicts = find_same_frame_overlap_conflicts(session.shapes)
        conflict_by_shape: dict[str, list[dict]] = {}
        for conflict in conflicts:
            row = {
                "frame_id": conflict.frame_id,
                "shape_ids": list(conflict.shape_ids),
                "iou": conflict.iou,
                "containment": conflict.containment,
            }
            for shape_id in conflict.shape_ids:
                conflict_by_shape.setdefault(shape_id, []).append(row)
        quality_by_view = {
            index: float(view.get("quality", 1.0))
            for index, view in enumerate(manifest.get("views") or [])
        }
        components = []
        shape_owner: dict[str, str] = {}
        for anchor_index, old_component in enumerate(old_components):
            component = deepcopy(old_component)
            component_id = str(component["component_id"])
            matched_shapes = association.by_anchor[anchor_index]
            for shape in matched_shapes:
                shape_owner[shape.shape_id] = component_id
            component_conflicts = []
            for shape in matched_shapes:
                component_conflicts.extend(
                    conflict_by_shape.get(shape.shape_id, [])
                )
            status = (
                "matched_human_review"
                if matched_shapes else "no_reviewed_polygon_match"
            )
            if component_conflicts:
                status = "residual_overlap_conflict"
            component["association"] = {
                "status": status,
                "reviewed_shape_ids": [
                    shape.shape_id for shape in matched_shapes
                ],
                "reviewed_frame_ids": sorted(
                    {shape.frame_id for shape in matched_shapes}
                ),
                "overlap_conflicts": component_conflicts,
            }
            component["candidates"] = [
                _copied_candidate(candidate)
                for candidate in component.get("candidates") or []
            ]
            if matched_shapes:
                instance = _instance_for_shapes(
                    matched_shapes, quality_by_view
                )
                component_dir = (
                    output_dir / "review-assets" / "components" / component_id
                )
                component_dir.mkdir(parents=True, exist_ok=True)
                component["assets"] = {
                    "views": _write_component_views(
                        instance,
                        _fallback_crop(matched_shapes[0]),
                        component_dir,
                        output_dir,
                    )
                }
            components.append(component)

        unmatched_instances = fuse_observations([
            _shape_observation(
                shape, quality_by_view.get(shape.view_index, 1.0)
            )
            for shape in association.unmatched
        ])
        for unmatched_index, instance in enumerate(unmatched_instances):
            component_id = f"human-unmatched-{unmatched_index:03d}"
            matched_shapes = [
                shape for shape in association.unmatched
                if shape.shape_id in {
                    observation.source_instance_id
                    for observation in instance.observations
                }
            ]
            for shape in matched_shapes:
                shape_owner[shape.shape_id] = component_id
            conflicts_for_component = []
            for shape in matched_shapes:
                conflicts_for_component.extend(
                    conflict_by_shape.get(shape.shape_id, [])
                )
            component_dir = (
                output_dir / "review-assets" / "components" / component_id
            )
            component_dir.mkdir(parents=True, exist_ok=True)
            views = _write_component_views(
                instance,
                _fallback_crop(matched_shapes[0]),
                component_dir,
                output_dir,
            )
            components.append({
                "component_id": component_id,
                "source_anchor": {
                    "best_frame_id": int(instance.best.frame_id),
                    "box_canvas": list(map(int, instance.best.box)),
                },
                "prediction": {
                    "part_id": None,
                    "part_name": "unknown brick",
                    "color": instance.best.color.name,
                    "score": 0.0,
                },
                "candidates": [],
                "assets": {"views": views},
                "association": {
                    "status": "human_unmatched",
                    "reviewed_shape_ids": [
                        shape.shape_id for shape in matched_shapes
                    ],
                    "reviewed_frame_ids": sorted(
                        {shape.frame_id for shape in matched_shapes}
                    ),
                    "overlap_conflicts": conflicts_for_component,
                },
            })

        priority = {
            "residual_overlap_conflict": 0,
            "no_reviewed_polygon_match": 1,
            "human_unmatched": 2,
            "matched_human_review": 3,
        }
        components.sort(key=lambda component: (
            priority.get(
                (component.get("association") or {}).get("status"), 4
            ),
            component["component_id"],
        ))
        document = new_review_document(
            session_id, session.expected_count, components
        )
        for component in document["components"]:
            if (
                (component.get("association") or {}).get("status")
                == "matched_human_review"
            ):
                component["review"]["segmentation"] = "correct"
        document["run_dir"] = str(output_dir)
        document["overview_images"] = deepcopy(
            old_document.get("overview_images") or []
        )
        document["overview_size_wh"] = deepcopy(
            old_document.get("overview_size_wh") or list(session.canvas_wh)
        )
        document["draft_component_count"] = len(components)
        document["segmentation_source"] = str(bundle_path)
        document["association_summary"] = {
            "production_anchors": len(old_components),
            "reviewed_polygons": len(session.shapes),
            "matched_anchors": sum(
                bool(rows) for rows in association.by_anchor.values()
            ),
            "unmatched_anchors": sum(
                not rows for rows in association.by_anchor.values()
            ),
            "unmatched_reviewed_polygons": len(association.unmatched),
            "human_unmatched_candidates": len(unmatched_instances),
            "residual_overlap_pairs": len(conflicts),
        }
        review_path = output_dir / "review.json"
        atomic_write_json(review_path, document)
        workspace_rows.append({
            "session_id": session_id,
            "expected_count": session.expected_count,
            "review_path": str(review_path),
        })
        audit_rows.append({
            "session_id": session_id,
            "expected_count": session.expected_count,
            "draft_component_count": len(components),
            **document["association_summary"],
        })
        del session, association, conflicts, unmatched_instances, components
        gc.collect()

    expected_total = sum(row["expected_count"] for row in workspace_rows)
    workspace_path = workspace_dir / "workspace.json"
    atomic_write_json(workspace_path, {
        "schema_version": 2,
        "name": "LEGO inventory validation from reviewed segmentation",
        "created_at": datetime.now(timezone.utc).isoformat(),
        "source_segmentation_bundle": str(bundle_path),
        "expected_physical_total": expected_total,
        "sessions": workspace_rows,
    })
    atomic_write_json(workspace_dir / "association-audit.json", {
        "schema_version": 1,
        "expected_physical_total": expected_total,
        "sessions": audit_rows,
    })
    return workspace_path
