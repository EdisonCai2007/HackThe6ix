import cv2
import numpy as np
import pytest
from fastapi.testclient import TestClient

import pipeline.scan
from api import app
from pipeline.identify import Identification


def scene_jpeg(n_pieces=3):
    img = np.full((600, 800, 3), 250, dtype=np.uint8)
    spots = [(100, 100), (400, 120), (250, 350)][:n_pieces]
    for x, y in spots:
        img[y : y + 90, x : x + 130] = (9, 26, 201)
    ok, buf = cv2.imencode(".jpg", img)
    assert ok
    return buf.tobytes()


@pytest.fixture
def client(monkeypatch):
    def fake(crops, **kwargs):
        return [Identification("3001", "Brick 2 x 4", "Bricks", 0.9) for _ in crops]

    monkeypatch.setattr(pipeline.scan, "identify_all", fake)
    return TestClient(app)


def test_scan_returns_inventory(client):
    resp = client.post(
        "/scan", files={"file": ("p.jpg", scene_jpeg(), "image/jpeg")}
    )
    assert resp.status_code == 200
    body = resp.json()
    assert sum(e["quantity"] for e in body["inventory"]) == 3
    assert body["total_pieces"] == 3
    assert body["clusters"] == 0


def test_scan_rejects_non_image(client):
    resp = client.post("/scan", files={"file": ("x.jpg", b"not a jpeg", "image/jpeg")})
    assert resp.status_code == 400


def test_session_accumulates_scans(client):
    session_id = client.post("/sessions").json()["session_id"]

    r1 = client.post(
        f"/sessions/{session_id}/scan",
        files={"file": ("a.jpg", scene_jpeg(2), "image/jpeg")},
    )
    assert r1.json()["total_pieces"] == 2

    r2 = client.post(
        f"/sessions/{session_id}/scan",
        files={"file": ("b.jpg", scene_jpeg(3), "image/jpeg")},
    )
    assert r2.json()["total_pieces"] == 5  # accumulated across both photos

    inv = client.get(f"/sessions/{session_id}/inventory").json()
    assert sum(e["quantity"] for e in inv["inventory"]) == 5
    red = next(e for e in inv["inventory"] if e["color"] == "red")
    assert red["quantity"] == 5


def test_unknown_session_404(client):
    assert client.get("/sessions/nope/inventory").status_code == 404
    resp = client.post(
        "/sessions/nope/scan", files={"file": ("a.jpg", scene_jpeg(), "image/jpeg")}
    )
    assert resp.status_code == 404
