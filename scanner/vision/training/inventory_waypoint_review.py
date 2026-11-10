#!/usr/bin/env python3
"""Build traceable inventory review items from one untouched source frame."""
from __future__ import annotations

import argparse
import json
import shutil
from collections import Counter, defaultdict
from copy import deepcopy
from datetime import datetime, timezone
from pathlib import Path

import cv2
import numpy as np

from pipeline.color import INVENTORY_PALETTE, dominant_rgb_masked, match_color
from training.inventory_review import atomic_write_json, new_review_document
from training.inventory_segmentation_import import (
    ReviewedSession,
    ReviewedShape,
    load_reviewed_bundle,
)


def _read_json(path: Path) -> dict:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise ValueError(f"invalid JSON: {path}") from error


def choose_primary_frame(session: ReviewedSession) -> int:
    """Choose the full source frame whose waypoint count best fits the batch."""
    counts = Counter(shape.frame_id for shape in session.shapes)
    if not counts:
        raise ValueError(f"session has no reviewed shapes: {session.session_id}")
    return min(
        counts,
        key=lambda frame_id: (
            abs(counts[frame_id] - session.expected_count),
            -counts[frame_id],
            frame_id,
        ),
    )


def _component_id(shape: ReviewedShape) -> str:
    shape_index = shape.shape_id.rsplit(":", 1)[-1]
    return f"waypoint-frame-{shape.frame_id:05d}-shape-{shape_index}"


def _padded_box(
    box: tuple[int, int, int, int],
    image_wh: tuple[int, int],
    ratio: float = 0.30,
) -> tuple[int, int, int, int]:
    x0, y0, x1, y1 = map(int, box)
    width, height = map(int, image_wh)
    pad = max(12, round(max(x1 - x0, y1 - y0) * ratio))
    return (
        max(0, x0 - pad),
        max(0, y0 - pad),
        min(width, x1 + pad),
        min(height, y1 + pad),
    )


def _copy_source_frame(shape: ReviewedShape, output_dir: Path) -> tuple[str, list[int]]:
    frame_dir = output_dir / "review-assets" / f"frame-{shape.frame_id:05d}"
    frame_dir.mkdir(parents=True, exist_ok=True)
    destination = frame_dir / "source.jpg"
    if not destination.exists():
        shutil.copy2(shape.image_path, destination)
        if destination.read_bytes() != shape.image_path.read_bytes():
            raise OSError(f"source frame copy differs: {shape.image_path}")
    height, width = shape.image.shape[:2]
    return destination.relative_to(output_dir).as_posix(), [width, height]


def _write_shape_assets(shape: ReviewedShape, output_dir: Path) -> dict:
    frame_path, _ = _copy_source_frame(shape, output_dir)
    frame_dir = output_dir / "review-assets" / f"frame-{shape.frame_id:05d}"
    x0, y0, x1, y1 = _padded_box(
        shape.box_original, shape.image.shape[1::-1]
    )
    crop = shape.image[y0:y1, x0:x1].copy()
    local_mask = np.asarray(shape.mask_original[y0:y1, x0:x1], dtype=bool)
    if crop.size == 0 or not local_mask.any():
        raise ValueError(
            f"invalid waypoint crop: {shape.session_id}/{shape.shape_id}"
        )
    safe_shape_id = shape.shape_id.replace(":", "-")
    crop_path = frame_dir / f"shape-{safe_shape_id}.jpg"
    mask_path = frame_dir / f"shape-{safe_shape_id}-mask.png"
    masked_path = frame_dir / f"shape-{safe_shape_id}-masked.jpg"
    masked = np.full_like(crop, 176)
    masked[local_mask] = crop[local_mask]
    if not cv2.imwrite(str(crop_path), crop):
        raise OSError(f"could not write waypoint crop: {crop_path}")
    if not cv2.imwrite(str(mask_path), local_mask.astype(np.uint8) * 255):
        raise OSError(f"could not write waypoint mask: {mask_path}")
    if not cv2.imwrite(str(masked_path), masked):
        raise OSError(f"could not write masked waypoint crop: {masked_path}")
    return {
        "frame": frame_path,
        "frame_id": int(shape.frame_id),
        "source_shape_id": shape.shape_id,
        "crop": crop_path.relative_to(output_dir).as_posix(),
        "mask": mask_path.relative_to(output_dir).as_posix(),
        "masked_crop": masked_path.relative_to(output_dir).as_posix(),
        "crop_box_original": [x0, y0, x1, y1],
    }


def _exact_shape_owners(old_document: dict) -> dict[str, list[dict]]:
    owners: dict[str, list[dict]] = defaultdict(list)
    for component in old_document.get("components", []):
        for shape_id in (component.get("association") or {}).get(
            "reviewed_shape_ids", []
        ):
            owners[str(shape_id)].append(component)
    return dict(owners)


def _same_crop_color(shape: ReviewedShape) -> str:
    rgb = dominant_rgb_masked(shape.image, shape.mask_original)
    return match_color(rgb, colors=INVENTORY_PALETTE).name


def _clean_candidates(owner: dict | None) -> list[dict]:
    candidates = []
    for candidate in (owner or {}).get("candidates") or []:
        row = deepcopy(candidate)
        row.pop("render_path", None)
        candidates.append(row)
    return candidates


def _shape_component(
    shape: ReviewedShape,
    output_dir: Path,
    owner: dict | None,
) -> dict:
    color = _same_crop_color(shape)
    prediction = deepcopy((owner or {}).get("prediction") or {})
    if not prediction:
        prediction = {
            "part_id": None,
            "part_name": "unknown brick",
            "color": color,
            "score": 0.0,
        }
    prediction["color"] = color
    return {
        "component_id": _component_id(shape),
        "source_anchor": {
            "frame_id": int(shape.frame_id),
            "shape_id": shape.shape_id,
            "box_original": list(map(int, shape.box_original)),
        },
        "prediction": prediction,
        "candidates": _clean_candidates(owner),
        "assets": {"views": [_write_shape_assets(shape, output_dir)]},
        "association": {
            "status": "exact_source_waypoint",
            "reviewed_shape_ids": [shape.shape_id],
            "reviewed_frame_ids": [int(shape.frame_id)],
            "overlap_conflicts": [],
        },
        "provenance": {
            "source": "human_reviewed_labelme_waypoint",
            "source_json": str(shape.source_json),
        },
    }


def _source_frame_rows(
    shapes: list[ReviewedShape],
    output_dir: Path,
    primary_frame_id: int,
) -> list[dict]:
    rows = []
    by_frame: dict[int, list[ReviewedShape]] = defaultdict(list)
    for shape in shapes:
        by_frame[int(shape.frame_id)].append(shape)
    for frame_id, frame_shapes in by_frame.items():
        image, size_wh = _copy_source_frame(frame_shapes[0], output_dir)
        rows.append({
            "frame_id": frame_id,
            "image": image,
            "size_wh": size_wh,
            "primary": frame_id == primary_frame_id,
            "waypoints": [
                {
                    "waypoint_id": shape.shape_id,
                    "component_id": _component_id(shape),
                    "box_original": list(map(int, shape.box_original)),
                }
                for shape in frame_shapes
            ],
        })
    return rows


def _migration_summary(
    old_document: dict,
    owners: dict[str, list[dict]],
    migrated_component_ids: set[str],
    primary_shape_ids: set[str],
) -> dict:
    confirmed = {
        str(row.get("component_id"))
        for row in old_document.get("components", [])
        if (row.get("review") or {}).get("confirmed")
    }
    ambiguous = set()
    for shape_id, rows in owners.items():
        if len(rows) > 1:
            ambiguous.update(
                str(row.get("component_id"))
                for row in rows
                if str(row.get("component_id")) in confirmed
            )
    primary_owner_ids = {
        str(rows[0].get("component_id"))
        for shape_id, rows in owners.items()
        if shape_id in primary_shape_ids and len(rows) == 1
    }
    not_in_primary = confirmed - migrated_component_ids - ambiguous
    not_in_primary |= (confirmed - primary_owner_ids - ambiguous)
    return {
        "eligible_confirmed": len(confirmed),
        "migrated_confirmed": len(migrated_component_ids),
        "ambiguous": len(ambiguous),
        "not_in_primary": len(not_in_primary),
    }


def _build_session_document(
    session: ReviewedSession,
    output_dir: Path,
    old_document: dict,
) -> dict:
    primary_frame_id = choose_primary_frame(session)
    owners = _exact_shape_owners(old_document)
    primary_shapes = [
        shape for shape in session.shapes
        if int(shape.frame_id) == primary_frame_id
    ]
    secondary_shapes = [
        shape for shape in session.shapes
        if int(shape.frame_id) != primary_frame_id
    ]
    primary_components = []
    migrated_component_ids = set()
    for shape in primary_shapes:
        rows = owners.get(shape.shape_id, [])
        owner = rows[0] if len(rows) == 1 else None
        primary_components.append(_shape_component(shape, output_dir, owner))
    document = new_review_document(
        session.session_id, session.expected_count, primary_components
    )
    if session.session_id == "20260718-161438":
        for component in document["components"]:
            shape_id = component["source_anchor"]["shape_id"]
            rows = owners.get(shape_id, [])
            if len(rows) != 1:
                continue
            old_component = rows[0]
            old_review = old_component.get("review") or {}
            if old_review.get("confirmed"):
                component["review"] = deepcopy(old_review)
                migrated_component_ids.add(str(old_component["component_id"]))
    pool = []
    for shape in secondary_shapes:
        rows = owners.get(shape.shape_id, [])
        owner = rows[0] if len(rows) == 1 else None
        pool.append({
            "waypoint_id": shape.shape_id,
            "component": _shape_component(shape, output_dir, owner),
        })
    primary_shape_ids = {shape.shape_id for shape in primary_shapes}
    document.update({
        "run_dir": str(output_dir),
        "primary_frame_id": primary_frame_id,
        "source_frames": _source_frame_rows(
            session.shapes, output_dir, primary_frame_id
        ),
        "waypoint_pool": pool,
        "migration_summary": _migration_summary(
            old_document,
            owners,
            migrated_component_ids,
            primary_shape_ids,
        ),
        "segmentation_source": "human_reviewed_labelme_waypoints",
        "draft_component_count": len(primary_components),
    })
    return document


def build_waypoint_workspace(
    bundle_path: Path,
    workspace_dir: Path,
    *,
    require_all_counts: bool = True,
    run_name: str = "inventory-waypoint-v1",
) -> Path:
    """Create independent source-frame waypoint documents for all sessions."""
    bundle_path = Path(bundle_path).resolve()
    workspace_dir = Path(workspace_dir).resolve()
    if workspace_dir.exists() and any(workspace_dir.iterdir()):
        raise ValueError(f"waypoint workspace must be empty: {workspace_dir}")
    workspace_dir.mkdir(parents=True, exist_ok=True)
    bundle = _read_json(bundle_path)
    sessions = load_reviewed_bundle(
        bundle_path, require_all_counts=require_all_counts
    )
    rows = []
    audit_rows = []
    for bundle_row in bundle.get("sessions") or []:
        session_id = str(bundle_row["session_id"])
        session = sessions[session_id]
        manifest = _read_json(session.manifest_path)
        session_dir = Path(manifest["session_dir"]).resolve()
        old_review_path = (
            session_dir / "analysis-runs" / "inventory-validation-v2" /
            "review.json"
        )
        if not old_review_path.is_file():
            raise FileNotFoundError(
                f"missing prior validation review: {old_review_path}"
            )
        old_document = _read_json(old_review_path)
        output_dir = session_dir / "analysis-runs" / run_name
        if output_dir.exists() and any(output_dir.iterdir()):
            raise ValueError(f"waypoint run must be empty: {output_dir}")
        output_dir.mkdir(parents=True, exist_ok=True)
        document = _build_session_document(
            session, output_dir, old_document
        )
        review_path = output_dir / "review.json"
        atomic_write_json(review_path, document)
        rows.append({
            "session_id": session_id,
            "expected_count": session.expected_count,
            "review_path": str(review_path),
        })
        audit_rows.append({
            "session_id": session_id,
            "expected_count": session.expected_count,
            "primary_frame_id": document["primary_frame_id"],
            "primary_waypoints": len(document["components"]),
            "secondary_waypoints": len(document["waypoint_pool"]),
            "migration_summary": document["migration_summary"],
        })
    total = sum(row["expected_count"] for row in rows)
    workspace_path = workspace_dir / "workspace.json"
    atomic_write_json(workspace_path, {
        "schema_version": 3,
        "name": "LEGO inventory source-frame waypoint validation",
        "created_at": datetime.now(timezone.utc).isoformat(),
        "source_segmentation_bundle": str(bundle_path),
        "expected_physical_total": total,
        "sessions": rows,
    })
    atomic_write_json(workspace_dir / "waypoint-audit.json", {
        "schema_version": 1,
        "expected_physical_total": total,
        "sessions": audit_rows,
    })
    return workspace_path


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Build source-frame LEGO inventory waypoint review"
    )
    parser.add_argument("--bundle", type=Path, required=True)
    parser.add_argument("--workspace-dir", type=Path, required=True)
    parser.add_argument("--run-name", default="inventory-waypoint-v1")
    args = parser.parse_args()
    path = build_waypoint_workspace(
        args.bundle, args.workspace_dir, run_name=args.run_name
    )
    print(path)


if __name__ == "__main__":
    main()
