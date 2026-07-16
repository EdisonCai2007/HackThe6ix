"""FastAPI app: scan LEGO photos into inventories.

- POST /scan                     one-shot: photo -> inventory JSON
- POST /sessions                 start an accumulating scan session
- POST /sessions/{id}/scan       add a photo; returns accumulated inventory
- GET  /sessions/{id}/inventory  current accumulated inventory

Sessions let the app scan a big bucket in small batches; state is
in-memory (fine for a hackathon single-process deployment).

Run: .venv/bin/uvicorn api:app --reload
"""
from __future__ import annotations

import uuid

import cv2
import numpy as np
from fastapi import FastAPI, HTTPException, UploadFile

from pipeline.inventory import merge_inventories
from pipeline.scan import scan_image

app = FastAPI(title="lego-cv")

_sessions: dict[str, list[dict]] = {}


def _decode(data: bytes) -> np.ndarray:
    img = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR)
    if img is None:
        raise HTTPException(status_code=400, detail="not a decodable image")
    return img


def _scan_response(inventory: list[dict], clusters: int) -> dict:
    return {
        "inventory": inventory,
        "total_pieces": sum(e["quantity"] for e in inventory),
        "clusters": clusters,
        "warning": (
            "touching pieces detected — separate them and re-scan"
            if clusters
            else None
        ),
    }


@app.post("/scan")
async def scan(file: UploadFile) -> dict:
    img = _decode(await file.read())
    result = scan_image(img)
    return _scan_response(result.inventory, len(result.clusters))


@app.post("/sessions")
def create_session() -> dict:
    session_id = uuid.uuid4().hex[:12]
    _sessions[session_id] = []
    return {"session_id": session_id}


@app.post("/sessions/{session_id}/scan")
async def session_scan(session_id: str, file: UploadFile) -> dict:
    if session_id not in _sessions:
        raise HTTPException(status_code=404, detail="unknown session")
    img = _decode(await file.read())
    result = scan_image(img)
    _sessions[session_id] = merge_inventories(
        _sessions[session_id], result.inventory
    )
    return _scan_response(_sessions[session_id], len(result.clusters))


@app.get("/sessions/{session_id}/inventory")
def session_inventory(session_id: str) -> dict:
    if session_id not in _sessions:
        raise HTTPException(status_code=404, detail="unknown session")
    return _scan_response(_sessions[session_id], 0)
