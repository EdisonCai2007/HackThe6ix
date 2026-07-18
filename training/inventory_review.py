"""Human-reviewed, exact-count inventory annotations.

Predictions are immutable provenance.  Reviewer decisions are stored in a
separate ``review`` object and are the only values used by final aggregation.
"""
from __future__ import annotations

import copy
import json
import os
import tempfile
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path


INVENTORY_COLORS = (
    "red", "orange", "yellow", "beige", "brown", "green",
    "dark green", "blue", "white", "light gray", "dark gray", "black",
)
SEGMENTATION_STATES = (
    "unreviewed", "correct", "duplicate", "merged", "incomplete", "missed",
)
_REVIEW_FIELDS = {
    "confirmed", "part_id", "part_name", "color", "included",
    "exclusion_reason", "segmentation",
}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _default_review(prediction: dict) -> dict:
    return {
        "confirmed": False,
        "part_id": prediction.get("part_id") or "",
        "part_name": prediction.get("part_name") or "",
        "color": prediction.get("color") or "",
        "included": True,
        "exclusion_reason": None,
        "segmentation": "unreviewed",
    }


def new_review_document(
    session_id: str, expected_count: int, components: list[dict]
) -> dict:
    if not session_id:
        raise ValueError("session_id is required")
    if int(expected_count) <= 0:
        raise ValueError("expected physical count must be positive")
    rows = []
    seen = set()
    for component in components:
        row = copy.deepcopy(component)
        component_id = row.get("component_id")
        if not component_id or component_id in seen:
            raise ValueError("component IDs must be present and unique")
        seen.add(component_id)
        prediction = row.get("prediction") or {}
        row["prediction"] = copy.deepcopy(prediction)
        row["review"] = _default_review(prediction)
        rows.append(row)
    return {
        "schema_version": 1,
        "session_id": session_id,
        "expected_physical_count": int(expected_count),
        "components": rows,
        "manual_pieces": [],
        "locked": False,
        "created_at": _now(),
        "updated_at": _now(),
        "locked_at": None,
    }


def _validate_review(review: dict) -> None:
    segmentation = review.get("segmentation")
    if segmentation not in SEGMENTATION_STATES:
        raise ValueError(f"invalid segmentation state: {segmentation}")
    if not review.get("confirmed"):
        return
    included = bool(review.get("included"))
    if segmentation == "duplicate" and included:
        raise ValueError("duplicate detections cannot be included")
    if included:
        if not str(review.get("part_id") or "").strip():
            raise ValueError("included piece requires part ID")
        if not str(review.get("part_name") or "").strip():
            raise ValueError("included piece requires part name")
        if review.get("color") not in INVENTORY_COLORS:
            raise ValueError("included piece requires a valid inventory color")
    elif not str(review.get("exclusion_reason") or "").strip():
        raise ValueError("excluded piece requires an exclusion reason")


def apply_component_review(
    document: dict, component_id: str, patch: dict
) -> dict:
    if document.get("locked"):
        raise ValueError("locked review documents cannot be edited")
    unknown = set(patch) - _REVIEW_FIELDS
    if unknown:
        raise ValueError(f"unknown review fields: {sorted(unknown)}")
    row = next(
        (item for item in document.get("components", [])
         if item.get("component_id") == component_id),
        None,
    )
    if row is None:
        raise KeyError(f"unknown component: {component_id}")
    updated = {**row["review"], **copy.deepcopy(patch)}
    _validate_review(updated)
    row["review"] = updated
    row["reviewed_at"] = _now()
    document["updated_at"] = _now()
    return row


def add_manual_piece(
    document: dict,
    *,
    part_id: str,
    part_name: str,
    color: str,
    included: bool = True,
    exclusion_reason: str | None = None,
) -> dict:
    if document.get("locked"):
        raise ValueError("locked review documents cannot be edited")
    index = len(document.setdefault("manual_pieces", []))
    row = {
        "manual_id": f"manual-{index:03d}",
        "source": "human-added-missed-piece",
        "review": {
            "confirmed": True,
            "part_id": str(part_id).strip(),
            "part_name": str(part_name).strip(),
            "color": color,
            "included": bool(included),
            "exclusion_reason": exclusion_reason,
            "segmentation": "missed",
        },
        "reviewed_at": _now(),
    }
    _validate_review(row["review"])
    document["manual_pieces"].append(row)
    document["updated_at"] = _now()
    return row


def reconciliation(document: dict) -> dict:
    included = excluded = duplicates = unresolved = 0
    accounted = 0
    for row in document.get("components", []):
        review = row.get("review") or {}
        segmentation = review.get("segmentation", "unreviewed")
        if not review.get("confirmed"):
            unresolved += 1
            continue
        if segmentation == "duplicate":
            duplicates += 1
            continue
        if segmentation in {"merged", "incomplete", "missed"}:
            unresolved += 1
            continue
        accounted += 1
        if review.get("included"):
            included += 1
        else:
            excluded += 1
    manual = len(document.get("manual_pieces", []))
    for row in document.get("manual_pieces", []):
        _validate_review(row.get("review") or {})
        if not row["review"].get("confirmed"):
            unresolved += 1
            continue
        accounted += 1
        if row["review"].get("included"):
            included += 1
        else:
            excluded += 1
    expected = int(document.get("expected_physical_count", 0))
    return {
        "expected": expected,
        "accounted_physical": accounted,
        "included": included,
        "excluded": excluded,
        "duplicates": duplicates,
        "manual_missed": manual,
        "unresolved": unresolved,
        "reconciled": unresolved == 0 and accounted == expected,
    }


def lock_document(document: dict) -> dict:
    status = reconciliation(document)
    if status["unresolved"]:
        raise ValueError(
            f"cannot lock with {status['unresolved']} unresolved entries"
        )
    if status["accounted_physical"] != status["expected"]:
        raise ValueError(
            "cannot lock until physical count matches: "
            f"{status['accounted_physical']} != {status['expected']}"
        )
    document["locked"] = True
    document["locked_at"] = _now()
    document["updated_at"] = document["locked_at"]
    return status


def _piece_rows(document: dict) -> list[dict]:
    rows = []
    session_id = document["session_id"]
    for component in document.get("components", []):
        review = component["review"]
        if review.get("segmentation") == "duplicate":
            continue
        rows.append({
            "session_id": session_id,
            "piece_id": component["component_id"],
            "source": "detected",
            **copy.deepcopy(review),
        })
    for manual in document.get("manual_pieces", []):
        rows.append({
            "session_id": session_id,
            "piece_id": manual["manual_id"],
            "source": "manual-missed",
            **copy.deepcopy(manual["review"]),
        })
    return rows


def aggregate_documents(
    documents: list[dict],
) -> tuple[list[dict], list[dict], dict]:
    if any(not document.get("locked") for document in documents):
        raise ValueError("all review documents must be locked before export")
    quantities: dict[tuple[str, str, str], int] = defaultdict(int)
    pieces = []
    total_expected = 0
    for document in documents:
        total_expected += int(document["expected_physical_count"])
        for row in _piece_rows(document):
            pieces.append(row)
            if row["included"]:
                key = (row["part_id"], row["part_name"], row["color"])
                quantities[key] += 1
    inventory = [
        {"part_id": part_id, "name": name, "color": color, "quantity": count}
        for (part_id, name, color), count in sorted(quantities.items())
    ]
    summary = {
        "sessions": len(documents),
        "expected_physical": total_expected,
        "included": sum(bool(row["included"]) for row in pieces),
        "excluded": sum(not bool(row["included"]) for row in pieces),
        "inventory_groups": len(inventory),
    }
    return inventory, pieces, summary


def atomic_write_json(path: Path, payload: dict | list) -> None:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="w", encoding="utf-8", dir=path.parent,
            prefix=f".{path.name}.", suffix=".tmp", delete=False,
        ) as handle:
            temporary = Path(handle.name)
            json.dump(payload, handle, indent=2)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
    finally:
        if temporary is not None and temporary.exists():
            temporary.unlink()
