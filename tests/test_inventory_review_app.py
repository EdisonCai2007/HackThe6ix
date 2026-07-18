import json
from pathlib import Path

from fastapi.testclient import TestClient

from inventory_review_app import create_app
from training.inventory_review import atomic_write_json, new_review_document


def _component():
    return {
        "component_id": "piece-000",
        "prediction": {
            "part_id": "3001", "part_name": "Brick 2 x 4",
            "color": "blue", "score": 0.9,
        },
        "candidates": [],
        "assets": {"views": [{
            "crop": "review-assets/components/piece-000/crop.jpg",
            "mask": "review-assets/components/piece-000/mask.png",
            "masked_crop": "review-assets/components/piece-000/masked.png",
        }]},
    }


def _workspace(tmp_path, expected=1):
    run = tmp_path / "run"
    asset = run / "review-assets/components/piece-000/crop.jpg"
    asset.parent.mkdir(parents=True)
    asset.write_bytes(b"jpeg")
    document = new_review_document("s1", expected, [_component()])
    review_path = run / "review.json"
    atomic_write_json(review_path, document)
    workspace = tmp_path / "workspace.json"
    atomic_write_json(workspace, {
        "schema_version": 1,
        "sessions": [{
            "session_id": "s1",
            "expected_count": expected,
            "review_path": str(review_path),
        }],
    })
    return workspace, review_path


def _confirmed(**updates):
    value = {
        "confirmed": True,
        "part_id": "3003",
        "part_name": "Brick 2 x 2",
        "color": "white",
        "included": True,
        "exclusion_reason": None,
        "segmentation": "correct",
    }
    value.update(updates)
    return value


def test_update_component_autosaves_and_preserves_prediction(tmp_path):
    workspace, review_path = _workspace(tmp_path)
    client = TestClient(create_app(workspace))

    response = client.put(
        "/api/sessions/s1/components/piece-000", json=_confirmed()
    )

    assert response.status_code == 200
    saved = json.loads(review_path.read_text())
    row = saved["components"][0]
    assert row["prediction"]["part_id"] == "3001"
    assert row["review"]["part_id"] == "3003"
    assert response.json()["reconciliation"]["reconciled"] is True


def test_invalid_exclusion_returns_actionable_422(tmp_path):
    workspace, _ = _workspace(tmp_path)
    client = TestClient(create_app(workspace))

    response = client.put(
        "/api/sessions/s1/components/piece-000",
        json=_confirmed(
            included=False, exclusion_reason=None,
            part_id="", part_name="", color="",
        ),
    )

    assert response.status_code == 422
    assert "exclusion reason" in response.json()["detail"]


def test_manual_missed_piece_is_persisted_and_reconciles_shortfall(tmp_path):
    workspace, review_path = _workspace(tmp_path, expected=2)
    client = TestClient(create_app(workspace))
    client.put("/api/sessions/s1/components/piece-000", json=_confirmed())

    response = client.post("/api/sessions/s1/manual-pieces", json={
        "part_id": "3001", "part_name": "Brick 2 x 4",
        "color": "blue", "included": True,
    })

    assert response.status_code == 200
    assert response.json()["reconciliation"]["reconciled"] is True
    assert json.loads(review_path.read_text())["manual_pieces"][0]["manual_id"] \
        == "manual-000"


def test_lock_rejects_unresolved_then_persists_success(tmp_path):
    workspace, review_path = _workspace(tmp_path)
    client = TestClient(create_app(workspace))
    assert client.post("/api/sessions/s1/lock").status_code == 409

    client.put("/api/sessions/s1/components/piece-000", json=_confirmed())
    response = client.post("/api/sessions/s1/lock")

    assert response.status_code == 200
    assert json.loads(review_path.read_text())["locked"] is True


def test_export_refuses_unlocked_session_then_writes_all_formats(tmp_path):
    workspace, _ = _workspace(tmp_path)
    client = TestClient(create_app(workspace))
    assert client.post("/api/export").status_code == 409

    client.put("/api/sessions/s1/components/piece-000", json=_confirmed())
    client.post("/api/sessions/s1/lock")
    response = client.post("/api/export")

    assert response.status_code == 200
    root = workspace.parent
    for name in (
        "verified_inventory.json", "verified_inventory.csv",
        "verified_pieces.csv", "verification_summary.json",
    ):
        assert (root / name).exists()


def test_asset_route_rejects_path_traversal(tmp_path):
    workspace, _ = _workspace(tmp_path)
    client = TestClient(create_app(workspace))

    assert client.get(
        "/assets/s1/review-assets/components/piece-000/crop.jpg"
    ).status_code == 200
    assert client.get("/assets/s1/../../workspace.json").status_code in {404, 422}


def test_browser_client_is_served(tmp_path):
    workspace, _ = _workspace(tmp_path)
    client = TestClient(create_app(workspace))

    index = client.get("/").text
    assert 'id="segmentation-stage"' in index
    assert '/app.js?v=2' in index
    assert client.get("/app.js").headers["content-type"].startswith(
        "text/javascript"
    )
    assert client.get("/styles.css").headers["content-type"].startswith(
        "text/css"
    )
    assert 'aria-label="Select piece' in client.get("/app.js").text
