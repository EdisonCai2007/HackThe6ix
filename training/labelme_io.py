"""Lossless Labelme review bundles for SAM-bootstrapped LEGO masks."""
from __future__ import annotations

import argparse
import json
import shutil
from datetime import datetime, timezone
from pathlib import Path

import cv2

from training.labels import (
    LabelValidationError,
    parse_label_file,
    parse_yolo_seg_line,
    review_sidecar_path,
    validate_label_file,
)
from training.select_frames import read_jsonl


LABELME_VERSION = "6.2.0"
CLASS_NAME = "lego_piece"


def _read_json(path: Path) -> dict:
    try:
        return json.loads(path.read_text())
    except (OSError, json.JSONDecodeError) as exc:
        raise ValueError(f"invalid JSON: {path}") from exc


def _write_json(path: Path, data: dict) -> None:
    path.write_text(json.dumps(data, indent=2) + "\n")


def _format_instance(points: list[tuple[float, float]]) -> str:
    values = " ".join(
        f"{coordinate:.8f}"
        for point in points
        for coordinate in point
    )
    return f"0 {values}"


def export_labelme_bundle(
    selection_manifest: str | Path,
    label_root: str | Path,
    qa_report: str | Path,
    output_dir: str | Path,
) -> Path:
    """Export proposals beside byte-identical images in QA priority order."""
    selection_manifest = Path(selection_manifest)
    label_root = Path(label_root)
    qa_report = Path(qa_report)
    output_dir = Path(output_dir)
    bundle_manifest = output_dir / "bundle-manifest.jsonl"
    if output_dir.exists() and any(output_dir.iterdir()):
        raise ValueError(f"review bundle output must be empty: {output_dir}")

    rows = read_jsonl(selection_manifest)
    row_by_id = {row["dataset_id"]: row for row in rows}
    qa = _read_json(qa_report)
    qa_items = qa.get("items")
    if not isinstance(qa_items, list):
        raise ValueError("QA report has no items list")
    qa_ids = {item.get("dataset_id") for item in qa_items}
    if qa_ids != set(row_by_id) or len(qa_items) != len(rows):
        raise ValueError("QA report and selection manifest do not match")
    ordered = sorted(
        qa_items,
        key=lambda item: (-item.get("priority_score", 0), item["dataset_id"]),
    )

    review_dir = output_dir / "review"
    review_dir.mkdir(parents=True)
    (output_dir / "labels.txt").write_text(f"{CLASS_NAME}\n")
    exported = []
    for review_index, item in enumerate(ordered, start=1):
        dataset_id = item["dataset_id"]
        row = row_by_id[dataset_id]
        source_image = Path(row["selected_image"])
        image = cv2.imread(str(source_image))
        if image is None:
            raise ValueError(f"unreadable selected image: {source_image}")
        height, width = image.shape[:2]
        label_path = label_root / f"{dataset_id}.txt"
        issues = validate_label_file(label_path, (height, width))
        if issues:
            raise ValueError(
                f"cannot export invalid proposal label {label_path}: "
                + "; ".join(issue.message for issue in issues)
            )
        instances = parse_label_file(label_path)
        original_review_path = review_sidecar_path(label_path)
        original_review = (
            _read_json(original_review_path)
            if original_review_path.exists() else {}
        )

        review_stem = f"{review_index:04d}__{dataset_id}"
        image_name = f"{review_stem}{source_image.suffix.lower()}"
        json_name = f"{review_stem}.json"
        shutil.copy2(source_image, review_dir / image_name)
        shapes = []
        for group_id, instance in enumerate(instances, start=1):
            shapes.append({
                "label": CLASS_NAME,
                "points": [
                    [x * (width - 1), y * (height - 1)]
                    for x, y in instance.points
                ],
                "group_id": group_id,
                "description": "SAM proposal; verify one physical LEGO piece",
                "shape_type": "polygon",
                "flags": {},
            })
        _write_json(review_dir / json_name, {
            "version": LABELME_VERSION,
            "flags": {"reviewed": False},
            "shapes": shapes,
            "imagePath": image_name,
            "imageData": None,
            "imageHeight": height,
            "imageWidth": width,
        })
        exported.append({
            "review_index": review_index,
            "review_image": image_name,
            "review_json": json_name,
            "dataset_id": dataset_id,
            "selected_image": str(source_image.resolve()),
            "source_session": row["source_session"],
            "source_frame": row["source_frame"],
            "source_sha256": row.get("source_sha256"),
            "split": row["split"],
            "environment": row["environment"],
            "image_height": height,
            "image_width": width,
            "proposal_instances": len(instances),
            "qa_priority_score": item.get("priority_score", 0),
            "touching_or_overlapping": bool(
                item.get("touching_or_overlapping")
            ),
            "proposal_annotation_source": original_review.get(
                "annotation_source", "sam2.1_s.pt"
            ),
        })
    bundle_manifest.write_text(
        "".join(json.dumps(row, sort_keys=True) + "\n" for row in exported)
    )
    _write_json(output_dir / "bundle-summary.json", {
        "version": 1,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "class_names": [CLASS_NAME],
        "images": len(exported),
        "priority_images": sum(
            row["touching_or_overlapping"] for row in exported
        ),
        "selection_manifest": str(selection_manifest.resolve()),
        "proposal_label_root": str(label_root.resolve()),
        "qa_report": str(qa_report.resolve()),
    })
    return bundle_manifest


def _labelme_lines(data: dict, row: dict, json_path: Path) -> list[str]:
    width = row["image_width"]
    height = row["image_height"]
    if data.get("imageWidth") != width or data.get("imageHeight") != height:
        raise ValueError(f"image dimensions changed in {json_path}")
    if data.get("flags", {}).get("reviewed") is not True:
        raise ValueError(f"reviewed flag is not checked in {json_path}")
    shapes = data.get("shapes")
    if not isinstance(shapes, list) or not shapes:
        raise ValueError(f"at least one LEGO polygon is required in {json_path}")
    lines = []
    for shape_index, shape in enumerate(shapes, start=1):
        if shape.get("label") != CLASS_NAME:
            raise ValueError(
                f"only {CLASS_NAME} labels are allowed in {json_path} "
                f"(shape {shape_index})"
            )
        if shape.get("shape_type") != "polygon":
            raise ValueError(
                f"shape {shape_index} must be a polygon in {json_path}"
            )
        points = shape.get("points")
        if not isinstance(points, list) or len(points) < 3:
            raise ValueError(
                f"shape {shape_index} needs at least three points in {json_path}"
            )
        normalized = []
        for point in points:
            if not isinstance(point, list) or len(point) != 2:
                raise ValueError(f"invalid point in shape {shape_index}: {json_path}")
            try:
                x, y = float(point[0]), float(point[1])
            except (TypeError, ValueError) as exc:
                raise ValueError(
                    f"non-numeric point in shape {shape_index}: {json_path}"
                ) from exc
            normalized.append((x / max(1, width - 1), y / max(1, height - 1)))
        line = _format_instance(normalized)
        try:
            parse_yolo_seg_line(line)
        except LabelValidationError as exc:
            raise ValueError(
                f"invalid polygon in shape {shape_index} of {json_path}: {exc}"
            ) from exc
        lines.append(line)
    return lines


def import_labelme_bundle(
    bundle_dir: str | Path,
    destination_label_root: str | Path,
    reviewer: str,
    confirm_reviewed: bool,
) -> Path:
    """Validate a completed human review and emit verified YOLO-seg labels."""
    if not confirm_reviewed:
        raise ValueError("explicit confirmation of complete human review is required")
    reviewer = reviewer.strip()
    if not reviewer:
        raise ValueError("a reviewer name is required")
    bundle_dir = Path(bundle_dir)
    destination = Path(destination_label_root)
    if destination.exists() and any(destination.iterdir()):
        raise ValueError(f"verified label output must be empty: {destination}")
    manifest_path = bundle_dir / "bundle-manifest.jsonl"
    if not manifest_path.exists():
        raise ValueError(f"missing bundle manifest: {manifest_path}")
    rows = read_jsonl(manifest_path)
    if not rows:
        raise ValueError("review bundle is empty")

    validated = []
    total_instances = 0
    for row in rows:
        json_path = bundle_dir / "review" / row["review_json"]
        if not json_path.exists():
            raise ValueError(f"missing reviewed JSON: {json_path}")
        lines = _labelme_lines(_read_json(json_path), row, json_path)
        total_instances += len(lines)
        validated.append((row, lines))

    verified_at = datetime.now(timezone.utc).isoformat()
    destination.mkdir(parents=True, exist_ok=True)
    report_rows = []
    for row, lines in validated:
        label_path = destination / f"{row['dataset_id']}.txt"
        label_path.write_text("\n".join(lines) + "\n")
        proposal_source = row.get(
            "proposal_annotation_source", "sam2.1_s.pt"
        )
        sidecar = {
            "version": 1,
            "status": "verified",
            "annotation_source": f"{proposal_source}+human_labelme",
            "reviewer": reviewer,
            "verified_at": verified_at,
            "source_session": row["source_session"],
            "source_frame": row["source_frame"],
            "source_sha256": row.get("source_sha256"),
            "split": row["split"],
            "environment": row["environment"],
            "instance_count": len(lines),
            "review_bundle": str(bundle_dir.resolve()),
            "review_json": row["review_json"],
        }
        _write_json(review_sidecar_path(label_path), sidecar)
        report_rows.append({
            "dataset_id": row["dataset_id"],
            "instances": len(lines),
            "label": str(label_path.resolve()),
        })
    report_path = destination / "import-report.json"
    _write_json(report_path, {
        "version": 1,
        "imported_at": verified_at,
        "reviewer": reviewer,
        "summary": {"images": len(validated), "instances": total_instances},
        "items": report_rows,
    })
    return report_path


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)
    export = subparsers.add_parser("export", help="make a Labelme review bundle")
    export.add_argument("--selection", type=Path, required=True)
    export.add_argument("--labels", type=Path, required=True)
    export.add_argument("--qa", type=Path, required=True)
    export.add_argument("--output", type=Path, required=True)
    import_parser = subparsers.add_parser(
        "import", help="validate reviewed JSON and make verified labels"
    )
    import_parser.add_argument("--bundle", type=Path, required=True)
    import_parser.add_argument("--labels", type=Path, required=True)
    import_parser.add_argument("--reviewer", required=True)
    import_parser.add_argument("--confirm-reviewed", action="store_true")
    args = parser.parse_args()
    if args.command == "export":
        path = export_labelme_bundle(
            args.selection, args.labels, args.qa, args.output
        )
    else:
        path = import_labelme_bundle(
            args.bundle, args.labels, args.reviewer, args.confirm_reviewed
        )
    print(path)


if __name__ == "__main__":
    main()
