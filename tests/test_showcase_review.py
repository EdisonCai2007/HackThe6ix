import json

import cv2
import numpy as np

from pipeline.showcase_review import write_showcase_workspace


def test_adapter_writes_selected_components_with_exact_crop_masks(tmp_path):
    session = tmp_path / "session"
    frames = session / "frames"
    frames.mkdir(parents=True)
    image = np.full((120, 180, 3), 90, dtype=np.uint8)
    cv2.imwrite(str(frames / "00003.rgb.jpg"), image)
    analysis = session / "analysis"
    masks = analysis / "showcase-masks"
    masks.mkdir(parents=True)
    mask = np.zeros((60, 70), dtype=np.uint8)
    mask[10:50, 15:55] = 255
    cv2.imwrite(str(masks / "piece-000.png"), mask)
    showcase = {
        "selected_count": 1,
        "selected": [{
            "instance_id": 0,
            "part_id": "3022",
            "part_name": "Plate 2 x 2",
            "top1_score": 0.94,
            "color": "red",
            "color_reliable": True,
            "best_frame_id": 3,
            "rgb": "frames/00003.rgb.jpg",
            "box_original": [40, 30, 110, 90],
            "mask": "showcase-masks/piece-000.png",
        }],
    }
    showcase_path = analysis / "showcase.json"
    showcase_path.write_text(json.dumps(showcase))

    workspace_path = write_showcase_workspace(
        showcase_path, session, tmp_path / "review", fixed_inventory=None
    )

    workspace = json.loads(workspace_path.read_text())
    review_path = workspace_path.parent / workspace["sessions"][0]["review_path"]
    review = json.loads(review_path.read_text())
    assert review["showcase_only"] is True
    assert len(review["components"]) == 1
    row = review["components"][0]
    assert row["prediction"]["part_name"] == "Plate 2 x 2"
    assert row["source_anchor"]["frame_id"] == 3
    written_mask = cv2.imread(
        str(review_path.parent / row["assets"]["views"][0]["mask"]),
        cv2.IMREAD_GRAYSCALE,
    )
    assert written_mask.shape == (60, 70)
    assert review["source_frames"][0]["size_wh"] == [180, 120]


def test_adapter_abstains_from_unreliable_color(tmp_path):
    session = tmp_path / "session"
    frames = session / "frames"
    frames.mkdir(parents=True)
    cv2.imwrite(
        str(frames / "00001.rgb.jpg"),
        np.full((20, 30, 3), 80, dtype=np.uint8),
    )
    analysis = session / "analysis"
    analysis.mkdir()
    cv2.imwrite(
        str(analysis / "mask.png"), np.full((10, 10), 255, dtype=np.uint8)
    )
    (analysis / "showcase.json").write_text(json.dumps({
        "selected_count": 1,
        "selected": [{
            "instance_id": 0, "part_id": "3001", "part_name": "Brick 2 x 4",
            "top1_score": 0.95, "color": "ambiguous(red/orange)",
            "color_reliable": False, "best_frame_id": 1,
            "rgb": "frames/00001.rgb.jpg", "box_original": [0, 0, 10, 10],
            "mask": "mask.png",
        }],
    }))

    workspace = write_showcase_workspace(
        analysis / "showcase.json", session, tmp_path / "review", None
    )
    payload = json.loads((workspace.parent / "review.json").read_text())

    assert payload["components"][0]["prediction"]["color"] == ""
