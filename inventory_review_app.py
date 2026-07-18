"""Local FastAPI service for exact-count LEGO inventory review."""
from __future__ import annotations

import csv
import json
import os
import tempfile
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, HTMLResponse

from training.inventory_review import (
    add_manual_piece,
    aggregate_documents,
    apply_component_review,
    atomic_write_json,
    lock_document,
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

    return app


def create_app_from_env() -> FastAPI:
    value = os.environ.get("LEGO_INVENTORY_WORKSPACE")
    if not value:
        raise RuntimeError("LEGO_INVENTORY_WORKSPACE is required")
    return create_app(Path(value))
