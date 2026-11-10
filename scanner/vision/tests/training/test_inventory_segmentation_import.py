import hashlib
import json
import shutil
from pathlib import Path

import cv2
import numpy as np
import pytest

from training.inventory_segmentation_import import (
    ReviewedShape,
    associate_reviewed_shapes,
    build_validation_workspace,
    find_same_frame_overlap_conflicts,
    load_reviewed_bundle,
)


def _shape(shape_id, frame_id, box):
    x0, y0, x1, y1 = box
    mask = np.zeros((40, 40), dtype=bool)
    mask[y0:y1, x0:x1] = True
    return ReviewedShape(
        shape_id=shape_id,
        session_id="session",
        frame_id=frame_id,
        view_index=0,
        group_id=None,
        source_json=Path("review.json"),
        image_path=Path("image.jpg"),
        image=np.zeros((40, 40, 3), dtype=np.uint8),
        mask_original=mask,
        box_original=box,
        mask_canvas=mask,
        box_canvas=box,
        polygons_canvas=(),
    )


def _bundle_fixture(tmp_path, *, reviewed=True, mutate_review_copy=False):
    session_dir = tmp_path / "session"
    frames_dir = session_dir / "frames"
    frames_dir.mkdir(parents=True)
    source = frames_dir / "00001.rgb.jpg"
    image = np.full((40, 40, 3), 180, dtype=np.uint8)
    cv2.rectangle(image, (10, 10), (25, 25), (0, 0, 255), -1)
    assert cv2.imwrite(str(source), image)
    digest = hashlib.sha256(source.read_bytes()).hexdigest()
    manifest = session_dir / "multiview" / "manifest.json"
    manifest.parent.mkdir()
    manifest.write_text(json.dumps({
        "version": 3,
        "session_dir": str(session_dir),
        "size_wh": [40, 40],
        "views": [{
            "frame_id": 1,
            "homography": np.eye(3).tolist(),
            "quality": 1.0,
            "rgb": "frames/00001.rgb.jpg",
        }],
    }))
    bundle_dir = tmp_path / "bundle"
    review_dir = bundle_dir / "review"
    review_dir.mkdir(parents=True)
    review_image = review_dir / "001.jpg"
    shutil.copy2(source, review_image)
    if mutate_review_copy:
        review_image.write_bytes(review_image.read_bytes() + b"changed")
    annotation = review_dir / "001.json"
    annotation.write_text(json.dumps({
        "version": "6.2.0",
        "flags": {"reviewed": reviewed},
        "imagePath": review_image.name,
        "imageData": None,
        "imageHeight": 40,
        "imageWidth": 40,
        "session": {
            "session_id": "20260718-161438",
            "expected_physical_count": 48,
            "frame_id": 1,
            "source_sha256": digest,
        },
        "shapes": [{
            "label": "lego_piece",
            "points": [[10, 10], [25, 10], [25, 25], [10, 25]],
            "group_id": 1,
            "shape_type": "polygon",
            "flags": {},
        }],
    }))
    bundle = bundle_dir / "bundle.json"
    bundle.write_text(json.dumps({
        "image_mode": "original",
        "expected_physical_total": 48,
        "sessions": [{
            "session_id": "20260718-161438",
            "expected_physical_count": 48,
            "manifest": str(manifest),
            "selected_frames": [{
                "frame_id": 1,
                "view_index": 0,
                "image": review_image.name,
                "annotation": annotation.name,
                "source_rgb": str(source),
                "source_sha256": digest,
            }],
        }],
    }))
    return bundle


def test_load_reviewed_bundle_projects_valid_human_polygon(tmp_path):
    bundle = _bundle_fixture(tmp_path)

    sessions = load_reviewed_bundle(bundle, require_all_counts=False)

    reviewed = sessions["20260718-161438"]
    assert reviewed.expected_count == 48
    assert len(reviewed.shapes) == 1
    assert reviewed.shapes[0].box_original == (10, 10, 26, 26)
    assert reviewed.shapes[0].box_canvas == (10, 10, 26, 26)


def test_load_reviewed_bundle_can_stream_only_requested_sessions(tmp_path):
    bundle = _bundle_fixture(tmp_path)

    sessions = load_reviewed_bundle(
        bundle, require_all_counts=False, session_ids=set()
    )

    assert sessions == {}


@pytest.mark.parametrize(
    ("reviewed", "mutated", "message"),
    [
        (False, False, "reviewed flag"),
        (True, True, "byte-identical"),
    ],
)
def test_load_reviewed_bundle_rejects_incomplete_or_changed_review(
    tmp_path, reviewed, mutated, message
):
    bundle = _bundle_fixture(
        tmp_path, reviewed=reviewed, mutate_review_copy=mutated
    )

    with pytest.raises(ValueError, match=message):
        load_reviewed_bundle(bundle, require_all_counts=False)


def test_association_is_one_to_one_per_frame_and_preserves_unmatched():
    anchors = [(0, 0, 10, 10), (20, 0, 30, 10)]
    shapes = [
        _shape("a", 1, (0, 0, 10, 10)),
        _shape("b", 1, (20, 0, 30, 10)),
        _shape("stacked", 1, (1, 1, 9, 9)),
        _shape("a-second-view", 2, (1, 0, 11, 10)),
    ]

    result = associate_reviewed_shapes(anchors, shapes)

    assert [shape.shape_id for shape in result.by_anchor[0]] == [
        "a", "a-second-view"
    ]
    assert [shape.shape_id for shape in result.by_anchor[1]] == ["b"]
    assert [shape.shape_id for shape in result.unmatched] == ["stacked"]


def test_overlap_conflicts_are_reported_without_deleting_shapes():
    first = _shape("outer", 1, (2, 2, 20, 20))
    second = _shape("inner", 1, (4, 4, 18, 18))
    unrelated = _shape("other", 1, (25, 25, 35, 35))

    conflicts = find_same_frame_overlap_conflicts(
        [first, second, unrelated]
    )

    assert len(conflicts) == 1
    assert conflicts[0].shape_ids == ("outer", "inner")
    assert conflicts[0].containment == pytest.approx(1.0)


def test_build_workspace_preserves_prediction_and_uses_human_mask_crop(
    tmp_path,
):
    bundle = _bundle_fixture(tmp_path)
    session_dir = tmp_path / "session"
    old_run = session_dir / "analysis-runs" / "inventory-annotation-v1"
    old_assets = old_run / "review-assets"
    old_assets.mkdir(parents=True)
    overview = np.full((40, 40, 3), 210, dtype=np.uint8)
    assert cv2.imwrite(str(old_assets / "overview.jpg"), overview)
    old_review = {
        "schema_version": 1,
        "session_id": "20260718-161438",
        "expected_physical_count": 48,
        "components": [{
            "component_id": "piece-000",
            "source_anchor": {
                "best_frame_id": 1,
                "box_canvas": [10, 10, 26, 26],
            },
            "prediction": {
                "part_id": "3001",
                "part_name": "Brick 2 x 4",
                "color": "red",
                "score": 0.9,
            },
            "candidates": [],
            "assets": {"views": []},
        }],
        "manual_pieces": [],
        "overview_images": ["review-assets/overview.jpg"],
        "overview_size_wh": [40, 40],
    }
    (old_run / "review.json").write_text(json.dumps(old_review))
    output = tmp_path / "validation"

    workspace_path = build_validation_workspace(
        bundle, output, require_all_counts=False
    )

    workspace = json.loads(workspace_path.read_text())
    assert workspace["expected_physical_total"] == 48
    review_path = Path(workspace["sessions"][0]["review_path"])
    review = json.loads(review_path.read_text())
    component = review["components"][0]
    assert component["prediction"] == old_review["components"][0]["prediction"]
    assert component["association"]["status"] == "matched_human_review"
    assert component["association"]["reviewed_shape_ids"] == ["00001:001"]
    assert component["review"]["segmentation"] == "correct"
    masked_crop = review_path.parent / component["assets"]["views"][0]["masked_crop"]
    assert masked_crop.is_file()
    crop = cv2.imread(str(masked_crop))
    assert crop is not None
    assert int(crop[:, :, 2].max()) > int(crop[:, :, 1].max())
