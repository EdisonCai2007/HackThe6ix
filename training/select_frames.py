"""Select a small quality/pose-diverse set of original Record3D frames."""
from __future__ import annotations

import argparse
import hashlib
import json
import shutil
from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np

from training.catalog import Catalog, load_catalog


SELECTION_METHOD = "session_relative_farthest_pose_v1"


@dataclass(frozen=True)
class SelectedFrame:
    frame_id: int
    timestamp: float
    rgb: str
    rgb_size: tuple[int, int]
    sharpness: float
    sharpness_percentile: float
    topdownness: float
    row_index: int
    position: tuple[float, float, float]
    rotation: np.ndarray


def read_jsonl(path: str | Path) -> list[dict]:
    path = Path(path)
    if not path.exists():
        return []
    return [
        json.loads(line)
        for line in path.read_text().splitlines()
        if line.strip()
    ]


def session_split_leaks(rows: list[dict]) -> dict[str, list[str]]:
    splits: dict[str, set[str]] = {}
    for row in rows:
        splits.setdefault(row["source_session"], set()).add(row["split"])
    return {
        session_id: sorted(values)
        for session_id, values in splits.items()
        if len(values) > 1
    }


def _sharpness(image: np.ndarray) -> float:
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    return float(cv2.Laplacian(gray, cv2.CV_64F).var())


def _table_normal(session_dir: Path) -> np.ndarray | None:
    path = session_dir / "table_frame.json"
    if not path.exists():
        return None
    table_frame = json.loads(path.read_text())
    return np.asarray(table_frame["world_to_table"], dtype=float)[2, :3]


def _topdownness(pose: np.ndarray, normal: np.ndarray | None) -> float:
    if normal is None:
        return 1.0
    forward = pose[:3, :3] @ np.array([0.0, 0.0, -1.0])
    return float(np.clip(-(forward @ normal), 0.0, 1.0))


def _percentile_ranks(values: np.ndarray) -> np.ndarray:
    if len(values) == 1:
        return np.ones(1, dtype=float)
    order = np.argsort(values, kind="stable")
    ranks = np.empty(len(values), dtype=float)
    ranks[order] = np.arange(len(values), dtype=float) / (len(values) - 1)
    return ranks


def _rotation_distance(left: np.ndarray, right: np.ndarray) -> float:
    relative = left @ right.T
    cosine = np.clip((np.trace(relative) - 1.0) / 2.0, -1.0, 1.0)
    return float(np.arccos(cosine))


def _candidate_indices(frame_count: int, target_count: int) -> np.ndarray:
    limit = min(frame_count, max(60, target_count * 24))
    return np.unique(np.linspace(0, frame_count - 1, limit, dtype=int))


def _load_candidates(
    session_dir: Path, rows: list[dict], target_count: int
) -> list[SelectedFrame]:
    normal = _table_normal(session_dir)
    raw = []
    for row_index in _candidate_indices(len(rows), target_count):
        row = rows[int(row_index)]
        image = cv2.imread(str(session_dir / row["rgb"]))
        if image is None:
            continue
        pose = np.asarray(row["pose_mat"], dtype=float)
        raw.append({
            "row_index": int(row_index),
            "row": row,
            "pose": pose,
            "sharpness": _sharpness(image),
            "topdownness": _topdownness(pose, normal),
        })
    if not raw:
        return []
    percentiles = _percentile_ranks(
        np.asarray([item["sharpness"] for item in raw])
    )
    result = []
    for item, percentile in zip(raw, percentiles):
        row = item["row"]
        result.append(SelectedFrame(
            frame_id=int(row["frame_id"]),
            timestamp=float(row["timestamp"]),
            rgb=row["rgb"],
            rgb_size=tuple(int(value) for value in row["rgb_size"]),
            sharpness=float(item["sharpness"]),
            sharpness_percentile=float(percentile),
            topdownness=float(item["topdownness"]),
            row_index=item["row_index"],
            position=tuple(float(value) for value in item["pose"][:3, 3]),
            rotation=item["pose"][:3, :3].copy(),
        ))
    return result


def _quality(candidate: SelectedFrame) -> float:
    return 0.65 * candidate.sharpness_percentile + 0.35 * candidate.topdownness


def select_session_frames(
    session_dir: str | Path, target_count: int
) -> list[SelectedFrame]:
    """Choose useful originals without treating adjacent video frames as IID."""
    session_dir = Path(session_dir)
    if target_count <= 0:
        return []
    rows = read_jsonl(session_dir / "frames.jsonl")
    if not rows:
        return []
    candidates = _load_candidates(session_dir, rows, target_count)
    if not candidates:
        return []

    eligible = [
        candidate for candidate in candidates
        if candidate.sharpness_percentile >= 0.20
    ]
    if len(eligible) < min(target_count, len(candidates)):
        eligible = candidates

    first = max(
        eligible,
        key=lambda item: (_quality(item), -item.frame_id),
    )
    selected = [first]
    remaining = [item for item in eligible if item.frame_id != first.frame_id]

    positions = np.asarray([item.position for item in eligible])
    translation_scale = max(
        (float(np.linalg.norm(left - right))
         for left in positions for right in positions),
        default=1.0,
    )
    rotation_scale = max(
        (_rotation_distance(left.rotation, right.rotation)
         for left in eligible for right in eligible),
        default=1.0,
    )
    time_scale = max(
        (abs(left.timestamp - right.timestamp)
         for left in eligible for right in eligible),
        default=1.0,
    )
    translation_scale = max(translation_scale, 1e-9)
    rotation_scale = max(rotation_scale, 1e-9)
    time_scale = max(time_scale, 1e-9)

    while remaining and len(selected) < target_count:
        ranked = []
        for candidate in remaining:
            distances = []
            for chosen in selected:
                translation = (
                    np.linalg.norm(
                        np.asarray(candidate.position) - np.asarray(chosen.position)
                    ) / translation_scale
                )
                rotation = (
                    _rotation_distance(candidate.rotation, chosen.rotation)
                    / rotation_scale
                )
                time = abs(candidate.timestamp - chosen.timestamp) / time_scale
                distances.append(
                    0.45 * translation + 0.35 * rotation + 0.20 * time
                )
            diversity = min(distances)
            score = 0.65 * diversity + 0.35 * _quality(candidate)
            ranked.append((score, _quality(candidate), -candidate.frame_id, candidate))
        chosen = max(ranked, key=lambda item: item[:3])[-1]
        selected.append(chosen)
        remaining.remove(chosen)
    return selected


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def _render_selection_sheets(rows: list[dict], output_dir: Path) -> list[str]:
    panel_width, panel_height = 320, 265
    panels = []
    for row in rows:
        image = cv2.imread(row["selected_image"])
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
            f"{row['source_session'][-6:]} f{row['source_frame']} "
            f"{row['split']}"
        )
        cv2.putText(
            panel, label, (7, 248), cv2.FONT_HERSHEY_SIMPLEX,
            0.46, (255, 255, 255), 1, cv2.LINE_AA,
        )
        panels.append(panel)

    sheets = []
    per_sheet = 20
    columns = 4
    for page, start in enumerate(range(0, len(panels), per_sheet), start=1):
        page_panels = panels[start:start + per_sheet]
        blank = np.full((panel_height, panel_width, 3), 25, np.uint8)
        while len(page_panels) % columns:
            page_panels.append(blank.copy())
        rows_of_panels = [
            np.hstack(page_panels[index:index + columns])
            for index in range(0, len(page_panels), columns)
        ]
        sheet = np.vstack(rows_of_panels)
        path = output_dir / f"selection-contact-sheet-{page}.jpg"
        cv2.imwrite(str(path), sheet, [cv2.IMWRITE_JPEG_QUALITY, 92])
        sheets.append(path.name)
    return sheets


def build_selection(
    catalog: Catalog,
    capture_root: str | Path,
    output_dir: str | Path,
    cohort: str | None = None,
) -> Path:
    catalog.validate()
    capture_root = Path(capture_root)
    output_dir = Path(output_dir)
    images_dir = output_dir / "images"
    images_dir.mkdir(parents=True, exist_ok=True)

    output_rows = []
    for session_id, spec in sorted(catalog.for_cohort(cohort).items()):
        if spec.split == "exclude":
            continue
        session_dir = capture_root / session_id
        if not session_dir.is_dir():
            raise FileNotFoundError(f"missing session directory: {session_dir}")
        selected = select_session_frames(session_dir, spec.target_frames)
        if len(selected) != spec.target_frames:
            raise ValueError(
                f"{session_id}: selected {len(selected)} frames, expected "
                f"{spec.target_frames}"
            )
        for selection_rank, item in enumerate(selected, start=1):
            source = (session_dir / item.rgb).resolve()
            name = f"{session_id}__f{item.frame_id:05d}.jpg"
            destination = (images_dir / name).resolve()
            shutil.copy2(source, destination)
            output_rows.append({
                "dataset_id": destination.stem,
                "source_session": session_id,
                "source_frame": item.frame_id,
                "source_rgb": str(source),
                "source_sha256": _sha256(source),
                "selected_image": str(destination),
                "rgb_size": list(item.rgb_size),
                "environment": spec.environment,
                "split": spec.split,
                "cohort": spec.cohort,
                "dataset_provenance": spec.provenance,
                "selection_method": SELECTION_METHOD,
                "selection_rank": selection_rank,
                "sharpness": round(item.sharpness, 4),
                "sharpness_percentile": round(item.sharpness_percentile, 4),
                "topdownness": round(item.topdownness, 4),
                "annotation_status": "missing",
                "annotation_source": None,
                "touching_priority": spec.touching_priority,
            })

    leaks = session_split_leaks(output_rows)
    if leaks:
        raise ValueError(f"session leakage in selection: {leaks}")
    manifest = output_dir / "manifest.jsonl"
    manifest.write_text(
        "".join(json.dumps(row, sort_keys=True) + "\n" for row in output_rows)
    )
    _render_selection_sheets(output_rows, output_dir)
    return manifest


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--catalog", type=Path, required=True)
    parser.add_argument("--capture-root", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument(
        "--cohort", default="all",
        help="catalog cohort or 'all' (default: all)",
    )
    args = parser.parse_args()
    manifest = build_selection(
        load_catalog(args.catalog), args.capture_root, args.output,
        None if args.cohort == "all" else args.cohort,
    )
    rows = read_jsonl(manifest)
    counts = {
        split: sum(row["split"] == split for row in rows)
        for split in ("train", "val", "test")
    }
    print(f"wrote {manifest} ({len(rows)} frames: {counts})")


if __name__ == "__main__":
    main()
