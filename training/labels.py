"""Strict YOLO instance-segmentation polygon parsing and validation."""
from __future__ import annotations

import math
from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np


class LabelValidationError(ValueError):
    """A YOLO segmentation line cannot represent a valid LEGO instance."""


@dataclass(frozen=True)
class SegInstance:
    class_id: int
    points: tuple[tuple[float, float], ...]
    area: float


@dataclass(frozen=True)
class LabelIssue:
    code: str
    message: str
    line_number: int | None = None


def review_sidecar_path(label_path: str | Path) -> Path:
    label_path = Path(label_path)
    return label_path.with_suffix(".review.json")


def _signed_area(points: tuple[tuple[float, float], ...]) -> float:
    return 0.5 * sum(
        x0 * y1 - x1 * y0
        for (x0, y0), (x1, y1) in zip(points, points[1:] + points[:1])
    )


def _orientation(a, b, c) -> int:
    value = (b[1] - a[1]) * (c[0] - b[0]) - (
        b[0] - a[0]
    ) * (c[1] - b[1])
    if abs(value) < 1e-12:
        return 0
    return 1 if value > 0 else 2


def _on_segment(a, b, c) -> bool:
    return (
        min(a[0], c[0]) - 1e-12 <= b[0] <= max(a[0], c[0]) + 1e-12
        and min(a[1], c[1]) - 1e-12 <= b[1] <= max(a[1], c[1]) + 1e-12
    )


def _segments_intersect(a, b, c, d) -> bool:
    o1 = _orientation(a, b, c)
    o2 = _orientation(a, b, d)
    o3 = _orientation(c, d, a)
    o4 = _orientation(c, d, b)
    if o1 != o2 and o3 != o4:
        return True
    return (
        (o1 == 0 and _on_segment(a, c, b))
        or (o2 == 0 and _on_segment(a, d, b))
        or (o3 == 0 and _on_segment(c, a, d))
        or (o4 == 0 and _on_segment(c, b, d))
    )


def _is_simple_polygon(points: tuple[tuple[float, float], ...]) -> bool:
    count = len(points)
    for left in range(count):
        a, b = points[left], points[(left + 1) % count]
        for right in range(left + 1, count):
            if right == left:
                continue
            if (left + 1) % count == right or (right + 1) % count == left:
                continue
            c, d = points[right], points[(right + 1) % count]
            if _segments_intersect(a, b, c, d):
                return False
    return True


def parse_yolo_seg_line(line: str) -> SegInstance:
    fields = line.split()
    if len(fields) < 7 or (len(fields) - 1) % 2:
        raise LabelValidationError(
            "segmentation line needs class plus at least three xy points"
        )
    try:
        class_id = int(fields[0])
    except ValueError as exc:
        raise LabelValidationError("class id must be an integer") from exc
    if class_id != 0:
        raise LabelValidationError(
            f"only class 0 (lego_piece) is allowed, got {class_id}"
        )
    try:
        coordinates = [float(value) for value in fields[1:]]
    except ValueError as exc:
        raise LabelValidationError("polygon coordinates must be numbers") from exc
    if not all(math.isfinite(value) for value in coordinates):
        raise LabelValidationError("polygon coordinates must be finite")
    if not all(0.0 <= value <= 1.0 for value in coordinates):
        raise LabelValidationError("polygon coordinates must be normalized to [0, 1]")

    points = tuple(zip(coordinates[0::2], coordinates[1::2]))
    if len(points) > 3 and points[0] == points[-1]:
        points = points[:-1]
    if len(set(points)) < 3:
        raise LabelValidationError("polygon needs at least three distinct points")
    area = abs(_signed_area(points))
    if area <= 1e-10 or not _is_simple_polygon(points):
        raise LabelValidationError(
            "polygon must have positive area and no self-intersections"
        )
    return SegInstance(class_id=class_id, points=points, area=area)


def parse_label_file(path: str | Path) -> list[SegInstance]:
    path = Path(path)
    return [
        parse_yolo_seg_line(line)
        for line in path.read_text().splitlines()
        if line.strip()
    ]


def validate_label_file(
    path: str | Path, image_shape: tuple[int, int]
) -> list[LabelIssue]:
    path = Path(path)
    if not path.exists():
        return [LabelIssue("missing_label", f"missing label file: {path}")]
    lines = [line for line in path.read_text().splitlines() if line.strip()]
    if not lines:
        return [LabelIssue("empty_label", f"empty label file: {path}")]

    issues = []
    instances = []
    for line_number, line in enumerate(lines, start=1):
        try:
            instance = parse_yolo_seg_line(line)
        except LabelValidationError as exc:
            issues.append(LabelIssue(
                "invalid_polygon", str(exc), line_number=line_number
            ))
            continue
        instances.append((line_number, instance))

    seen = {}
    height, width = image_shape
    for line_number, instance in instances:
        key = tuple(
            round(value, 8)
            for point in instance.points
            for value in point
        )
        if key in seen:
            issues.append(LabelIssue(
                "duplicate_polygon",
                f"duplicates line {seen[key]}",
                line_number=line_number,
            ))
        else:
            seen[key] = line_number
        if instance.area * width * height < 1.0:
            issues.append(LabelIssue(
                "subpixel_polygon",
                "polygon covers less than one image pixel",
                line_number=line_number,
            ))
    return issues


def instances_to_masks(
    instances: list[SegInstance], image_shape: tuple[int, int]
) -> np.ndarray:
    height, width = image_shape
    masks = np.zeros((len(instances), height, width), dtype=bool)
    for index, instance in enumerate(instances):
        points = np.asarray([
            [min(width - 1, round(x * (width - 1))),
             min(height - 1, round(y * (height - 1)))]
            for x, y in instance.points
        ], dtype=np.int32)
        cv2.fillPoly(masks[index].view(np.uint8), [points], 1)
    return masks
