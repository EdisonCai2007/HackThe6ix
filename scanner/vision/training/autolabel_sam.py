"""Bootstrap explicitly unverified LEGO instance proposals with SAM2."""
from __future__ import annotations

import argparse
import json
import time
from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np

from training.labels import SegInstance, review_sidecar_path
from training.select_frames import read_jsonl
from training.workspace import WorkspaceCrop, workspace_crop_for_row


@dataclass(frozen=True)
class MaskProposal:
    mask: np.ndarray
    score: float
    proposal_id: str


def filter_proposals(
    proposals: list[MaskProposal],
    workspace_mask: np.ndarray,
    min_workspace_overlap: float = 0.60,
    min_area_ratio: float = 0.0001,
    max_area_ratio: float = 0.25,
    nested_overlap: float = 0.90,
    max_parent_area_ratio: float = 30.0,
) -> tuple[list[MaskProposal], list[dict]]:
    """Remove obvious geometry violations and nested subpart proposals.

    This is annotation triage, not a runtime small-object rejection rule. Raw
    masks and every decision are retained for human QA.
    """
    workspace_mask = workspace_mask.astype(bool)
    image_area = workspace_mask.size
    candidates = []
    decisions: dict[str, dict] = {}
    for proposal in proposals:
        mask = proposal.mask.astype(bool)
        if mask.shape != workspace_mask.shape:
            raise ValueError("proposal/workspace mask shape mismatch")
        area = int(mask.sum())
        area_ratio = area / image_area
        overlap = float((mask & workspace_mask).sum() / area) if area else 0.0
        reason = None
        if area_ratio < min_area_ratio:
            reason = "area_below_annotation_floor"
        elif area_ratio > max_area_ratio:
            reason = "area_above_piece_ceiling"
        elif overlap < min_workspace_overlap:
            reason = "workspace_overlap"
        if reason:
            decisions[proposal.proposal_id] = {
                "proposal_id": proposal.proposal_id,
                "accepted": False,
                "reason": reason,
                "score": proposal.score,
                "area_ratio": area_ratio,
                "workspace_overlap": overlap,
            }
            continue
        clipped = MaskProposal(
            mask=mask & workspace_mask,
            score=proposal.score,
            proposal_id=proposal.proposal_id,
        )
        candidates.append((area, clipped, area_ratio, overlap))

    kept = []
    for area, proposal, area_ratio, overlap in sorted(
        candidates, key=lambda item: (-item[0], -item[1].score)
    ):
        nested = False
        for parent in kept:
            parent_area = int(parent.mask.sum())
            containment = float(
                (proposal.mask & parent.mask).sum() / max(1, area)
            )
            if (
                containment >= nested_overlap
                and parent_area / max(1, area) <= max_parent_area_ratio
            ):
                nested = True
                break
        decisions[proposal.proposal_id] = {
            "proposal_id": proposal.proposal_id,
            "accepted": not nested,
            "reason": "nested_subpart" if nested else "accepted_for_review",
            "score": proposal.score,
            "area_ratio": area_ratio,
            "workspace_overlap": overlap,
        }
        if not nested:
            kept.append(proposal)
    ordered_decisions = [
        decisions[proposal.proposal_id] for proposal in proposals
    ]
    return kept, ordered_decisions


def masks_to_yolo_instances(
    masks: np.ndarray, image_shape: tuple[int, int], simplify_fraction: float = 0.002
) -> list[SegInstance]:
    height, width = image_shape
    instances = []
    for mask in masks:
        contours, _ = cv2.findContours(
            mask.astype(np.uint8), cv2.RETR_EXTERNAL,
            cv2.CHAIN_APPROX_SIMPLE,
        )
        if not contours:
            continue
        contour = max(contours, key=cv2.contourArea)
        epsilon = simplify_fraction * cv2.arcLength(contour, True)
        contour = cv2.approxPolyDP(contour, epsilon, True).reshape(-1, 2)
        if len(contour) < 3:
            continue
        points = tuple(
            (float(x) / max(1, width - 1),
             float(y) / max(1, height - 1))
            for x, y in contour
        )
        area = float(cv2.contourArea(contour.astype(np.float32))) / (
            width * height
        )
        if area <= 0:
            continue
        instances.append(SegInstance(0, points, area))
    return instances


def _format_instance(instance: SegInstance) -> str:
    coordinates = " ".join(
        f"{value:.8f}"
        for point in instance.points
        for value in point
    )
    return f"0 {coordinates}"


def write_review_sidecar(
    label_path: str | Path,
    proposals: list[dict],
    checkpoint: str,
    settings: dict,
    extra: dict | None = None,
) -> Path:
    path = review_sidecar_path(label_path)
    data = {
        "version": 1,
        "status": "unverified",
        "annotation_source": checkpoint,
        "reviewer": None,
        "verified_at": None,
        "settings": settings,
        "proposals": proposals,
    }
    if extra:
        data.update(extra)
    path.write_text(json.dumps(data, indent=2) + "\n")
    return path


def load_sam_model(checkpoint: str):
    from ultralytics import SAM
    return SAM(checkpoint)


def _predict_masks(model, image: np.ndarray, device: str, settings: dict):
    started = time.perf_counter()
    results = model.predict(
        source=image,
        device=device,
        verbose=False,
        retina_masks=True,
        imgsz=settings["imgsz"],
        iou=settings["iou"],
    )
    elapsed = time.perf_counter() - started
    result = results[0]
    if result.masks is None:
        return [], elapsed
    masks = result.masks.data.detach().cpu().numpy() > 0.5
    if masks.shape[1:] != image.shape[:2]:
        masks = np.stack([
            cv2.resize(
                mask.astype(np.uint8),
                (image.shape[1], image.shape[0]),
                interpolation=cv2.INTER_NEAREST,
            ).astype(bool)
            for mask in masks
        ])
    if result.boxes is not None and result.boxes.conf is not None:
        scores = result.boxes.conf.detach().cpu().numpy().tolist()
    else:
        scores = [1.0] * len(masks)
    return [
        MaskProposal(mask, float(score), f"sam_{index:04d}")
        for index, (mask, score) in enumerate(zip(masks, scores))
    ], elapsed


def _restore_to_original(
    masks: list[MaskProposal], crop: WorkspaceCrop, original_shape
) -> list[MaskProposal]:
    x0, y0, x1, y1 = crop.box_original
    restored = []
    for proposal in masks:
        full = np.zeros(original_shape, dtype=bool)
        full[y0:y1, x0:x1] = proposal.mask
        restored.append(MaskProposal(full, proposal.score, proposal.proposal_id))
    return restored


def _render_masks(image: np.ndarray, proposals: list[MaskProposal]) -> np.ndarray:
    result = image.copy()
    overlay = image.copy()
    colors = [(60, 210, 250), (90, 220, 80), (240, 120, 60),
              (190, 80, 230), (30, 150, 255), (220, 210, 50)]
    for index, proposal in enumerate(proposals):
        color = colors[index % len(colors)]
        overlay[proposal.mask] = color
        contours, _ = cv2.findContours(
            proposal.mask.astype(np.uint8), cv2.RETR_EXTERNAL,
            cv2.CHAIN_APPROX_SIMPLE,
        )
        cv2.drawContours(result, contours, -1, color, 3, cv2.LINE_AA)
    return cv2.addWeighted(overlay, 0.3, result, 0.7, 0)


def autolabel_selection(
    selection_manifest: str | Path,
    label_root: str | Path,
    checkpoint: str = "sam2.1_s.pt",
    device: str = "mps",
    dataset_ids: set[str] | None = None,
    limit: int | None = None,
) -> Path:
    rows = read_jsonl(selection_manifest)
    if dataset_ids is not None:
        rows = [row for row in rows if row["dataset_id"] in dataset_ids]
    if limit is not None:
        rows = rows[:limit]
    if not rows:
        raise ValueError("no selected frames matched autolabel request")
    label_root = Path(label_root)
    raw_dir = label_root / "raw-overlays"
    filtered_dir = label_root / "filtered-overlays"
    label_root.mkdir(parents=True, exist_ok=True)
    raw_dir.mkdir(exist_ok=True)
    filtered_dir.mkdir(exist_ok=True)
    settings = {
        "device": device,
        "imgsz": 1024,
        "iou": 0.70,
        # Ultralytics 8.4 exposes these as generate() defaults rather than
        # public predict-config keys. Record the effective values, but do not
        # pass them through predict(), whose config validator rejects them.
        "sam_generate_conf_thres": 0.88,
        "sam_generate_points_stride": 32,
        "sam_generate_stability_score_thresh": 0.95,
        "min_workspace_overlap": 0.60,
        "min_area_ratio": 0.0001,
        "max_area_ratio": 0.25,
    }
    model = load_sam_model(checkpoint)
    report_items = []
    for row in rows:
        crop = workspace_crop_for_row(row)
        raw, elapsed = _predict_masks(model, crop.image, device, settings)
        kept, decisions = filter_proposals(
            raw,
            crop.workspace_mask,
            min_workspace_overlap=settings["min_workspace_overlap"],
            min_area_ratio=settings["min_area_ratio"],
            max_area_ratio=settings["max_area_ratio"],
        )
        original = cv2.imread(row["source_rgb"])
        raw_original = _restore_to_original(raw, crop, original.shape[:2])
        kept_original = _restore_to_original(kept, crop, original.shape[:2])
        instances = masks_to_yolo_instances(
            np.asarray([proposal.mask for proposal in kept_original]),
            original.shape[:2],
        ) if kept_original else []
        label_path = label_root / f"{row['dataset_id']}.txt"
        label_path.write_text(
            "".join(_format_instance(instance) + "\n" for instance in instances)
        )
        raw_overlay = raw_dir / f"{row['dataset_id']}.jpg"
        filtered_overlay = filtered_dir / f"{row['dataset_id']}.jpg"
        cv2.imwrite(str(raw_overlay), _render_masks(original, raw_original),
                    [cv2.IMWRITE_JPEG_QUALITY, 92])
        cv2.imwrite(str(filtered_overlay), _render_masks(original, kept_original),
                    [cv2.IMWRITE_JPEG_QUALITY, 92])
        write_review_sidecar(
            label_path,
            proposals=decisions,
            checkpoint=checkpoint,
            settings=settings,
            extra={
                "dataset_id": row["dataset_id"],
                "source_session": row["source_session"],
                "source_frame": row["source_frame"],
                "workspace_hard_source": crop.hard_source,
                "workspace_box_original": list(crop.box_original),
                "raw_overlay": str(raw_overlay.resolve()),
                "filtered_overlay": str(filtered_overlay.resolve()),
                "runtime_s": round(elapsed, 3),
            },
        )
        report_items.append({
            "dataset_id": row["dataset_id"],
            "source_session": row["source_session"],
            "source_frame": row["source_frame"],
            "raw_proposals": len(raw),
            "filtered_proposals": len(kept),
            "label_instances": len(instances),
            "runtime_s": round(elapsed, 3),
            "raw_overlay": str(raw_overlay.resolve()),
            "filtered_overlay": str(filtered_overlay.resolve()),
        })
    report = {
        "version": 1,
        "checkpoint": checkpoint,
        "settings": settings,
        "items": report_items,
        "summary": {
            "images": len(report_items),
            "raw_proposals": sum(x["raw_proposals"] for x in report_items),
            "filtered_proposals": sum(
                x["filtered_proposals"] for x in report_items
            ),
            "runtime_s": round(sum(x["runtime_s"] for x in report_items), 3),
        },
    }
    report_path = label_root / "autolabel-report.json"
    report_path.write_text(json.dumps(report, indent=2) + "\n")
    return report_path


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--selection", type=Path, required=True)
    parser.add_argument("--labels", type=Path, required=True)
    parser.add_argument("--checkpoint", default="sam2.1_s.pt")
    parser.add_argument("--device", default="mps")
    parser.add_argument("--dataset-id", action="append")
    parser.add_argument("--limit", type=int)
    args = parser.parse_args()
    report = autolabel_selection(
        args.selection,
        args.labels,
        checkpoint=args.checkpoint,
        device=args.device,
        dataset_ids=set(args.dataset_id) if args.dataset_id else None,
        limit=args.limit,
    )
    data = json.loads(report.read_text())
    print(json.dumps(data["summary"], indent=2))
    print(report)


if __name__ == "__main__":
    main()
