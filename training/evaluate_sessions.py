"""Run and report split-safe, product-level multiview evaluations.

The report deliberately keeps train-seen, whole-session validation, and the
held-out environment separate.  Reference counts are either manually checked
historical layouts or the maximum human-verified instance count in one source
frame; they are useful product checks, not a claim of exhaustive dataset-wide
ground truth.
"""
from __future__ import annotations

import argparse
import json
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path

from pipeline.multiview import scan_manifest
from training.catalog import load_catalog


REPORT_GROUPS = {
    "train": "train_seen",
    "val": "validation",
    "test": "test_environment",
}

# Historical counts were manually inspected during the scanner regressions.
# Phase-3 counts are the maximum human-verified polygons in a selected frame.
REFERENCE_COUNTS = {
    "20260716-212422": (7, "manual_historical_layout"),
    "20260716-221544": (8, "manual_historical_layout"),
    "20260716-234326": (8, "manual_historical_layout"),
    "20260717-005145": (8, "manual_historical_layout_train_seen"),
    "20260717-150212": (14, "max_human_verified_frame"),
    "20260717-150350": (7, "max_human_verified_frame"),
    "20260717-151611": (33, "max_human_verified_frame"),
    "20260717-152458": (23, "max_human_verified_frame"),
    "20260717-153200": (8, "max_human_verified_frame"),
    "20260717-153942": (11, "max_human_verified_frame"),
    "20260717-154929": (15, "max_human_verified_frame"),
    "20260717-155228": (19, "max_human_verified_frame"),
}

HISTORICAL = {
    "20260716-212422": ("train", "historical"),
    "20260716-221544": ("train", "historical"),
    "20260716-234326": ("train", "historical"),
}


@dataclass(frozen=True)
class SessionEvaluation:
    session_id: str
    split: str
    environment: str
    detector: str
    expected_count: int | None
    view_count: int
    raw_detection_count: int
    accepted_detection_count: int
    per_view_accepted: list[int]
    fused_count: int
    inventory_count: int
    unknown_count: int
    partial_count: int
    selected_coverage: float
    union_coverage: float
    expected_count_source: str | None = None
    geometry_risk: str | None = None
    failure_categories: tuple[str, ...] = field(default_factory=tuple)
    inventory_items: list[dict] = field(default_factory=list)

    @property
    def exact_count(self) -> bool | None:
        if self.expected_count is None:
            return None
        return self.fused_count == self.expected_count

    def to_dict(self) -> dict:
        row = asdict(self)
        row["failure_categories"] = list(self.failure_categories)
        row["exact_count"] = self.exact_count
        row["count_delta"] = (
            None if self.expected_count is None
            else self.fused_count - self.expected_count
        )
        return row


def _failure_categories(
    expected_count: int | None,
    fused_count: int,
    per_view_accepted: list[int],
    unknown_count: int,
    geometry_risk: str | None,
) -> tuple[str, ...]:
    categories = []
    if geometry_risk:
        categories.append("geometry_risk")
    if expected_count is not None and fused_count != expected_count:
        if not per_view_accepted or max(per_view_accepted) < expected_count:
            categories.append("segmentation_miss")
        elif min(per_view_accepted) > expected_count:
            categories.append("segmentation_false_positive")
        else:
            categories.append("fusion_count_mismatch")
    if unknown_count:
        categories.append("identification_unknown")
    return tuple(categories)


def evaluation_from_result(
    session_id: str,
    split: str,
    environment: str,
    result,
    expected_count: int | None,
    expected_count_source: str | None,
    detector: str = "seg",
    geometry_risk: str | None = None,
) -> SessionEvaluation:
    detections = result.segmentation_detections
    by_view = {view.view_index: 0 for view in result.views}
    for detection in detections:
        if detection.accepted:
            by_view[detection.view_index] += 1
    inventory_count = sum(
        int(item.get("quantity", 1)) for item in result.inventory
    )
    unknown_count = sum(
        int(item.get("quantity", 1))
        for item in result.inventory
        if item.get("part_id") is None
    )
    failure_categories = _failure_categories(
        expected_count,
        len(result.instances),
        list(by_view.values()),
        unknown_count,
        geometry_risk,
    )
    return SessionEvaluation(
        session_id=session_id,
        split=split,
        environment=environment,
        detector=detector,
        expected_count=expected_count,
        expected_count_source=expected_count_source,
        view_count=len(result.views),
        raw_detection_count=len(detections),
        accepted_detection_count=sum(
            detection.accepted for detection in detections
        ),
        per_view_accepted=list(by_view.values()),
        fused_count=len(result.instances),
        inventory_count=inventory_count,
        unknown_count=unknown_count,
        partial_count=sum(not item.best.complete for item in result.instances),
        selected_coverage=float(result.manifest["selected_coverage"]),
        union_coverage=float(result.manifest["union_coverage"]),
        geometry_risk=geometry_risk,
        failure_categories=failure_categories,
        inventory_items=result.inventory,
    )


def summarize_by_split(
    evaluations: list[SessionEvaluation],
) -> dict[str, dict]:
    grouped = {
        "train_seen": [], "validation": [], "test_environment": []
    }
    for evaluation in evaluations:
        if evaluation.split not in REPORT_GROUPS:
            continue
        grouped[REPORT_GROUPS[evaluation.split]].append(evaluation)
    report = {}
    for name, rows in grouped.items():
        serialized = [row.to_dict() for row in sorted(
            rows, key=lambda item: item.session_id
        )]
        known = [row for row in rows if row.expected_count is not None]
        report[name] = {
            "session_count": len(rows),
            "exact_count_sessions": sum(row.exact_count is True for row in known),
            "reference_count_sessions": len(known),
            "mean_absolute_count_error": (
                None if not known else sum(
                    abs(row.fused_count - int(row.expected_count))
                    for row in known
                ) / len(known)
            ),
            "unknown_inventory_items": sum(row.unknown_count for row in rows),
            "sessions": serialized,
        }
    return report


def write_report(
    evaluations: list[SessionEvaluation], output_dir: str | Path
) -> tuple[Path, Path]:
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    splits = summarize_by_split(evaluations)
    payload = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "reference_count_caveat": (
            "Phase-3 references are maxima from human-verified source frames; "
            "they are not exhaustive per-session 3D ground truth."
        ),
        "splits": splits,
    }
    json_path = output_dir / "product-evaluation.json"
    json_path.write_text(json.dumps(payload, indent=2) + "\n")

    lines = [
        "# Phase 3 product evaluation",
        "",
        payload["reference_count_caveat"],
        "",
    ]
    headings = {
        "train_seen": "Train seen",
        "validation": "Validation",
        "test_environment": "Test environment",
    }
    for group, heading in headings.items():
        section = splits[group]
        lines.extend([
            f"## {heading}",
            "",
            "TRAIN-SEEN evidence is not generalization evidence."
            if group == "train_seen" else
            "This section is kept separate from all training-seen results.",
            "",
            "| Session | Environment | Reference | Fused | Unknown | Failures |",
            "|---|---|---:|---:|---:|---|",
        ])
        for row in section["sessions"]:
            failures = ", ".join(row["failure_categories"]) or "none"
            reference = (
                "—" if row["expected_count"] is None
                else str(row["expected_count"])
            )
            lines.append(
                f"| {row['session_id']} | {row['environment']} | "
                f"{reference} | {row['fused_count']} | "
                f"{row['unknown_count']} | {failures} |"
            )
        if not section["sessions"]:
            lines.append("| — | — | — | — | — | not evaluated |")
        lines.append("")
    markdown_path = output_dir / "product-evaluation.md"
    markdown_path.write_text("\n".join(lines) + "\n")
    return json_path, markdown_path


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--catalog", type=Path, default=Path("training/catalog.yaml")
    )
    parser.add_argument(
        "--capture-root", type=Path,
        default=Path("/Users/emily/lego-capture/sessions"),
    )
    parser.add_argument("--session", action="append", dest="sessions")
    parser.add_argument(
        "--output", type=Path,
        default=Path("training/runs/product-evaluation"),
    )
    parser.add_argument(
        "--weights", type=Path, default=Path("models/lego_seg.pt")
    )
    parser.add_argument("--cache", type=Path, default=Path(".cache"))
    args = parser.parse_args(argv)

    catalog = load_catalog(args.catalog)
    default_sessions = [
        *HISTORICAL,
        "20260717-005145",
        *[
            session_id for session_id, spec in catalog.sessions.items()
            if spec.split in {"val", "test"}
        ],
    ]
    session_ids = args.sessions or default_sessions

    from pipeline.segdetect import YoloSegModel

    model = YoloSegModel(weights=args.weights)
    evaluations = []
    for session_id in session_ids:
        if session_id in catalog.sessions:
            spec = catalog.sessions[session_id]
            split, environment = spec.split, spec.environment
            geometry_risk = spec.geometry_risk
        elif session_id in HISTORICAL:
            split, environment = HISTORICAL[session_id]
            geometry_risk = None
        else:
            raise SystemExit(f"unknown evaluation session: {session_id}")
        manifest = args.capture_root / session_id / "multiview/manifest.json"
        if not manifest.exists():
            raise SystemExit(
                f"missing {manifest}; export it with lego-capture/multiview.py"
            )
        result = scan_manifest(
            manifest, detector="seg", seg_model=model, cache_dir=args.cache
        )
        expected, source = REFERENCE_COUNTS.get(session_id, (None, None))
        evaluation = evaluation_from_result(
            session_id, split, environment, result, expected, source,
            geometry_risk=geometry_risk,
        )
        evaluations.append(evaluation)
        print(
            f"{session_id}: {evaluation.fused_count} fused, "
            f"{evaluation.unknown_count} unknown, "
            f"reference={evaluation.expected_count}"
        )
    json_path, markdown_path = write_report(evaluations, args.output)
    print(f"wrote {json_path} and {markdown_path}")


if __name__ == "__main__":
    main()
