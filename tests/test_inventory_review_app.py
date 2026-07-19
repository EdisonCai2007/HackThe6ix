import json
from pathlib import Path

import cv2
import numpy as np
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


def _waypoint_workspace(tmp_path, expected=2):
    workspace, review_path = _workspace(tmp_path, expected=expected)
    document = json.loads(review_path.read_text())
    run_dir = review_path.parent
    frame_dir = run_dir / "review-assets/frame-00002"
    frame_dir.mkdir(parents=True)
    source = np.full((60, 80, 3), 170, dtype=np.uint8)
    cv2.rectangle(source, (20, 15), (45, 40), (255, 0, 0), -1)
    assert cv2.imwrite(str(frame_dir / "source.jpg"), source)
    assert cv2.imwrite(str(frame_dir / "shape-1.jpg"), source[10:50, 15:55])
    secondary = _component()
    secondary["component_id"] = "waypoint-frame-00002-shape-001"
    secondary["source_anchor"] = {
        "frame_id": 2,
        "shape_id": "00002:001",
        "box_original": [20, 15, 46, 41],
    }
    secondary["assets"] = {"views": [{
        "frame_id": 2,
        "source_shape_id": "00002:001",
        "crop": "review-assets/frame-00002/shape-1.jpg",
    }]}
    document["primary_frame_id"] = 1
    document["source_frames"] = [{
        "frame_id": 2,
        "image": "review-assets/frame-00002/source.jpg",
        "size_wh": [80, 60],
        "primary": False,
        "waypoints": [{
            "waypoint_id": "00002:001",
            "component_id": secondary["component_id"],
            "box_original": [20, 15, 46, 41],
        }],
    }]
    document["waypoint_pool"] = [{
        "waypoint_id": "00002:001",
        "component": secondary,
    }]
    atomic_write_json(review_path, document)
    return workspace, review_path


def _overlap_workspace(tmp_path):
    run = tmp_path / "overlap-run"
    frame_dir = run / "review-assets/frame-00002"
    frame_dir.mkdir(parents=True)
    source = np.full((100, 120, 3), 190, dtype=np.uint8)
    cv2.rectangle(source, (10, 10), (90, 90), (255, 0, 0), -1)
    assert cv2.imwrite(str(frame_dir / "source.jpg"), source)
    components = []
    for component_id, box, part_name, color in (
        ("a", [10, 10, 90, 90], "Brick 2 x 4", "blue"),
        ("b", [20, 20, 60, 60], "Plate 2 x 2", "red"),
    ):
        row = _component()
        row["component_id"] = component_id
        row["source_anchor"] = {
            "frame_id": 2,
            "shape_id": f"00002:{component_id}",
            "box_original": box,
        }
        row["assets"] = {"views": [{
            "frame_id": 2,
            "crop": "review-assets/frame-00002/source.jpg",
        }]}
        components.append(row)
    document = new_review_document("s1", 1, components)
    document["primary_frame_id"] = 2
    document["source_frames"] = [{
        "frame_id": 2,
        "image": "review-assets/frame-00002/source.jpg",
        "size_wh": [120, 100],
        "primary": True,
        "waypoints": [],
    }]
    for row, (_, _, part_name, color) in zip(document["components"], (
        ("a", None, "Brick 2 x 4", "blue"),
        ("b", None, "Plate 2 x 2", "red"),
    )):
        row["review"] = _confirmed(part_name=part_name, color=color)
    review_path = run / "review.json"
    atomic_write_json(review_path, document)
    workspace = tmp_path / "overlap-workspace.json"
    atomic_write_json(workspace, {
        "schema_version": 1,
        "sessions": [{
            "session_id": "s1",
            "expected_count": 1,
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


def test_showcase_confirmation_accepts_part_without_claiming_color(tmp_path):
    workspace, review_path = _workspace(tmp_path)
    document = json.loads(review_path.read_text())
    document["showcase_only"] = True
    atomic_write_json(review_path, document)
    client = TestClient(create_app(workspace))

    response = client.put(
        "/api/sessions/s1/components/piece-000",
        json=_confirmed(color=""),
    )

    assert response.status_code == 200
    assert response.json()["components"][0]["review"]["color"] == ""


def test_showcase_handoff_requires_confirmation_and_writes_artifact(tmp_path):
    workspace, review_path = _workspace(tmp_path)
    document = json.loads(review_path.read_text())
    document.update({
        "showcase_only": True,
        "fixed_inventory": "/demo/fixed-inventory.json",
        "generator_url": "http://127.0.0.1:9000/build",
    })
    atomic_write_json(review_path, document)
    client = TestClient(create_app(workspace))

    blocked = client.post("/api/sessions/s1/handoff")
    assert blocked.status_code == 422

    confirmed = client.put(
        "/api/sessions/s1/components/piece-000",
        json=_confirmed(color=""),
    )
    assert confirmed.status_code == 200
    response = client.post("/api/sessions/s1/handoff")

    assert response.status_code == 200
    handoff_path = Path(response.json()["handoff_path"])
    payload = json.loads(handoff_path.read_text())
    assert payload["session_id"] == "s1"
    assert payload["fixed_inventory"] == "/demo/fixed-inventory.json"
    assert payload["confirmed_pieces"][0]["part_name"] == "Brick 2 x 2"
    assert response.json()["generator_url"] == "http://127.0.0.1:9000/build"


def test_compact_client_finishes_with_inventory_ready_handoff():
    source = (Path(__file__).resolve().parents[1]
              / "inventory_review_web/app.js").read_text()

    assert "/handoff" in source
    assert "Inventory ready" in source
    assert "generator_url" in source


def test_delete_segmentation_marks_duplicate_and_updates_count(tmp_path):
    workspace, _ = _workspace(tmp_path)
    client = TestClient(create_app(workspace))

    response = client.put(
        "/api/sessions/s1/components/piece-000",
        json=_confirmed(
            part_id="", part_name="", color="", included=False,
            exclusion_reason="duplicate segmentation/track",
            segmentation="duplicate",
        ),
    )

    assert response.status_code == 200
    status = response.json()["reconciliation"]
    assert status["segmentations_total"] == 1
    assert status["segmentations_active"] == 0
    assert status["segmentations_removed"] == 1


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


def test_add_secondary_waypoint_creates_independent_component(tmp_path):
    workspace, review_path = _waypoint_workspace(tmp_path)
    client = TestClient(create_app(workspace))

    response = client.post(
        "/api/sessions/s1/waypoints/00002%3A001"
    )

    assert response.status_code == 200
    rows = response.json()["components"]
    assert rows[-1]["source_anchor"]["frame_id"] == 2
    assert len(rows[-1]["assets"]["views"]) == 1
    assert len(json.loads(review_path.read_text())["components"]) == 2
    repeated = client.post(
        "/api/sessions/s1/waypoints/00002%3A001"
    )
    assert repeated.status_code == 422
    assert "already added" in repeated.json()["detail"]


def test_add_manual_source_frame_box_writes_independent_crop(tmp_path):
    workspace, review_path = _waypoint_workspace(tmp_path, expected=2)
    client = TestClient(create_app(workspace))

    response = client.post("/api/sessions/s1/manual-waypoints", json={
        "frame_id": 2,
        "box": [18, 13, 48, 43],
    })

    assert response.status_code == 200
    row = response.json()["components"][-1]
    assert row["component_id"] == "manual-waypoint-000"
    assert row["source_anchor"]["frame_id"] == 2
    assert row["review"]["confirmed"] is False
    crop = review_path.parent / row["assets"]["views"][0]["crop"]
    assert crop.is_file()


def test_add_manual_source_frame_box_rejects_unknown_frame(tmp_path):
    workspace, _ = _waypoint_workspace(tmp_path)
    client = TestClient(create_app(workspace))

    response = client.post("/api/sessions/s1/manual-waypoints", json={
        "frame_id": 999,
        "box": [1, 1, 20, 20],
    })

    assert response.status_code == 422
    assert "unknown source frame" in response.json()["detail"]


def test_overlap_candidate_api_returns_pair_labels_and_live_count(tmp_path):
    workspace, _ = _overlap_workspace(tmp_path)
    client = TestClient(create_app(workspace))

    response = client.get("/api/sessions/s1/overlap-candidates")

    assert response.status_code == 200
    payload = response.json()
    assert payload["reconciliation"]["accounted_physical"] == 2
    assert payload["reconciliation"]["expected"] == 1
    assert payload["candidates"][0]["pair_key"] == "a::b"
    assert payload["candidates"][0]["a"]["part_name"] == "Brick 2 x 4"
    assert payload["candidates"][0]["b"]["color"] == "red"


def test_overlap_keep_decision_api_persists_and_decrements_count(tmp_path):
    workspace, review_path = _overlap_workspace(tmp_path)
    client = TestClient(create_app(workspace))

    response = client.post("/api/sessions/s1/overlap-decisions", json={
        "component_a": "a", "component_b": "b", "action": "keep_a",
    })

    assert response.status_code == 200
    assert response.json()["reconciliation"]["accounted_physical"] == 1
    assert response.json()["candidates"] == []
    saved = json.loads(review_path.read_text())
    removed = next(row for row in saved["components"] if row["component_id"] == "b")
    assert removed["review"]["segmentation"] == "duplicate"
    assert saved["overlap_cleanup"]["decisions"][0]["removed_review"]["color"] == "red"


def test_overlap_separate_decision_api_survives_reload_without_count_change(
    tmp_path,
):
    workspace, review_path = _overlap_workspace(tmp_path)
    client = TestClient(create_app(workspace))

    response = client.post("/api/sessions/s1/overlap-decisions", json={
        "component_a": "a", "component_b": "b", "action": "separate",
    })

    assert response.status_code == 200
    assert response.json()["reconciliation"]["accounted_physical"] == 2
    assert client.get("/api/sessions/s1/overlap-candidates").json()["candidates"] == []
    assert json.loads(review_path.read_text())["overlap_cleanup"]["decisions"][0]["action"] == "separate"


def test_overlap_decision_api_rejects_invalid_action_and_pair(tmp_path):
    workspace, _ = _overlap_workspace(tmp_path)
    client = TestClient(create_app(workspace))

    invalid = client.post("/api/sessions/s1/overlap-decisions", json={
        "component_a": "a", "component_b": "b", "action": "delete_both",
    })
    missing = client.post("/api/sessions/s1/overlap-decisions", json={
        "component_a": "a", "component_b": "missing", "action": "keep_a",
    })

    assert invalid.status_code == 422
    assert "invalid overlap action" in invalid.json()["detail"]
    assert missing.status_code == 422
    assert "not a current overlap candidate" in missing.json()["detail"]


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
    assert 'id="export-inventory"' in index
    assert '/app.js?v=12' in index
    assert client.get("/app.js").headers["content-type"].startswith(
        "text/javascript"
    )
    assert client.get("/styles.css").headers["content-type"].startswith(
        "text/css"
    )


def test_showcase_browser_hides_annotation_header_and_serves_mascot(tmp_path):
    workspace, _ = _workspace(tmp_path)
    client = TestClient(create_app(workspace))

    index = client.get("/").text
    script = client.get("/app.js").text
    styles = client.get("/styles.css").text
    mascot = client.get("/confirmation-mascot.svg")

    assert 'id="confirmation-mascot"' in index
    assert 'classList.toggle("showcase-mode"' in script
    assert "body.showcase-mode > header" in styles
    assert "body.showcase-mode #confirmation-mascot" in styles
    assert mascot.status_code == 200
    assert mascot.headers["content-type"].startswith("image/svg+xml")


def test_browser_prefers_complete_clear_crop_and_keeps_mask_toggle(tmp_path):
    workspace, _ = _workspace(tmp_path)
    client = TestClient(create_app(workspace))

    index = client.get("/").text
    script = client.get("/app.js").text
    styles = client.get("/styles.css").text

    assert 'id="view-clear"' in index
    assert 'id="view-mask"' in index
    assert 'viewMode: "clear"' in script
    assert "view.crop || view.masked_crop" in script
    assert "min-height: 320px" in styles


def test_browser_exposes_delete_segmentation_and_header_count(tmp_path):
    workspace, _ = _workspace(tmp_path)
    client = TestClient(create_app(workspace))

    index = client.get("/").text
    script = client.get("/app.js").text

    assert 'id="delete-segmentation"' in index
    assert "segmentations_active" in script
    assert 'segmentation: "duplicate"' in script
    assert 'aria-label="Select piece' in client.get("/app.js").text


def test_browser_uses_source_frame_and_explicit_missed_waypoint_picker(
    tmp_path,
):
    workspace, _ = _waypoint_workspace(tmp_path)
    client = TestClient(create_app(workspace))

    index = client.get("/").text
    script = client.get("/app.js").text

    assert 'id="missed-piece-dialog"' in index
    assert 'id="source-frame-select"' in index
    assert 'id="missed-frame"' in index
    assert 'id="missed-selected-crop" class="hidden"' in index
    assert "primary_frame_id" in script
    assert "waypoint_pool" in script
    assert "overview_images" not in script
    assert 'id="view-thumbnails"' not in index
    assert "Add selected waypoint" in index


def test_browser_keeps_waypoint_id_internal_without_showing_number(tmp_path):
    workspace, _ = _waypoint_workspace(tmp_path)
    client = TestClient(create_app(workspace))

    script = client.get("/app.js").text
    styles = client.get("/styles.css").text

    assert "function waypointLabel(row, index)" in script
    assert "const label = waypointLabel(row, index);" in script
    assert '$("piece-title").textContent = "Selected LEGO piece";' in script
    assert '`Waypoint ${waypointLabel(row, state.index)}`' not in script
    assert ".shape-button.selected" in styles
    assert "z-index: 6; border: 0; outline: 0" in styles


def test_browser_exposes_confidence_first_yes_or_correct_callout(tmp_path):
    workspace, _ = _waypoint_workspace(tmp_path)
    client = TestClient(create_app(workspace))

    index = client.get("/").text
    script = client.get("/app.js").text
    styles = client.get("/styles.css").text

    for element_id in (
        "callout-layer", "callout-line", "confirmation-callout",
        "confirmation-question", "confirmation-confidence",
        "quick-confirm-yes", "quick-confirm-no",
    ):
        assert f'id="{element_id}"' in index
    assert "function highestConfidenceUnresolvedIndex" in script
    assert "function renderConfirmationCallout" in script
    assert "function beginCorrection" in script
    assert "quick-confirm-yes" in script
    assert "quick-confirm-no" in script
    assert "prediction?.score" in script
    assert "#confirmation-callout" in styles
    assert "#callout-line" in styles


def test_confirmation_uses_real_mask_without_numbered_box(tmp_path):
    workspace, _ = _waypoint_workspace(tmp_path)
    client = TestClient(create_app(workspace))

    script = client.get("/app.js").text
    styles = client.get("/styles.css").text

    assert "crop_box_original" in script
    assert '<canvas class="segmentation-silhouette"' in script
    assert "function paintSegmentationMask" in script
    assert "getImageData" in script
    assert "pixelData[offset + 3] = luminance" in script
    assert "drop-shadow" in styles
    waypoint_renderer = script.split("function waypointButton", 1)[1].split(
        "function renderShapes", 1
    )[0]
    assert '<span>${label}</span>' not in waypoint_renderer


def test_confirmation_has_compact_yes_no_and_type_correction_slide(tmp_path):
    workspace, _ = _waypoint_workspace(tmp_path)
    client = TestClient(create_app(workspace))

    index = client.get("/").text
    script = client.get("/app.js").text
    styles = client.get("/styles.css").text

    assert '>Yes</button>' in index
    assert '>No</button>' in index
    assert '<aside id="inspector">' not in index
    assert 'id="confirmation-review"' in index
    assert 'id="correction-slide"' in index
    assert 'id="correction-part-name"' in index
    assert 'placeholder="e.g. Brick 2 x 8"' in index
    assert "function renderCorrectionSlide" in script
    assert "function cancelCorrection" in script
    assert "function saveCorrection" in script
    assert ".quick-confirm-actions button" in styles
    assert ".correction-mode #callout-layer" in styles
    assert "main { display: block;" in styles
    assert "#confirmation-callout.correcting" in styles


def test_browser_exposes_explicit_overlap_pair_cleanup_modal(tmp_path):
    workspace, _ = _overlap_workspace(tmp_path)
    client = TestClient(create_app(workspace))

    index = client.get("/").text
    script = client.get("/app.js").text
    styles = client.get("/styles.css").text

    for element_id in (
        "review-overlaps", "overlap-cleanup-dialog", "overlap-frame",
        "overlap-box-a", "overlap-box-b", "overlap-label-a",
        "overlap-label-b", "keep-overlap-a", "keep-overlap-b",
        "keep-overlap-separate", "overlap-counts",
    ):
        assert f'id="{element_id}"' in index
    assert "Review possible extras" in index
    assert "Keep A" in index
    assert "Keep B" in index
    assert "These are separate pieces" in index
    assert "/overlap-candidates" in script
    assert "/overlap-decisions" in script
    assert "function renderOverlapPair" in script
    assert "const actionable = count > 0 && excess > 0;" in script
    assert ".overlap-box.a" in styles
    assert ".overlap-box.b" in styles
    assert ".overlap-box.a span" in styles
    assert ".overlap-box.b span" in styles
    assert "translate(-100%, -100%)" in styles
    assert "translate(100%, 100%)" in styles
