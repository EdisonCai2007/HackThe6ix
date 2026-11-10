"""Build a content-addressed YOLO-seg dataset from verified labels."""
from __future__ import annotations

import argparse
import hashlib
import json
import shutil
from pathlib import Path

import cv2
import yaml

from training.labels import review_sidecar_path, validate_label_file
from training.select_frames import read_jsonl, session_split_leaks


def _canonical(value) -> bytes:
    return json.dumps(
        value, sort_keys=True, separators=(",", ":")
    ).encode("utf-8")


def _preflight(
    selection_manifest: Path,
    label_root: Path,
    require_verified: bool,
) -> tuple[list[dict], str]:
    rows = read_jsonl(selection_manifest)
    if not rows:
        raise ValueError("selection manifest is empty")
    leaks = session_split_leaks(rows)
    if leaks:
        raise ValueError(f"session leakage detected: {leaks}")
    if not {row["split"] for row in rows} >= {"train", "val"}:
        raise ValueError("dataset requires non-empty train and val splits")

    prepared = []
    digest = hashlib.sha256()
    seen_ids = set()
    for row in rows:
        dataset_id = row["dataset_id"]
        if dataset_id in seen_ids:
            raise ValueError(f"duplicate dataset_id: {dataset_id}")
        seen_ids.add(dataset_id)
        image_path = Path(row["selected_image"])
        if not image_path.exists():
            raise ValueError(f"missing selected image: {image_path}")
        image = cv2.imread(str(image_path))
        if image is None:
            raise ValueError(f"unreadable selected image: {image_path}")
        label_path = label_root / f"{dataset_id}.txt"
        issues = validate_label_file(label_path, image.shape[:2])
        if issues:
            detail = "; ".join(
                f"{issue.code}:{issue.message}" for issue in issues
            )
            raise ValueError(f"invalid label {label_path}: {detail}")
        sidecar_path = review_sidecar_path(label_path)
        if not sidecar_path.exists():
            raise ValueError(f"missing review sidecar: {sidecar_path}")
        review = json.loads(sidecar_path.read_text())
        if require_verified and review.get("status") != "verified":
            raise ValueError(
                f"unverified label {label_path}: "
                f"status={review.get('status')!r}"
            )
        prepared_row = {
            **row,
            "label_path": str(label_path.resolve()),
            "review_status": review.get("status"),
            "annotation_source": review.get("annotation_source"),
            "reviewer": review.get("reviewer"),
        }
        prepared.append(prepared_row)
        digest.update(_canonical(prepared_row))
        digest.update(label_path.read_bytes())
        digest.update(_canonical(review))
    return prepared, digest.hexdigest()


def build_dataset(
    selection_manifest: str | Path,
    label_root: str | Path,
    output_root: str | Path,
    require_verified: bool = True,
) -> Path:
    selection_manifest = Path(selection_manifest)
    label_root = Path(label_root)
    output_root = Path(output_root)
    prepared, dataset_hash = _preflight(
        selection_manifest, label_root, require_verified
    )
    dataset_root = (output_root / f"lego-seg-{dataset_hash[:12]}").resolve()
    for split in sorted({row["split"] for row in prepared}):
        (dataset_root / "images" / split).mkdir(parents=True, exist_ok=True)
        (dataset_root / "labels" / split).mkdir(parents=True, exist_ok=True)

    manifest_rows = []
    for row in prepared:
        split = row["split"]
        dataset_id = row["dataset_id"]
        image_source = Path(row["selected_image"])
        image_destination = dataset_root / "images" / split / (
            dataset_id + image_source.suffix.lower()
        )
        label_source = Path(row["label_path"])
        label_destination = dataset_root / "labels" / split / f"{dataset_id}.txt"
        shutil.copy2(image_source, image_destination)
        shutil.copy2(label_source, label_destination)
        manifest_rows.append({
            **row,
            "dataset_image": str(image_destination.resolve()),
            "dataset_label": str(label_destination.resolve()),
        })

    manifest_path = dataset_root / "dataset-manifest.jsonl"
    manifest_path.write_text(
        "".join(
            json.dumps(row, sort_keys=True) + "\n" for row in manifest_rows
        )
    )
    counts = {
        split: sum(row["split"] == split for row in manifest_rows)
        for split in ("train", "val", "test")
    }
    metadata = {
        "version": 1,
        "dataset_sha256": dataset_hash,
        "class_names": ["lego_piece"],
        "require_verified": require_verified,
        "counts": counts,
        "sessions_by_split": {
            split: sorted({
                row["source_session"]
                for row in manifest_rows if row["split"] == split
            })
            for split in ("train", "val", "test")
        },
        "provenance_counts": {
            provenance: sum(
                row["dataset_provenance"] == provenance
                for row in manifest_rows
            )
            for provenance in sorted({
                row["dataset_provenance"] for row in manifest_rows
            })
        },
    }
    (dataset_root / "dataset-metadata.json").write_text(
        json.dumps(metadata, indent=2) + "\n"
    )
    data = {
        "path": str(dataset_root),
        "train": "images/train",
        "val": "images/val",
        "names": {0: "lego_piece"},
    }
    if counts["test"]:
        data["test"] = "images/test"
    data_yaml = dataset_root / "data.yaml"
    data_yaml.write_text(yaml.safe_dump(data, sort_keys=False))
    return data_yaml


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--selection", type=Path, required=True)
    parser.add_argument("--labels", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument(
        "--allow-unverified", action="store_true",
        help="QA-only escape hatch; never use its output for model training",
    )
    args = parser.parse_args()
    path = build_dataset(
        args.selection, args.labels, args.output,
        require_verified=not args.allow_unverified,
    )
    print(path)


if __name__ == "__main__":
    main()
