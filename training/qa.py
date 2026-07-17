"""Render YOLO-seg labels and prioritize frames that need human review."""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import cv2
import numpy as np

from training.labels import (
    LabelValidationError,
    instances_to_masks,
    parse_yolo_seg_line,
    review_sidecar_path,
    validate_label_file,
)
from training.select_frames import read_jsonl


COLORS = [
    (54, 210, 240), (90, 210, 80), (240, 120, 60), (190, 80, 220),
    (40, 150, 255), (220, 200, 40), (70, 80, 240), (180, 220, 110),
]


def _load_valid_instances(label_path: Path):
    instances = []
    if not label_path.exists():
        return instances
    for line in label_path.read_text().splitlines():
        if not line.strip():
            continue
        try:
            instances.append(parse_yolo_seg_line(line))
        except LabelValidationError:
            continue
    return instances


def _touching_or_overlapping(masks: np.ndarray) -> bool:
    if len(masks) < 2:
        return False
    kernel = np.ones((5, 5), np.uint8)
    for left in range(len(masks)):
        expanded = cv2.dilate(masks[left].astype(np.uint8), kernel) > 0
        for right in range(left + 1, len(masks)):
            if np.any(expanded & masks[right]):
                return True
    return False


def _has_boundary_instance(instances, margin: float = 0.02) -> bool:
    return any(
        x <= margin or y <= margin or x >= 1 - margin or y >= 1 - margin
        for instance in instances
        for x, y in instance.points
    )


def _overlay(image: np.ndarray, instances) -> np.ndarray:
    result = image.copy()
    fill = image.copy()
    height, width = image.shape[:2]
    for index, instance in enumerate(instances):
        color = COLORS[index % len(COLORS)]
        points = np.asarray([
            [round(x * (width - 1)), round(y * (height - 1))]
            for x, y in instance.points
        ], dtype=np.int32)
        cv2.fillPoly(fill, [points], color)
        cv2.polylines(result, [points], True, color, 4, cv2.LINE_AA)
        center = points.mean(axis=0).round().astype(int)
        cv2.putText(
            result, str(index + 1), tuple(center), cv2.FONT_HERSHEY_SIMPLEX,
            0.8, (0, 0, 0), 4, cv2.LINE_AA,
        )
        cv2.putText(
            result, str(index + 1), tuple(center), cv2.FONT_HERSHEY_SIMPLEX,
            0.8, (255, 255, 255), 2, cv2.LINE_AA,
        )
    return cv2.addWeighted(fill, 0.28, result, 0.72, 0)


def _contact_sheets(items: list[dict], output_dir: Path) -> list[str]:
    panels = []
    panel_width, panel_height = 320, 270
    for item in items:
        image = cv2.imread(item["overlay"])
        scale = min(panel_width / image.shape[1], 225 / image.shape[0])
        resized = cv2.resize(
            image,
            (round(image.shape[1] * scale), round(image.shape[0] * scale)),
            interpolation=cv2.INTER_AREA,
        )
        panel = np.full((panel_height, panel_width, 3), 25, np.uint8)
        x = (panel_width - resized.shape[1]) // 2
        panel[:resized.shape[0], x:x + resized.shape[1]] = resized
        label = (
            f"P{item['priority_score']} {item['dataset_id'][-18:]} "
            f"n={item['instance_count']}"
        )
        cv2.putText(
            panel, label, (6, 250), cv2.FONT_HERSHEY_SIMPLEX,
            0.43, (255, 255, 255), 1, cv2.LINE_AA,
        )
        panels.append(panel)
    sheets = []
    columns, per_sheet = 4, 20
    blank = np.full((panel_height, panel_width, 3), 25, np.uint8)
    for page, start in enumerate(range(0, len(panels), per_sheet), start=1):
        page_panels = panels[start:start + per_sheet]
        while len(page_panels) % columns:
            page_panels.append(blank.copy())
        sheet = np.vstack([
            np.hstack(page_panels[index:index + columns])
            for index in range(0, len(page_panels), columns)
        ])
        path = output_dir / f"qa-contact-sheet-{page}.jpg"
        cv2.imwrite(str(path), sheet, [cv2.IMWRITE_JPEG_QUALITY, 92])
        sheets.append(str(path.resolve()))
    return sheets


def build_qa(
    selection_manifest: str | Path,
    label_root: str | Path,
    output_dir: str | Path,
) -> Path:
    rows = read_jsonl(selection_manifest)
    label_root = Path(label_root)
    output_dir = Path(output_dir)
    overlays = output_dir / "overlays"
    overlays.mkdir(parents=True, exist_ok=True)
    items = []
    for row in rows:
        dataset_id = row["dataset_id"]
        image = cv2.imread(row["selected_image"])
        if image is None:
            raise ValueError(f"unreadable image: {row['selected_image']}")
        label_path = label_root / f"{dataset_id}.txt"
        issues = validate_label_file(label_path, image.shape[:2])
        instances = _load_valid_instances(label_path)
        masks = instances_to_masks(instances, image.shape[:2])
        touching = _touching_or_overlapping(masks)
        boundary = _has_boundary_instance(instances)
        sidecar_path = review_sidecar_path(label_path)
        review = (
            json.loads(sidecar_path.read_text())
            if sidecar_path.exists() else {}
        )
        status = review.get("status", "missing")
        priority = 100 * bool(issues)
        priority += 50 * (status != "verified")
        priority += 25 * touching
        priority += 10 * bool(row.get("touching_priority"))
        priority += 5 * boundary
        overlay_path = (overlays / f"{dataset_id}.jpg").resolve()
        cv2.imwrite(str(overlay_path), _overlay(image, instances),
                    [cv2.IMWRITE_JPEG_QUALITY, 92])
        items.append({
            "dataset_id": dataset_id,
            "source_session": row["source_session"],
            "source_frame": row["source_frame"],
            "split": row["split"],
            "environment": row["environment"],
            "label": str(label_path.resolve()),
            "review_sidecar": str(sidecar_path.resolve()),
            "review_status": status,
            "annotation_source": review.get("annotation_source"),
            "instance_count": len(instances),
            "touching_or_overlapping": touching,
            "boundary_instance": boundary,
            "issues": [issue.__dict__ for issue in issues],
            "priority_score": priority,
            "overlay": str(overlay_path),
        })
    items.sort(
        key=lambda item: (
            -item["priority_score"], item["source_session"],
            item["source_frame"],
        )
    )
    sheets = _contact_sheets(items, output_dir) if items else []
    report = {
        "version": 1,
        "selection_manifest": str(Path(selection_manifest).resolve()),
        "label_root": str(label_root.resolve()),
        "summary": {
            "images": len(items),
            "verified": sum(
                item["review_status"] == "verified" for item in items
            ),
            "needs_review": sum(
                item["review_status"] != "verified" for item in items
            ),
            "with_issues": sum(bool(item["issues"]) for item in items),
            "touching_or_overlapping": sum(
                item["touching_or_overlapping"] for item in items
            ),
        },
        "contact_sheets": sheets,
        "items": items,
    }
    report_path = output_dir / "qa-report.json"
    report_path.write_text(json.dumps(report, indent=2) + "\n")
    (output_dir / "review-queue.jsonl").write_text(
        "".join(json.dumps(item, sort_keys=True) + "\n" for item in items)
    )
    return report_path


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--selection", type=Path, required=True)
    parser.add_argument("--labels", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    report_path = build_qa(args.selection, args.labels, args.output)
    report = json.loads(report_path.read_text())
    print(json.dumps(report["summary"], indent=2))
    print(report_path)


if __name__ == "__main__":
    main()
