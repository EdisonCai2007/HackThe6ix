"""Human-labelled color worksheets and color-only acceptance scoring."""
from __future__ import annotations

import csv
import json
import argparse
from dataclasses import dataclass
from pathlib import Path

import cv2


WORKSHEET_FIELDS = (
    "component_id",
    "box",
    "part_id",
    "part_name",
    "predicted_color",
    "thumbnail",
    "truth_color",
    "notes",
)


@dataclass(frozen=True)
class ColorWorksheetPaths:
    csv: Path
    markdown: Path


def _ambiguous_options(prediction: str) -> tuple[str, ...]:
    prefix = "ambiguous("
    if not prediction.startswith(prefix) or not prediction.endswith(")"):
        return ()
    return tuple(
        value.strip() for value in prediction[len(prefix):-1].split("/")
        if value.strip()
    )


def score_color_worksheet(path: str | Path) -> dict:
    """Score only human-filled truth rows, keeping ambiguity explicit."""
    with Path(path).open(newline="") as handle:
        rows = list(csv.DictReader(handle))
    labeled = [row for row in rows if row.get("truth_color", "").strip()]
    per_color: dict[str, dict] = {}
    confusion: dict[str, dict[str, int]] = {}
    results = []
    exact_count = 0
    acceptable_count = 0
    confident_wrong_count = 0
    for row in labeled:
        truth = row["truth_color"].strip()
        prediction = row["predicted_color"].strip()
        options = _ambiguous_options(prediction)
        exact = prediction == truth
        ambiguous_contains_truth = bool(options and truth in options)
        confident_wrong = not exact and not options
        exact_count += int(exact)
        acceptable_count += int(exact or ambiguous_contains_truth)
        confident_wrong_count += int(confident_wrong)
        summary = per_color.setdefault(truth, {
            "count": 0,
            "exact": 0,
            "ambiguous_contains_truth": 0,
            "confident_wrong": 0,
        })
        summary["count"] += 1
        summary["exact"] += int(exact)
        summary["ambiguous_contains_truth"] += int(ambiguous_contains_truth)
        summary["confident_wrong"] += int(confident_wrong)
        predicted_counts = confusion.setdefault(truth, {})
        predicted_counts[prediction] = predicted_counts.get(prediction, 0) + 1
        results.append({
            "component_id": row["component_id"],
            "truth_color": truth,
            "predicted_color": prediction,
            "exact": exact,
            "ambiguous_contains_truth": ambiguous_contains_truth,
            "confident_wrong": confident_wrong,
        })
    count = len(labeled)
    return {
        "worksheet": str(Path(path).resolve()),
        "row_count": len(rows),
        "labeled_count": count,
        "unlabeled_count": len(rows) - count,
        "exact_accuracy": exact_count / count if count else None,
        "acceptable_rate": acceptable_count / count if count else None,
        "confident_wrong_count": confident_wrong_count,
        "per_color": per_color,
        "confusion": confusion,
        "rows": results,
    }


def write_color_worksheet(
    result,
    output_dir: str | Path,
    *,
    session_id: str,
    predicted_colors: list[str],
) -> ColorWorksheetPaths:
    """Write one unverified row and inspectable crop per fused component."""
    if len(predicted_colors) != len(result.instances):
        raise ValueError("predicted color count must match fused components")
    root = Path(output_dir) / "color-labels"
    thumbnails = root / "thumbnails"
    thumbnails.mkdir(parents=True, exist_ok=True)
    rows = []
    for index, (instance, crop, info, predicted) in enumerate(zip(
        result.instances, result.crops, result.id_crops, predicted_colors
    )):
        component_id = f"piece-{index:03d}"
        thumbnail_rel = Path("color-labels") / "thumbnails" / f"{component_id}.jpg"
        thumbnail_path = Path(output_dir) / thumbnail_rel
        cv2.imwrite(str(thumbnail_path), crop, [cv2.IMWRITE_JPEG_QUALITY, 95])
        identity = info.get("brickognize") or {}
        rows.append({
            "component_id": component_id,
            "box": " ".join(str(value) for value in instance.best.box),
            "part_id": identity.get("part_id") or "",
            "part_name": identity.get("name") or "",
            "predicted_color": predicted,
            "thumbnail": str(thumbnail_rel),
            "truth_color": "",
            "notes": "",
        })

    csv_path = root / "color_worksheet.csv"
    with csv_path.open("w", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=WORKSHEET_FIELDS)
        writer.writeheader()
        writer.writerows(rows)

    markdown_path = root / "color_worksheet.md"
    lines = [
        f"# Color worksheet — {session_id}",
        "",
        "Ground truth status: **unverified**",
        "",
        "Fill the `truth_color` column in `color_worksheet.csv`; do not edit "
        "the prediction columns.",
        "",
        "| Component | Crop | Part | Predicted | Truth | Notes |",
        "|---|---|---|---|---|---|",
    ]
    for row in rows:
        crop_rel = Path("thumbnails") / Path(row["thumbnail"]).name
        lines.append(
            f"| {row['component_id']} | ![]({crop_rel}) | "
            f"{row['part_id']} {row['part_name']} | {row['predicted_color']} "
            "|  |  |"
        )
    markdown_path.write_text("\n".join(lines) + "\n")
    return ColorWorksheetPaths(csv=csv_path, markdown=markdown_path)


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("worksheet", type=Path)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args(argv)
    report = score_color_worksheet(args.worksheet)
    rendered = json.dumps(report, indent=2) + "\n"
    if args.output is None:
        print(rendered, end="")
    else:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(rendered)
        print(args.output)


if __name__ == "__main__":
    main()
