"""Instance-level acceptance worksheets and verified-only evaluation.

Generated worksheets are deliberately unverified.  They become ground truth
only after a person checks each row and sets ``user_verified`` to true.
"""
from __future__ import annotations

import math
from dataclasses import dataclass
from pathlib import Path
from typing import Literal
import json


Pose = Literal["studs_up", "side", "upright", "unknown"]
VALID_POSES = {"studs_up", "side", "upright", "unknown"}


@dataclass(frozen=True)
class AcceptancePiece:
    instance_id: str
    anchor_table_xy_m: tuple[float, float]
    expected_part_id: str | None
    expected_name: str | None
    expected_color: str | None
    pose: Pose
    user_verified: bool
    note: str = ""


@dataclass(frozen=True)
class AcceptanceMatch:
    expected_id: str
    predicted_id: str
    distance_m: float


@dataclass(frozen=True)
class AcceptanceMatches:
    matches: tuple[AcceptanceMatch, ...]
    unmatched_expected: tuple[str, ...]
    unmatched_predicted: tuple[str, ...]


def _anchor(value, *, field: str) -> tuple[float, float]:
    if not isinstance(value, (list, tuple)) or len(value) != 2:
        raise ValueError(f"{field} must contain two coordinates")
    anchor = (float(value[0]), float(value[1]))
    if not all(math.isfinite(number) for number in anchor):
        raise ValueError(f"{field} coordinates must be finite")
    return anchor


def _piece_from_dict(row: dict) -> AcceptancePiece:
    pose = row.get("pose")
    if pose not in VALID_POSES:
        raise ValueError(
            f"pose must be one of {sorted(VALID_POSES)}, got {pose!r}"
        )
    if not isinstance(row.get("user_verified"), bool):
        raise ValueError("user_verified must be a boolean")
    instance_id = row.get("instance_id")
    if not isinstance(instance_id, str) or not instance_id:
        raise ValueError("instance_id must be a non-empty string")
    return AcceptancePiece(
        instance_id=instance_id,
        anchor_table_xy_m=_anchor(
            row.get("anchor_table_xy_m"), field="anchor_table_xy_m"
        ),
        expected_part_id=row.get("expected_part_id"),
        expected_name=row.get("expected_name"),
        expected_color=row.get("expected_color"),
        pose=pose,
        user_verified=row["user_verified"],
        note=str(row.get("note", "")),
    )


def load_acceptance(path: str | Path) -> list[AcceptancePiece]:
    payload = json.loads(Path(path).read_text())
    rows = payload.get("pieces")
    if not isinstance(rows, list):
        raise ValueError("acceptance file must contain a pieces list")
    pieces = [_piece_from_dict(row) for row in rows]
    ids = [piece.instance_id for piece in pieces]
    if len(set(ids)) != len(ids):
        raise ValueError("acceptance instance_id values must be unique")
    return pieces


def _distance(first, second) -> float:
    ax, ay = _anchor(first, field="expected anchor")
    bx, by = _anchor(second, field="predicted anchor")
    return math.hypot(ax - bx, ay - by)


def match_acceptance(
    expected: list[AcceptancePiece],
    predicted: list[dict],
    max_distance_m: float = 0.03,
) -> AcceptanceMatches:
    """Greedily match the globally closest unused anchor pairs."""
    if max_distance_m < 0:
        raise ValueError("max_distance_m must be non-negative")
    predicted_ids = [row.get("instance_id") for row in predicted]
    if any(not isinstance(value, str) or not value for value in predicted_ids):
        raise ValueError("every prediction needs a non-empty instance_id")
    if len(set(predicted_ids)) != len(predicted_ids):
        raise ValueError("predicted instance_id values must be unique")

    pairs = sorted(
        (
            _distance(piece.anchor_table_xy_m, item["anchor_table_xy_m"]),
            piece.instance_id,
            item["instance_id"],
        )
        for piece in expected
        for item in predicted
    )
    used_expected: set[str] = set()
    used_predicted: set[str] = set()
    matches = []
    for separation, expected_id, predicted_id in pairs:
        if separation > max_distance_m:
            break
        if expected_id in used_expected or predicted_id in used_predicted:
            continue
        matches.append(AcceptanceMatch(
            expected_id, predicted_id, separation
        ))
        used_expected.add(expected_id)
        used_predicted.add(predicted_id)

    return AcceptanceMatches(
        matches=tuple(matches),
        unmatched_expected=tuple(
            piece.instance_id for piece in expected
            if piece.instance_id not in used_expected
        ),
        unmatched_predicted=tuple(
            row["instance_id"] for row in predicted
            if row["instance_id"] not in used_predicted
        ),
    )


def acceptance_report(
    expected: list[AcceptancePiece],
    predicted: list[dict],
    max_distance_m: float = 0.03,
) -> dict:
    verified = [piece for piece in expected if piece.user_verified]
    review_required = [
        piece.instance_id for piece in expected if not piece.user_verified
    ]
    matching = match_acceptance(verified, predicted, max_distance_m)
    expected_by_id = {piece.instance_id: piece for piece in verified}
    predicted_by_id = {row["instance_id"]: row for row in predicted}
    rows = []
    correct = 0
    for match in matching.matches:
        truth = expected_by_id[match.expected_id]
        result = predicted_by_id[match.predicted_id]
        part_correct = result.get("part_id") == truth.expected_part_id
        correct += int(part_correct)
        rows.append({
            "expected_id": match.expected_id,
            "predicted_id": match.predicted_id,
            "distance_m": match.distance_m,
            "part_correct": part_correct,
        })
    return {
        "verified_piece_count": len(verified),
        "matched_verified_count": len(matching.matches),
        "part_accuracy": (
            correct / len(matching.matches) if matching.matches else None
        ),
        "review_required": review_required,
        "matches": rows,
        "unmatched_expected": list(matching.unmatched_expected),
        "unmatched_predicted": list(matching.unmatched_predicted),
    }


def worksheet_from_predictions(session_id: str, predicted: list[dict]) -> dict:
    """Copy current outputs into a review sheet without declaring them true."""
    pieces = []
    for index, row in enumerate(predicted):
        pieces.append({
            "instance_id": str(row.get("instance_id", f"piece-{index:03d}")),
            "anchor_table_xy_m": list(_anchor(
                row["anchor_table_xy_m"], field="anchor_table_xy_m"
            )),
            "expected_part_id": row.get("part_id"),
            "expected_name": row.get("name"),
            "expected_color": row.get("color"),
            "pose": "unknown",
            "user_verified": False,
            "note": "Generated from current output; verify before evaluation.",
        })
    return {
        "version": 1,
        "session_id": session_id,
        "ground_truth_status": "unverified_review_worksheet",
        "pieces": pieces,
    }


def dump_acceptance(payload: dict, path: str | Path) -> Path:
    output = Path(path)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(payload, indent=2) + "\n")
    return output
