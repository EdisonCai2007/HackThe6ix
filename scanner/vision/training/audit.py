"""Audit Record3D sessions and render representative contact sheets."""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import cv2
import numpy as np

from training.catalog import Catalog, SessionSpec, load_catalog


THUMBNAIL_WH = (360, 270)
SESSIONS_PER_SHEET = 10


def _sharpness(image: np.ndarray) -> float:
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    return float(cv2.Laplacian(gray, cv2.CV_64F).var())


def _topdownness(row: dict, table_normal: np.ndarray | None) -> float:
    if table_normal is None:
        return 1.0
    rotation = np.asarray(row["pose_mat"], dtype=float)[:3, :3]
    forward = rotation @ np.array([0.0, 0.0, -1.0])
    return float(np.clip(-(forward @ table_normal), 0.0, 1.0))


def _read_table_frame(session_dir: Path) -> tuple[dict | None, list[str]]:
    path = session_dir / "table_frame.json"
    if not path.exists():
        return None, ["missing_table_frame"]
    try:
        return json.loads(path.read_text()), []
    except (json.JSONDecodeError, OSError, TypeError):
        return None, ["invalid_table_frame"]


def _load_rows(session_dir: Path) -> tuple[list[dict], list[str]]:
    path = session_dir / "frames.jsonl"
    if not path.exists():
        return [], ["missing_frames_index"]
    rows = []
    warnings = []
    for line_number, line in enumerate(path.read_text().splitlines(), start=1):
        if not line.strip():
            continue
        try:
            rows.append(json.loads(line))
        except json.JSONDecodeError:
            warnings.append(f"invalid_frames_jsonl_line:{line_number}")
    return rows, warnings


def _sample_metrics(
    session_dir: Path, rows: list[dict], table_frame: dict | None
) -> tuple[dict, list[dict]]:
    if not rows:
        return {"p10": None, "median": None, "p90": None}, []
    sample_indices = np.linspace(
        0, len(rows) - 1, min(31, len(rows)), dtype=int
    )
    normal = (
        np.asarray(table_frame["world_to_table"], dtype=float)[2, :3]
        if table_frame is not None else None
    )
    candidates = []
    for index in sample_indices:
        row = rows[int(index)]
        image = cv2.imread(str(session_dir / row["rgb"]))
        if image is None:
            continue
        sharp = _sharpness(image)
        candidates.append({
            "row_index": int(index),
            "frame_id": int(row["frame_id"]),
            "sharpness": sharp,
            "topdownness": _topdownness(row, normal),
            "image": image,
        })
    if not candidates:
        return {"p10": None, "median": None, "p90": None}, []
    values = np.asarray([item["sharpness"] for item in candidates])
    p10, median, p90 = np.percentile(values, [10, 50, 90])

    chosen = []
    boundaries = np.linspace(0, len(rows), 4, dtype=int)
    for start, stop in zip(boundaries[:-1], boundaries[1:]):
        group = [
            item for item in candidates
            if start <= item["row_index"] < max(stop, start + 1)
        ]
        if not group:
            group = candidates
        selected = max(
            group,
            key=lambda item: (
                item["sharpness"] * (0.25 + 0.75 * item["topdownness"] ** 2),
                -item["frame_id"],
            ),
        )
        chosen.append(selected)
    return {
        "p10": round(float(p10), 2),
        "median": round(float(median), 2),
        "p90": round(float(p90), 2),
    }, chosen


def _camera_height_range(rows: list[dict], table_frame: dict | None):
    if not rows or table_frame is None:
        return None
    world_to_table = np.asarray(table_frame["world_to_table"], dtype=float)
    heights = []
    for row in rows:
        position = np.asarray(row["pose_mat"], dtype=float)[:3, 3]
        heights.append(float((world_to_table @ np.r_[position, 1.0])[2]))
    return [round(min(heights), 4), round(max(heights), 4)]


def _audit_one(
    session_id: str, spec: SessionSpec, capture_root: Path
) -> tuple[dict, list[dict]]:
    session_dir = capture_root / session_id
    base = {
        "environment": spec.environment,
        "split": spec.split,
        "target_frames": spec.target_frames,
        "provenance": spec.provenance,
        "scene_density": spec.scene_density,
        "touching_priority": spec.touching_priority,
        "geometry_risk": spec.geometry_risk,
        "catalog_notes": spec.notes,
    }
    if not session_dir.is_dir():
        return {
            **base,
            "status": "missing",
            "warnings": ["missing_session_directory"],
            "frame_count": 0,
        }, []

    rows, warnings = _load_rows(session_dir)
    if not rows:
        if not warnings:
            warnings.append("zero_frames")
        return {
            **base,
            "status": "empty",
            "warnings": warnings,
            "frame_count": 0,
            "duration_s": 0.0,
            "missing_rgb": 0,
            "missing_depth": 0,
            "size_mb": 0.0,
            "sharpness": {"p10": None, "median": None, "p90": None},
            "representative_frames": [],
        }, []

    missing_rgb = sum(not (session_dir / row["rgb"]).exists() for row in rows)
    missing_depth = sum(
        not (session_dir / row["depth"]).exists() for row in rows
    )
    if missing_rgb:
        warnings.append(f"missing_rgb:{missing_rgb}")
    if missing_depth:
        warnings.append(f"missing_depth:{missing_depth}")
    duration = float(rows[-1]["timestamp"] - rows[0]["timestamp"])
    if duration < 5.0:
        warnings.append("short_capture_under_5s")

    table_frame, table_warnings = _read_table_frame(session_dir)
    warnings.extend(table_warnings)
    plane_inliers = None
    extent = None
    if table_frame is not None:
        plane_inliers = float(
            table_frame.get("fit_stats", {}).get("inlier_fraction", 0.0)
        )
        extent = table_frame.get("extent_xy")
        if plane_inliers < 0.8:
            warnings.append("weak_plane_fit_under_0.8")

    sharpness, chosen = _sample_metrics(session_dir, rows, table_frame)
    size_bytes = sum(
        path.stat().st_size
        for path in (session_dir / "frames").glob("*")
        if path.is_file()
    )
    status = "usable" if not (missing_rgb or missing_depth) else "incomplete"
    return {
        **base,
        "status": status,
        "warnings": warnings,
        "frame_count": len(rows),
        "duration_s": round(duration, 3),
        "fps": round(len(rows) / duration, 3) if duration > 0 else None,
        "missing_rgb": missing_rgb,
        "missing_depth": missing_depth,
        "size_mb": round(size_bytes / (1024 * 1024), 2),
        "sharpness": sharpness,
        "plane_inlier_fraction": (
            round(plane_inliers, 4) if plane_inliers is not None else None
        ),
        "table_extent_xy": extent,
        "camera_height_range_m": _camera_height_range(rows, table_frame),
        "representative_frames": [
            {
                "frame_id": item["frame_id"],
                "sharpness": round(item["sharpness"], 2),
                "topdownness": round(item["topdownness"], 4),
            }
            for item in chosen
        ],
    }, chosen


def _fit_thumbnail(image: np.ndarray) -> np.ndarray:
    width, height = THUMBNAIL_WH
    scale = min(width / image.shape[1], height / image.shape[0])
    resized = cv2.resize(
        image,
        (round(image.shape[1] * scale), round(image.shape[0] * scale)),
        interpolation=cv2.INTER_AREA,
    )
    panel = np.full((height, width, 3), 28, np.uint8)
    x = (width - resized.shape[1]) // 2
    y = (height - resized.shape[0]) // 2
    panel[y:y + resized.shape[0], x:x + resized.shape[1]] = resized
    return panel


def _render_session_row(
    session_id: str, report: dict, chosen: list[dict]
) -> np.ndarray:
    panels = []
    if chosen:
        for item in chosen[:3]:
            panel = _fit_thumbnail(item["image"])
            cv2.putText(
                panel,
                f"f{item['frame_id']}  sharp {item['sharpness']:.0f}",
                (8, panel.shape[0] - 10),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.48,
                (255, 255, 255),
                1,
                cv2.LINE_AA,
            )
            panels.append(panel)
    else:
        label = "EMPTY SESSION" if report["status"] == "empty" else "MISSING"
        for _ in range(3):
            panel = np.full((THUMBNAIL_WH[1], THUMBNAIL_WH[0], 3), 35, np.uint8)
            cv2.putText(
                panel, label, (65, 140), cv2.FONT_HERSHEY_SIMPLEX,
                0.7, (80, 80, 255), 2, cv2.LINE_AA,
            )
            panels.append(panel)
    while len(panels) < 3:
        panels.append(panels[-1].copy())

    body = np.hstack(panels)
    header = np.full((44, body.shape[1], 3), 18, np.uint8)
    title = (
        f"{session_id} | {report['environment']} | {report['split']} | "
        f"{report['status']}"
    )
    cv2.putText(
        header, title, (10, 30), cv2.FONT_HERSHEY_SIMPLEX,
        0.65, (255, 255, 255), 2, cv2.LINE_AA,
    )
    return np.vstack([header, body])


def _write_markdown(report: dict, output_path: Path) -> None:
    lines = [
        "# Phase 3 Session Audit",
        "",
        f"Audited cohort: `{report['cohort']}`.",
        "",
        "| Session | Environment | Split | Frames | Duration | Plane inliers | Status | Warnings |",
        "|---|---|---:|---:|---:|---:|---|---|",
    ]
    for session_id, row in report["sessions"].items():
        plane = row.get("plane_inlier_fraction")
        lines.append(
            f"| `{session_id}` | {row['environment']} | {row['split']} | "
            f"{row.get('frame_count', 0)} | {row.get('duration_s', 0):.1f}s | "
            f"{plane:.3f} | {row['status']} | "
            f"{', '.join(row.get('warnings', [])) or 'none'} |"
            if plane is not None else
            f"| `{session_id}` | {row['environment']} | {row['split']} | "
            f"{row.get('frame_count', 0)} | {row.get('duration_s', 0):.1f}s | "
            f"n/a | {row['status']} | "
            f"{', '.join(row.get('warnings', [])) or 'none'} |"
        )
    output_path.write_text("\n".join(lines) + "\n")


def audit_sessions(
    catalog: Catalog,
    capture_root: str | Path,
    output_dir: str | Path,
    cohort: str | None = "phase3_new",
) -> dict:
    catalog.validate()
    capture_root = Path(capture_root)
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    reports = {}
    rendered_rows = []
    for session_id, spec in sorted(catalog.for_cohort(cohort).items()):
        row, chosen = _audit_one(session_id, spec, capture_root)
        reports[session_id] = row
        rendered_rows.append(_render_session_row(session_id, row, chosen))

    sheets = []
    for page, start in enumerate(
        range(0, len(rendered_rows), SESSIONS_PER_SHEET), start=1
    ):
        sheet = np.vstack(rendered_rows[start:start + SESSIONS_PER_SHEET])
        path = output_dir / f"session-contact-sheet-{page}.jpg"
        cv2.imwrite(str(path), sheet, [cv2.IMWRITE_JPEG_QUALITY, 92])
        sheets.append(path.name)

    report = {
        "version": 1,
        "cohort": cohort,
        "capture_root": str(capture_root.resolve()),
        "summary": {
            "listed": len(reports),
            "usable": sum(row["status"] == "usable" for row in reports.values()),
            "empty": sum(row["status"] == "empty" for row in reports.values()),
            "missing": sum(row["status"] == "missing" for row in reports.values()),
        },
        "contact_sheets": sheets,
        "sessions": reports,
    }
    (output_dir / "session-audit.json").write_text(
        json.dumps(report, indent=2) + "\n"
    )
    _write_markdown(report, output_dir / "session-audit.md")
    return report


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--catalog", type=Path, required=True)
    parser.add_argument("--capture-root", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--cohort", default="phase3_new")
    args = parser.parse_args()
    report = audit_sessions(
        load_catalog(args.catalog), args.capture_root, args.output, args.cohort
    )
    print(json.dumps(report["summary"], indent=2))
    for sheet in report["contact_sheets"]:
        print(args.output / sheet)


if __name__ == "__main__":
    main()
