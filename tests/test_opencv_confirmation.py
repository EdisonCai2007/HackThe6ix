import csv
import json

import cv2
import numpy as np

from opencv_confirmation import ConfirmationController
from pipeline.inventory_constraints import InventoryCatalog
from training.inventory_review import atomic_write_json, new_review_document


def _catalog(tmp_path):
    path = tmp_path / "inventory.csv"
    with path.open("w", newline="") as stream:
        writer = csv.DictWriter(
            stream, fieldnames=["piece_type", "color", "quantity"]
        )
        writer.writeheader()
        writer.writerows([
            {"piece_type": "Brick 2 x 4", "color": "red", "quantity": 2},
            {"piece_type": "Plate 2 x 2", "color": "blue", "quantity": 3},
        ])
    return InventoryCatalog.load(path)


def _workspace(tmp_path, count=1):
    assets = tmp_path / "review-assets"
    assets.mkdir()
    image = np.full((240, 360, 3), 70, dtype=np.uint8)
    cv2.rectangle(image, (90, 80), (150, 130), (30, 30, 180), -1)
    cv2.imwrite(str(assets / "frame.jpg"), image)
    mask = np.zeros((50, 60), dtype=np.uint8)
    mask[5:45, 8:52] = 255
    cv2.imwrite(str(assets / "mask.png"), mask)
    components = []
    for index in range(count):
        components.append({
            "component_id": f"showcase-{index:03d}",
            "source_anchor": {
                "frame_id": 7,
                "shape_id": f"yolo-{index:03d}",
                "box_original": [90, 80, 150, 130],
            },
            "prediction": {
                "part_id": "3001", "part_name": "Brick 2 x 4",
                "color": "red", "score": 0.91 - index * 0.01,
            },
            "assets": {"views": [{
                "frame_id": 7,
                "crop_box_original": [90, 80, 150, 130],
                "mask": "review-assets/mask.png",
            }]},
        })
    document = new_review_document("scan-1", count, components)
    document.update({
        "showcase_only": True,
        "primary_frame_id": 7,
        "source_frames": [{
            "frame_id": 7,
            "image": "review-assets/frame.jpg",
            "size_wh": [360, 240],
        }],
        "fixed_inventory": "/demo/inventory.csv",
        "generator_url": None,
    })
    review_path = tmp_path / "review.json"
    atomic_write_json(review_path, document)
    workspace_path = tmp_path / "workspace.json"
    atomic_write_json(workspace_path, {
        "schema_version": 1,
        "sessions": [{
            "session_id": "scan-1", "expected_count": count,
            "review_path": str(review_path),
        }],
    })
    return workspace_path, review_path


def test_controller_rejects_invalid_text_and_accepts_inventory_type(tmp_path):
    workspace, review_path = _workspace(tmp_path)
    controller = ConfirmationController(workspace, _catalog(tmp_path))

    controller.handle_key(ord("n"))
    for char in "slope":
        controller.handle_key(ord(char))
    assert controller.mode == "correction"
    assert controller.save_current() is False
    assert "inventory" in controller.status.lower()

    controller.correction_text = "Plate 2 x 2"
    assert controller.save_current() is True
    assert controller.mode == "complete"
    saved = json.loads(review_path.read_text())
    assert saved["components"][0]["review"]["part_name"] == "Plate 2 x 2"
    assert saved["components"][0]["review"]["part_id"] == ""
    assert (tmp_path / "handoff.json").is_file()


def test_yes_accepts_prediction_and_advances_to_next_piece(tmp_path):
    workspace, review_path = _workspace(tmp_path, count=2)
    controller = ConfirmationController(workspace, _catalog(tmp_path))

    controller.handle_key(ord("y"))

    assert controller.mode == "review"
    assert controller.index == 1
    saved = json.loads(review_path.read_text())
    assert saved["components"][0]["review"]["confirmed"] is True
    assert saved["components"][1]["review"]["confirmed"] is False


def test_render_draws_yellow_mask_card_and_clickable_buttons(tmp_path):
    workspace, _ = _workspace(tmp_path)
    controller = ConfirmationController(
        workspace, _catalog(tmp_path), canvas_size=(720, 420)
    )

    rendered = controller.render()

    assert rendered.shape == (420, 720, 3)
    assert {"yes", "no"} <= set(controller.button_rects)
    yellowish = (
        (rendered[:, :, 1] > 130)
        & (rendered[:, :, 2] > 150)
        & (rendered[:, :, 0] < 120)
    )
    assert int(yellowish.sum()) > 100


def test_clicking_no_enters_correction_mode(tmp_path):
    workspace, _ = _workspace(tmp_path)
    controller = ConfirmationController(workspace, _catalog(tmp_path))
    controller.render()
    x0, y0, x1, y1 = controller.button_rects["no"]

    controller.handle_click((x0 + x1) // 2, (y0 + y1) // 2)

    assert controller.mode == "correction"
