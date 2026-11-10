#!/usr/bin/env python3
"""Export inventory-session fused YOLO masks for direct LabelMe correction."""
from __future__ import annotations

import argparse
import hashlib
import json
import shutil
from datetime import datetime, timezone
from pathlib import Path

import cv2
import numpy as np

from pipeline.multiview import (
    compose_object_aware_mosaic,
    filter_unconfirmed_instances,
    fuse_observations,
    load_views,
    observations_from_segmentations,
    reassign_confirmation_only_instances,
)
from pipeline.segdetect import (
    GateConfig,
    YoloSegModel,
    detect_original_instances,
)


LABELME_VERSION = "6.2.0"
CLASS_NAME = "lego_piece"
INVENTORY_SESSION_COUNTS = {
    "20260718-161438": 48,
    "20260718-161851": 74,
    "20260718-162215": 83,
    "20260718-162458": 64,
    "20260718-162834": 88,
    "20260718-163214": 85,
    "20260718-163451": 63,
    "20260718-163723": 67,
    "20260718-164119": 86,
    "20260718-164730": 57,
    "20260718-165118": 39,
    "20260718-165402": 26,
}


def validate_inventory_count_contract(
    sessions: list[dict], *, require_all: bool = True
) -> None:
    """Reject accidental changes to Emily's recorded physical batch counts."""
    found = set()
    for session in sessions:
        session_id = str(session["session_id"])
        actual = int(session["expected_count"])
        expected = INVENTORY_SESSION_COUNTS.get(session_id)
        if expected is None:
            raise ValueError(f"unexpected inventory session {session_id}")
        if actual != expected:
            raise ValueError(
                f"{session_id} must contain {expected} pieces, got {actual}"
            )
        found.add(session_id)
    if require_all and found != set(INVENTORY_SESSION_COUNTS):
        missing = sorted(set(INVENTORY_SESSION_COUNTS) - found)
        raise ValueError(f"inventory workspace is missing sessions: {missing}")


def copy_source_image(source: Path, destination: Path) -> str:
    """Copy a source RGB frame without decoding/re-encoding it."""
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source, destination)
    source_bytes = source.read_bytes()
    if destination.read_bytes() != source_bytes:
        raise OSError(f"source image copy differs from {source}")
    return hashlib.sha256(source_bytes).hexdigest()


def select_original_review_views(instances, views) -> list[int]:
    """Greedily cover fused pieces, preferring locally sharper observations."""
    if not instances:
        return []
    quality_by_view = {
        int(view.view_index): float(view.quality) for view in views
    }
    coverage: dict[int, set[int]] = {}
    focus: dict[int, float] = {}
    for instance_index, instance in enumerate(instances):
        usable = False
        for observation in instance.observations:
            if observation.mask_original is None:
                continue
            usable = True
            view_index = int(observation.view_index)
            coverage.setdefault(view_index, set()).add(instance_index)
            focus[view_index] = focus.get(view_index, 0.0) + float(
                observation.identification_focus or 0.0
            )
        if not usable:
            raise ValueError(
                f"fused instance {instance_index} has no original-frame mask"
            )
    uncovered = set(range(len(instances)))
    selected = []
    while uncovered:
        candidates = [
            (
                len(instance_ids & uncovered),
                focus.get(view_index, 0.0),
                quality_by_view.get(view_index, 0.0),
                -view_index,
                view_index,
            )
            for view_index, instance_ids in coverage.items()
            if instance_ids & uncovered
        ]
        if not candidates:
            raise ValueError(
                f"could not cover fused instances {sorted(uncovered)}"
            )
        view_index = max(candidates)[-1]
        selected.append(view_index)
        uncovered -= coverage[view_index]
    return selected


def mask_polygon(mask: np.ndarray) -> list[list[float]]:
    """Trace the largest visible contour of one fused instance mask."""
    binary = np.asarray(mask, dtype=np.uint8)
    contours, _ = cv2.findContours(
        binary, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE
    )
    contours = [contour for contour in contours if cv2.contourArea(contour) > 0]
    if not contours:
        raise ValueError("instance mask has no polygon")
    contour = max(contours, key=cv2.contourArea)
    epsilon = max(1.0, 0.002 * cv2.arcLength(contour, True))
    approximated = cv2.approxPolyDP(contour, epsilon, True).reshape(-1, 2)
    if len(approximated) < 3:
        raise ValueError("instance polygon has fewer than three points")
    return [[float(x), float(y)] for x, y in approximated]


def _largest_component_mask(mask: np.ndarray) -> np.ndarray:
    binary = np.asarray(mask, dtype=np.uint8)
    contours, _ = cv2.findContours(
        binary, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE
    )
    contours = [contour for contour in contours if cv2.contourArea(contour) > 0]
    if not contours:
        return np.zeros(binary.shape, dtype=bool)
    result = np.zeros(binary.shape, dtype=np.uint8)
    cv2.drawContours(result, [max(contours, key=cv2.contourArea)], -1, 1, -1)
    return result.astype(bool)


def visible_mask_box(mask: np.ndarray) -> tuple[int, int, int, int]:
    """Return a tight SAM prompt box around the largest visible component."""
    visible = _largest_component_mask(mask)
    ys, xs = np.nonzero(visible)
    if not len(xs):
        raise ValueError("instance mask has no visible component")
    return (
        int(xs.min()),
        int(ys.min()),
        int(xs.max()) + 1,
        int(ys.max()) + 1,
    )


def choose_refined_mask(
    original_mask: np.ndarray, refined_mask: np.ndarray
) -> tuple[np.ndarray, str]:
    """Use SAM only when it still represents the YOLO-prompted physical piece."""
    original = _largest_component_mask(original_mask)
    refined = _largest_component_mask(refined_mask)
    if original.shape != refined.shape:
        raise ValueError("original and refined masks must have the same shape")
    original_area = int(original.sum())
    refined_area = int(refined.sum())
    if not original_area or not refined_area:
        return original, "yolo_fallback"
    intersection = int((original & refined).sum())
    union = original_area + refined_area - intersection
    iou = intersection / max(1, union)
    containment = intersection / max(1, min(original_area, refined_area))
    area_ratio = refined_area / original_area
    if (
        iou >= 0.35
        and containment >= 0.60
        and 0.45 <= area_ratio <= 2.20
    ):
        return refined, "sam2_box_prompt"
    return original, "yolo_fallback"


def refine_masks_with_sam(
    model,
    image: np.ndarray,
    original_masks: list[np.ndarray],
    boxes: list[tuple[int, int, int, int]],
    *,
    device: str,
) -> tuple[list[np.ndarray], list[str]]:
    """Prompt SAM2 once per fused YOLO piece and gate every replacement."""
    if len(original_masks) != len(boxes):
        raise ValueError("one SAM box is required per original mask")
    if not boxes:
        return [], []
    result = model.predict(
        source=image,
        bboxes=[list(map(float, box)) for box in boxes],
        device=device,
        verbose=False,
        retina_masks=True,
        imgsz=1024,
    )[0]
    if result.masks is None or len(result.masks.data) != len(original_masks):
        return (
            [np.asarray(mask, dtype=bool) for mask in original_masks],
            ["yolo_fallback"] * len(original_masks),
        )
    candidates = result.masks.data.detach().cpu().numpy() > 0.5
    selected = []
    sources = []
    height, width = image.shape[:2]
    for original, candidate in zip(original_masks, candidates):
        if candidate.shape != (height, width):
            candidate = cv2.resize(
                candidate.astype(np.uint8),
                (width, height),
                interpolation=cv2.INTER_NEAREST,
            ).astype(bool)
        mask, source = choose_refined_mask(original, candidate)
        selected.append(mask)
        sources.append(source)
    return selected, sources


def labelme_document(
    *,
    image_name: str,
    image_size_wh: tuple[int, int],
    session_id: str,
    expected_count: int,
    polygons: list[list[list[float]]],
    shape_sources: list[str] | None = None,
    frame_id: int | None = None,
    source_rgb: str | None = None,
    source_sha256: str | None = None,
    covered_fused_components: int | None = None,
) -> dict:
    width, height = image_size_wh
    if shape_sources is None:
        shape_sources = ["yolo_fused"] * len(polygons)
    if len(shape_sources) != len(polygons):
        raise ValueError("one source is required per polygon")
    shapes = [
        {
            "label": CLASS_NAME,
            "points": points,
            "group_id": index,
            "description": (
                f"{source} proposal piece-{index - 1:03d}; "
                "verify one physical LEGO piece"
            ),
            "shape_type": "polygon",
            "flags": {},
        }
        for index, (points, source) in enumerate(
            zip(polygons, shape_sources), start=1
        )
    ]
    session = {
        "session_id": session_id,
        "expected_physical_count": int(expected_count),
        "proposal_count": len(polygons),
    }
    if frame_id is not None:
        session["frame_id"] = int(frame_id)
    if source_rgb is not None:
        session["source_rgb"] = source_rgb
    if source_sha256 is not None:
        session["source_sha256"] = source_sha256
    if covered_fused_components is not None:
        session["covered_fused_components"] = int(
            covered_fused_components
        )
    return {
        "version": LABELME_VERSION,
        "flags": {"reviewed": False},
        "shapes": shapes,
        "imagePath": image_name,
        "imageData": None,
        "imageHeight": int(height),
        "imageWidth": int(width),
        "session": session,
    }


def _read_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def export_workspace(
    workspace_path: Path,
    capture_root: Path,
    output_dir: Path,
    model_path: Path,
    sam_checkpoint: Path | None = None,
    device: str = "mps",
    image_mode: str = "mosaic",
) -> Path:
    """Generate editable LabelMe proposals for every inventory batch."""
    workspace = _read_json(workspace_path)
    sessions = workspace.get("sessions") or []
    if not sessions:
        raise ValueError("workspace contains no sessions")
    if image_mode not in {"mosaic", "original"}:
        raise ValueError(f"unsupported image mode: {image_mode}")
    if image_mode == "original":
        validate_inventory_count_contract(sessions)
    if output_dir.exists() and any(output_dir.iterdir()):
        raise ValueError(f"LabelMe output must be empty: {output_dir}")
    review_dir = output_dir / "review"
    review_dir.mkdir(parents=True, exist_ok=True)
    (output_dir / "labels.txt").write_text(f"{CLASS_NAME}\n", encoding="utf-8")

    gate = GateConfig()
    model = YoloSegModel(
        weights=model_path,
        device=device,
        confidence=gate.inference_confidence,
    )
    sam_model = None
    if sam_checkpoint is not None:
        from ultralytics import SAM

        sam_model = SAM(str(sam_checkpoint))
    rows = []
    file_review_index = 0
    for review_index, session in enumerate(sessions, start=1):
        session_id = str(session["session_id"])
        expected_count = int(session["expected_count"])
        manifest_path = (
            capture_root / "sessions" / session_id / "multiview" / "manifest.json"
        )
        if not manifest_path.is_file():
            raise FileNotFoundError(f"missing session manifest: {manifest_path}")
        manifest, views = load_views(manifest_path)
        detections = detect_original_instances(manifest, views, model, gate)
        observations = observations_from_segmentations(detections, views)
        instances = filter_unconfirmed_instances(
            reassign_confirmation_only_instances(
                fuse_observations(observations), views
            ),
            views,
        )
        if image_mode == "original":
            selected_view_indices = select_original_review_views(
                instances, views
            )
            manifest_views = manifest.get("views") or []
            if len(manifest_views) != len(views):
                raise ValueError(
                    f"{session_id} manifest/view count mismatch"
                )
            selected_frames = []
            session_proposals = 0
            session_sam_refined = 0
            for view_index in selected_view_indices:
                view_record = manifest_views[view_index]
                frame_id = int(view_record["frame_id"])
                frame_detections = [
                    detection for detection in detections
                    if detection.accepted
                    and detection.view_index == view_index
                ]
                if not frame_detections:
                    raise ValueError(
                        f"{session_id} selected frame {frame_id} has no "
                        "accepted detections"
                    )
                original_image = frame_detections[0].image_original
                original_masks = [
                    _largest_component_mask(detection.mask_original)
                    for detection in frame_detections
                ]
                boxes = [
                    visible_mask_box(mask) for mask in original_masks
                ]
                if sam_model is not None:
                    selected_masks, shape_sources = refine_masks_with_sam(
                        sam_model,
                        original_image,
                        original_masks,
                        boxes,
                        device=device,
                    )
                else:
                    selected_masks = original_masks
                    shape_sources = [
                        "yolo_original" for _ in original_masks
                    ]
                polygons = [mask_polygon(mask) for mask in selected_masks]
                file_review_index += 1
                stem = (
                    f"{file_review_index:03d}__{session_id}__"
                    f"frame-{frame_id:05d}"
                )
                source_rgb = str(view_record["rgb"])
                source_path = (
                    capture_root / "sessions" / session_id / source_rgb
                )
                image_name = f"{stem}{source_path.suffix.lower()}"
                json_name = f"{stem}.json"
                source_sha256 = copy_source_image(
                    source_path, review_dir / image_name
                )
                height, width = original_image.shape[:2]
                covered_fused_components = sum(
                    any(
                        observation.view_index == view_index
                        and observation.mask_original is not None
                        for observation in instance.observations
                    )
                    for instance in instances
                )
                document = labelme_document(
                    image_name=image_name,
                    image_size_wh=(width, height),
                    session_id=session_id,
                    expected_count=expected_count,
                    polygons=polygons,
                    shape_sources=shape_sources,
                    frame_id=frame_id,
                    source_rgb=source_rgb,
                    source_sha256=source_sha256,
                    covered_fused_components=covered_fused_components,
                )
                (review_dir / json_name).write_text(
                    json.dumps(document, indent=2) + "\n",
                    encoding="utf-8",
                )
                sam_refined_count = shape_sources.count("sam2_box_prompt")
                selected_frames.append({
                    "review_index": file_review_index,
                    "view_index": view_index,
                    "frame_id": frame_id,
                    "image": image_name,
                    "annotation": json_name,
                    "source_rgb": str(source_path.resolve()),
                    "source_sha256": source_sha256,
                    "proposal_count": len(polygons),
                    "sam_refined_count": sam_refined_count,
                    "covered_fused_components": covered_fused_components,
                })
                session_proposals += len(polygons)
                session_sam_refined += sam_refined_count
            rows.append({
                "review_index": review_index,
                "session_id": session_id,
                "expected_physical_count": expected_count,
                "fused_proposal_count": len(instances),
                "selected_frame_count": len(selected_frames),
                "proposal_total": session_proposals,
                "sam_refined_total": session_sam_refined,
                "selected_frames": selected_frames,
                "manifest": str(manifest_path.resolve()),
            })
            print(
                f"[{review_index:02d}/{len(sessions):02d}] {session_id}: "
                f"{len(selected_frames)} original frames; "
                f"{session_proposals} visible proposals; "
                f"physical count {expected_count}",
                flush=True,
            )
            continue
        mosaic = compose_object_aware_mosaic(views, instances)
        original_masks = []
        boxes = []
        for instance in instances:
            if instance.best.mask_canvas is None:
                raise ValueError(
                    f"{session_id} fused instance has no top-down mask"
                )
            visible_mask = _largest_component_mask(
                instance.best.mask_canvas
            )
            original_masks.append(visible_mask)
            boxes.append(visible_mask_box(visible_mask))
        if sam_model is not None:
            selected_masks, shape_sources = refine_masks_with_sam(
                sam_model,
                mosaic,
                original_masks,
                boxes,
                device=device,
            )
        else:
            selected_masks = original_masks
            shape_sources = ["yolo_fused"] * len(original_masks)
        polygons = [mask_polygon(mask) for mask in selected_masks]

        stem = f"{review_index:02d}__{session_id}"
        image_name = f"{stem}.jpg"
        json_name = f"{stem}.json"
        image_path = review_dir / image_name
        if not cv2.imwrite(
            str(image_path), mosaic, [cv2.IMWRITE_JPEG_QUALITY, 95]
        ):
            raise OSError(f"could not write {image_path}")
        height, width = mosaic.shape[:2]
        document = labelme_document(
            image_name=image_name,
            image_size_wh=(width, height),
            session_id=session_id,
            expected_count=expected_count,
            polygons=polygons,
            shape_sources=shape_sources,
        )
        (review_dir / json_name).write_text(
            json.dumps(document, indent=2) + "\n", encoding="utf-8"
        )
        rows.append(
            {
                "review_index": review_index,
                "session_id": session_id,
                "expected_physical_count": expected_count,
                "proposal_count": len(polygons),
                "sam_refined_count": shape_sources.count("sam2_box_prompt"),
                "image": image_name,
                "annotation": json_name,
                "manifest": str(manifest_path.resolve()),
            }
        )
        print(
            f"[{review_index:02d}/{len(sessions):02d}] {session_id}: "
            f"{len(polygons)} proposals; "
            f"SAM refined {shape_sources.count('sam2_box_prompt')}; "
            f"physical count {expected_count}",
            flush=True,
        )

    bundle_path = output_dir / "bundle.json"
    bundle_path.write_text(
        json.dumps(
            {
                "schema_version": 1,
                "created_at": datetime.now(timezone.utc).isoformat(),
                "class_name": CLASS_NAME,
                "image_mode": image_mode,
                "expected_physical_total": sum(
                    row["expected_physical_count"] for row in rows
                ),
                "proposal_total": sum(
                    row.get("proposal_total", row.get("proposal_count", 0))
                    for row in rows
                ),
                "sam_refined_total": sum(
                    row.get(
                        "sam_refined_total",
                        row.get("sam_refined_count", 0),
                    )
                    for row in rows
                ),
                "sessions": rows,
            },
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    return bundle_path


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", type=Path, required=True)
    parser.add_argument("--capture-root", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument(
        "--model",
        type=Path,
        default=Path(__file__).resolve().parents[1] / "models" / "lego_seg.pt",
    )
    parser.add_argument("--sam-checkpoint", type=Path)
    parser.add_argument("--device", default="mps")
    parser.add_argument(
        "--image-mode",
        choices=("mosaic", "original"),
        default="mosaic",
    )
    args = parser.parse_args(argv)
    bundle = export_workspace(
        args.workspace.resolve(),
        args.capture_root.resolve(),
        args.output.resolve(),
        args.model.resolve(),
        (
            args.sam_checkpoint.resolve()
            if args.sam_checkpoint is not None
            else None
        ),
        args.device,
        args.image_mode,
    )
    print(f"LabelMe bundle: {bundle}", flush=True)


if __name__ == "__main__":
    main()
