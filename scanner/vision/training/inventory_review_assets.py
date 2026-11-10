"""Export inspectable assets for exact-count inventory review."""
from __future__ import annotations

import re
from pathlib import Path
from typing import Callable

import cv2
import numpy as np
import requests

from pipeline.original_crop import masked_instance_crop
from training.inventory_review import atomic_write_json, new_review_document


MAX_REVIEW_VIEWS = 3


def _default_render_fetch(url: str) -> bytes:
    response = requests.get(url, timeout=15)
    response.raise_for_status()
    return response.content


def _safe_part_id(part_id: str) -> str:
    return re.sub(r"[^A-Za-z0-9_-]+", "_", part_id)


def _candidate_rows(info: dict) -> list[dict]:
    sources = []
    for key in ("brickognize_primary", "brickognize_raw"):
        sources.extend((info.get(key) or {}).get("candidates") or [])
    for view in info.get("brickognize_views") or []:
        sources.extend(view.get("candidates") or [])
    rows = {}
    for candidate in sources:
        part_id = str(candidate.get("part_id") or "").strip()
        if not part_id:
            continue
        row = {
            "part_id": part_id,
            "part_name": candidate.get("name") or part_id,
            "score": float(candidate.get("score", 0.0)),
            "img_url": candidate.get("img_url"),
            "render_path": None,
        }
        previous = rows.get(part_id)
        if previous is None or row["score"] > previous["score"]:
            rows[part_id] = row
    return sorted(rows.values(), key=lambda row: row["score"], reverse=True)


def _write_render(
    candidate: dict,
    output_dir: Path,
    render_fetch: Callable[[str], bytes],
) -> None:
    url = candidate.get("img_url")
    if not url:
        return
    relative = Path("review-assets") / "part-renders" / (
        f"{_safe_part_id(candidate['part_id'])}.webp"
    )
    destination = output_dir / relative
    if not destination.exists():
        try:
            content = render_fetch(url)
            if not content:
                return
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_bytes(content)
        except (OSError, requests.RequestException):
            return
    candidate["render_path"] = str(relative)


def _write_component_views(
    instance, fallback_crop: np.ndarray, component_dir: Path,
    output_dir: Path,
) -> list[dict]:
    written = []
    seen_frames = set()
    observations = sorted(
        instance.observations,
        key=lambda observation: (
            observation is instance.best,
            observation.original_image is not None,
            observation.mask_original is not None,
            -observation.frame_id,
        ),
        reverse=True,
    )
    for observation in observations:
        if observation.frame_id in seen_frames:
            continue
        if observation.original_image is None or observation.mask_original is None:
            continue
        try:
            box, masked = masked_instance_crop(
                observation.original_image, observation.mask_original
            )
        except ValueError:
            continue
        x0, y0, x1, y1 = box
        crop = observation.original_image[y0:y1, x0:x1]
        mask = (
            np.asarray(observation.mask_original[y0:y1, x0:x1], dtype=np.uint8)
            * 255
        )
        index = len(written)
        base = component_dir / f"view-{index:02d}"
        crop_path = base.with_name(base.name + "-crop.jpg")
        mask_path = base.with_name(base.name + "-mask.png")
        masked_path = base.with_name(base.name + "-masked.png")
        cv2.imwrite(str(crop_path), crop, [cv2.IMWRITE_JPEG_QUALITY, 94])
        cv2.imwrite(str(mask_path), mask)
        cv2.imwrite(str(masked_path), masked)
        written.append({
            "frame_id": int(observation.frame_id),
            "box_original": list(map(int, box)),
            "crop": str(crop_path.relative_to(output_dir)),
            "mask": str(mask_path.relative_to(output_dir)),
            "masked_crop": str(masked_path.relative_to(output_dir)),
        })
        seen_frames.add(observation.frame_id)
        if len(written) >= MAX_REVIEW_VIEWS:
            break
    if written:
        return written

    component_dir.mkdir(parents=True, exist_ok=True)
    crop = np.asarray(fallback_crop)
    mask = np.full(crop.shape[:2], 255, dtype=np.uint8)
    crop_path = component_dir / "view-00-crop.jpg"
    mask_path = component_dir / "view-00-mask.png"
    masked_path = component_dir / "view-00-masked.png"
    cv2.imwrite(str(crop_path), crop, [cv2.IMWRITE_JPEG_QUALITY, 94])
    cv2.imwrite(str(mask_path), mask)
    cv2.imwrite(str(masked_path), crop)
    return [{
        "frame_id": None,
        "box_original": None,
        "crop": str(crop_path.relative_to(output_dir)),
        "mask": str(mask_path.relative_to(output_dir)),
        "masked_crop": str(masked_path.relative_to(output_dir)),
    }]


def _write_overview(result, output_dir: Path) -> list[str]:
    image = np.asarray(result.mosaic).copy()
    for index, instance in enumerate(result.instances):
        observation = instance.best
        mask = observation.mask_canvas
        color = (40 + (index * 67) % 180, 80 + (index * 43) % 160,
                 90 + (index * 97) % 150)
        if mask is not None and np.asarray(mask).shape == image.shape[:2]:
            selected = np.asarray(mask, dtype=bool)
            overlay = image.copy()
            overlay[selected] = color
            image = cv2.addWeighted(overlay, 0.28, image, 0.72, 0)
            contours, _ = cv2.findContours(
                selected.astype(np.uint8), cv2.RETR_EXTERNAL,
                cv2.CHAIN_APPROX_SIMPLE,
            )
            cv2.drawContours(image, contours, -1, color, 2)
        x0, y0, _, _ = observation.box
        cv2.putText(
            image, f"{index:03d}", (max(2, x0), max(18, y0 - 4)),
            cv2.FONT_HERSHEY_SIMPLEX, 0.55, color, 2, cv2.LINE_AA,
        )
    relative = Path("review-assets") / "overview.jpg"
    destination = output_dir / relative
    destination.parent.mkdir(parents=True, exist_ok=True)
    cv2.imwrite(str(destination), image, [cv2.IMWRITE_JPEG_QUALITY, 92])
    return [str(relative)]


def write_review_bundle(
    result,
    session_dir: Path,
    output_dir: Path,
    expected_count: int,
    *,
    color_names: list[str] | None = None,
    render_fetch: Callable[[str], bytes] | None = None,
) -> Path:
    """Write review assets and a new human-annotation document."""
    output_dir = Path(output_dir)
    session_dir = Path(session_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    if color_names is None:
        from pipeline.multiview import consensus_color
        color_names = [consensus_color(instance).name
                       for instance in result.instances]
    if len(color_names) != len(result.instances):
        raise ValueError("one color name is required per fused component")
    fetch = render_fetch or _default_render_fetch
    components = []
    for index, (instance, crop, info, color) in enumerate(zip(
        result.instances, result.crops, result.id_crops, color_names
    )):
        component_id = f"piece-{index:03d}"
        component_dir = (
            output_dir / "review-assets" / "components" / component_id
        )
        component_dir.mkdir(parents=True, exist_ok=True)
        views = _write_component_views(
            instance, crop, component_dir, output_dir
        )
        candidates = _candidate_rows(info)
        for candidate in candidates:
            _write_render(candidate, output_dir, fetch)
        identification = info.get("brickognize") or {}
        components.append({
            "component_id": component_id,
            "source_anchor": {
                "best_frame_id": int(instance.best.frame_id),
                "box_canvas": list(map(int, instance.best.box)),
            },
            "prediction": {
                "part_id": identification.get("part_id"),
                "part_name": identification.get("name") or "unknown brick",
                "color": color,
                "score": float(identification.get("score", 0.0)),
            },
            "candidates": candidates,
            "assets": {"views": views},
        })
    document = new_review_document(
        session_dir.name, int(expected_count), components
    )
    document["run_dir"] = str(output_dir.resolve())
    document["overview_images"] = _write_overview(result, output_dir)
    document["overview_size_wh"] = [
        int(result.mosaic.shape[1]), int(result.mosaic.shape[0])
    ]
    document["draft_component_count"] = len(components)
    path = output_dir / "review.json"
    atomic_write_json(path, document)
    return path
