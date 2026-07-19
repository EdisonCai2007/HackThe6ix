"""Local FastAPI service for exact-count LEGO inventory review."""
from __future__ import annotations

import csv
import json
import os
import tempfile
from pathlib import Path

import cv2
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, HTMLResponse

from training.inventory_review import (
    add_manual_waypoint_component,
    add_manual_piece,
    add_waypoint_component,
    aggregate_documents,
    apply_component_review,
    apply_overlap_decision,
    atomic_write_json,
    lock_document,
    overlap_candidates,
    reconciliation,
)


WEB_ROOT = Path(__file__).resolve().parent / "inventory_review_web"


def _load_json(path: Path) -> dict:
    try:
        return json.loads(path.read_text())
    except (OSError, json.JSONDecodeError) as error:
        raise RuntimeError(f"cannot load review data {path}: {error}") from error


def _workspace_sessions(workspace_path: Path) -> dict[str, Path]:
    workspace = _load_json(workspace_path)
    sessions = {}
    for row in workspace.get("sessions", []):
        session_id = str(row.get("session_id") or "")
        review_path = Path(row.get("review_path") or "").resolve()
        if not session_id or not review_path.exists():
            raise RuntimeError(
                f"workspace has invalid review entry for {session_id or '<missing>'}"
            )
        if session_id in sessions:
            raise RuntimeError(f"duplicate workspace session: {session_id}")
        sessions[session_id] = review_path
    if not sessions:
        raise RuntimeError("workspace contains no review sessions")
    return sessions


def _atomic_csv(path: Path, fieldnames: list[str], rows: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="w", encoding="utf-8", newline="", dir=path.parent,
            prefix=f".{path.name}.", suffix=".tmp", delete=False,
        ) as handle:
            temporary = Path(handle.name)
            writer = csv.DictWriter(handle, fieldnames=fieldnames)
            writer.writeheader()
            for row in rows:
                writer.writerow({key: row.get(key) for key in fieldnames})
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
    finally:
        if temporary is not None and temporary.exists():
            temporary.unlink()


def _manual_waypoint_component(
    run_dir: Path, document: dict, payload: dict
) -> dict:
    try:
        frame_id = int(payload.get("frame_id", -1))
    except (TypeError, ValueError) as error:
        raise ValueError("manual waypoint requires a numeric frame ID") from error
    frame = next(
        (
            row for row in document.get("source_frames", [])
            if int(row.get("frame_id", -1)) == frame_id
        ),
        None,
    )
    if frame is None:
        raise ValueError(f"unknown source frame: {frame_id}")
    values = payload.get("box") or []
    if len(values) != 4:
        raise ValueError("manual waypoint box must contain four coordinates")
    try:
        x0, y0, x1, y1 = [int(round(float(value))) for value in values]
    except (TypeError, ValueError, OverflowError) as error:
        raise ValueError("manual waypoint coordinates must be finite numbers") from error
    width, height = map(int, frame.get("size_wh") or [0, 0])
    x0, x1 = sorted((max(0, x0), min(width, x1)))
    y0, y1 = sorted((max(0, y0), min(height, y1)))
    if x1 - x0 < 8 or y1 - y0 < 8:
        raise ValueError("manual waypoint box must be at least 8 x 8 pixels")
    source_path = (run_dir / str(frame.get("image") or "")).resolve()
    if (
        not source_path.is_relative_to(run_dir.resolve())
        or not source_path.is_file()
    ):
        raise ValueError(f"missing source frame asset: {frame.get('image')}")
    image = cv2.imread(str(source_path))
    if image is None or image.shape[1::-1] != (width, height):
        raise ValueError(f"invalid source frame asset: {frame.get('image')}")
    pad = max(12, round(max(x1 - x0, y1 - y0) * 0.30))
    cx0, cy0 = max(0, x0 - pad), max(0, y0 - pad)
    cx1, cy1 = min(width, x1 + pad), min(height, y1 + pad)
    existing = {
        str(row.get("component_id") or "")
        for row in document.get("components", [])
    }
    index = 0
    while f"manual-waypoint-{index:03d}" in existing:
        index += 1
    component_id = f"manual-waypoint-{index:03d}"
    asset_dir = run_dir / "review-assets" / "manual"
    asset_dir.mkdir(parents=True, exist_ok=True)
    crop_path = asset_dir / f"{component_id}.jpg"
    if not cv2.imwrite(str(crop_path), image[cy0:cy1, cx0:cx1]):
        raise OSError(f"could not write manual waypoint crop: {crop_path}")
    return {
        "component_id": component_id,
        "source_anchor": {
            "frame_id": frame_id,
            "shape_id": None,
            "box_original": [x0, y0, x1, y1],
        },
        "prediction": {
            "part_id": None,
            "part_name": "unknown brick",
            "color": "",
            "score": 0.0,
        },
        "candidates": [],
        "assets": {"views": [{
            "frame_id": frame_id,
            "source_shape_id": None,
            "crop": crop_path.relative_to(run_dir).as_posix(),
            "crop_box_original": [cx0, cy0, cx1, cy1],
        }]},
        "association": {
            "status": "human_clicked_missed_piece",
            "reviewed_shape_ids": [],
            "reviewed_frame_ids": [frame_id],
            "overlap_conflicts": [],
        },
        "provenance": {"source": "human_clicked_missed_piece"},
    }


def create_app(workspace_path: Path) -> FastAPI:
    workspace_path = Path(workspace_path).resolve()
    if not workspace_path.exists():
        raise RuntimeError(f"inventory workspace does not exist: {workspace_path}")
    sessions = _workspace_sessions(workspace_path)
    app = FastAPI(title="LEGO inventory review")

    def review_path(session_id: str) -> Path:
        path = sessions.get(session_id)
        if path is None:
            raise HTTPException(status_code=404, detail="unknown review session")
        return path

    def load_review(session_id: str) -> tuple[Path, dict]:
        path = review_path(session_id)
        return path, _load_json(path)

    def response_document(document: dict) -> dict:
        return {**document, "reconciliation": reconciliation(document)}

    @app.get("/api/workspace")
    def get_workspace() -> dict:
        rows = []
        for session_id, path in sessions.items():
            document = _load_json(path)
            status = reconciliation(document)
            rows.append({
                "session_id": session_id,
                "expected_count": document["expected_physical_count"],
                "draft_component_count": len(document.get("components", [])),
                "locked": bool(document.get("locked")),
                "reconciliation": status,
            })
        return {
            "workspace_path": str(workspace_path),
            "sessions": rows,
        }

    @app.get("/api/sessions/{session_id}")
    def get_session(session_id: str) -> dict:
        _, document = load_review(session_id)
        return response_document(document)

    @app.get("/api/sessions/{session_id}/overlap-candidates")
    def get_overlap_candidates(session_id: str) -> dict:
        _, document = load_review(session_id)
        return {
            "candidates": overlap_candidates(document),
            "reconciliation": reconciliation(document),
        }

    @app.post("/api/sessions/{session_id}/overlap-decisions")
    def create_overlap_decision(session_id: str, payload: dict) -> dict:
        path, document = load_review(session_id)
        try:
            decision = apply_overlap_decision(
                document,
                str(payload.get("component_a") or ""),
                str(payload.get("component_b") or ""),
                str(payload.get("action") or ""),
            )
        except (KeyError, ValueError) as error:
            raise HTTPException(status_code=422, detail=str(error)) from error
        atomic_write_json(path, document)
        return {
            "decision": decision,
            "candidates": overlap_candidates(document),
            "reconciliation": reconciliation(document),
        }

    @app.put("/api/sessions/{session_id}/components/{component_id}")
    def update_component(session_id: str, component_id: str,
                         payload: dict) -> dict:
        path, document = load_review(session_id)
        try:
            apply_component_review(document, component_id, payload)
        except (KeyError, ValueError) as error:
            raise HTTPException(status_code=422, detail=str(error)) from error
        atomic_write_json(path, document)
        return response_document(document)

    @app.post("/api/sessions/{session_id}/handoff")
    def create_handoff(session_id: str) -> dict:
        path, document = load_review(session_id)
        if not document.get("showcase_only"):
            raise HTTPException(
                status_code=422, detail="handoff is only available for showcases"
            )
        rows = document.get("components", [])
        if not rows or any(
            not (row.get("review") or {}).get("confirmed") for row in rows
        ):
            raise HTTPException(
                status_code=422,
                detail="confirm every showcase piece before handoff",
            )
        confirmed = []
        for row in rows:
            review = row["review"]
            confirmed.append({
                "component_id": row["component_id"],
                "part_id": review.get("part_id") or None,
                "part_name": review.get("part_name") or "unknown brick",
                "color": review.get("color") or None,
                "accepted_prediction": (
                    review.get("part_id") == row.get("prediction", {}).get("part_id")
                    and review.get("part_name")
                    == row.get("prediction", {}).get("part_name")
                ),
            })
        handoff_path = path.parent / "handoff.json"
        atomic_write_json(handoff_path, {
            "schema_version": 1,
            "session_id": document["session_id"],
            "fixed_inventory": document.get("fixed_inventory"),
            "confirmed_pieces": confirmed,
        })
        return {
            "handoff_path": str(handoff_path),
            "generator_url": document.get("generator_url"),
        }

    @app.post("/api/sessions/{session_id}/manual-pieces")
    def create_manual_piece(session_id: str, payload: dict) -> dict:
        path, document = load_review(session_id)
        try:
            add_manual_piece(
                document,
                part_id=payload.get("part_id", ""),
                part_name=payload.get("part_name", ""),
                color=payload.get("color", ""),
                included=bool(payload.get("included", True)),
                exclusion_reason=payload.get("exclusion_reason"),
            )
        except ValueError as error:
            raise HTTPException(status_code=422, detail=str(error)) from error
        atomic_write_json(path, document)
        return response_document(document)

    @app.post("/api/sessions/{session_id}/waypoints/{waypoint_id}")
    def promote_waypoint(session_id: str, waypoint_id: str) -> dict:
        path, document = load_review(session_id)
        try:
            add_waypoint_component(document, waypoint_id)
        except KeyError as error:
            raise HTTPException(status_code=404, detail=str(error)) from error
        except ValueError as error:
            raise HTTPException(status_code=422, detail=str(error)) from error
        atomic_write_json(path, document)
        return response_document(document)

    @app.post("/api/sessions/{session_id}/manual-waypoints")
    def create_manual_waypoint(session_id: str, payload: dict) -> dict:
        path, document = load_review(session_id)
        try:
            component = _manual_waypoint_component(
                path.parent, document, payload
            )
            add_manual_waypoint_component(document, component)
        except (OSError, ValueError) as error:
            raise HTTPException(status_code=422, detail=str(error)) from error
        atomic_write_json(path, document)
        return response_document(document)

    @app.post("/api/sessions/{session_id}/lock")
    def lock_session(session_id: str) -> dict:
        path, document = load_review(session_id)
        try:
            lock_document(document)
        except ValueError as error:
            raise HTTPException(status_code=409, detail=str(error)) from error
        atomic_write_json(path, document)
        return response_document(document)

    @app.post("/api/export")
    def export_inventory() -> dict:
        documents = [_load_json(path) for path in sessions.values()]
        try:
            inventory, pieces, summary = aggregate_documents(documents)
        except ValueError as error:
            raise HTTPException(status_code=409, detail=str(error)) from error
        output_dir = workspace_path.parent
        atomic_write_json(output_dir / "verified_inventory.json", inventory)
        atomic_write_json(
            output_dir / "verification_summary.json",
            {
                **summary,
                "sessions": [
                    {
                        "session_id": document["session_id"],
                        **reconciliation(document),
                    }
                    for document in documents
                ],
            },
        )
        _atomic_csv(
            output_dir / "verified_inventory.csv",
            ["part_id", "name", "color", "quantity"], inventory,
        )
        _atomic_csv(
            output_dir / "verified_pieces.csv",
            [
                "session_id", "piece_id", "source", "confirmed", "part_id",
                "part_name", "color", "included", "exclusion_reason",
                "segmentation",
            ],
            pieces,
        )
        return {
            "output_dir": str(output_dir),
            "summary": summary,
        }

    @app.get("/assets/{session_id}/{asset_path:path}")
    def get_asset(session_id: str, asset_path: str):
        root = review_path(session_id).parent.resolve()
        candidate = (root / asset_path).resolve()
        if not candidate.is_relative_to(root) or not candidate.is_file():
            raise HTTPException(status_code=404, detail="asset not found")
        return FileResponse(candidate)

    @app.get("/", response_class=HTMLResponse)
    def index():
        path = WEB_ROOT / "index.html"
        if path.exists():
            return FileResponse(path)
        return HTMLResponse("<h1>Inventory review UI is not installed</h1>")

    @app.get("/app.js")
    def javascript():
        path = WEB_ROOT / "app.js"
        if not path.exists():
            raise HTTPException(status_code=404, detail="client not installed")
        return FileResponse(path, media_type="text/javascript")

    @app.get("/styles.css")
    def stylesheet():
        path = WEB_ROOT / "styles.css"
        if not path.exists():
            raise HTTPException(status_code=404, detail="client not installed")
        return FileResponse(path, media_type="text/css")

    @app.get("/confirmation-mascot.svg")
    def confirmation_mascot():
        path = WEB_ROOT / "confirmation-mascot.svg"
        if not path.exists():
            raise HTTPException(status_code=404, detail="mascot not installed")
        return FileResponse(path, media_type="image/svg+xml")

    return app


def create_app_from_env() -> FastAPI:
    value = os.environ.get("LEGO_INVENTORY_WORKSPACE")
    if not value:
        raise RuntimeError("LEGO_INVENTORY_WORKSPACE is required")
    return create_app(Path(value))
