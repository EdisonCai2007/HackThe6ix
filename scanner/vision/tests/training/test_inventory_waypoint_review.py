import hashlib
import json
import shutil
from pathlib import Path

import cv2
import numpy as np

import training.inventory_waypoint_review as waypoint_review


def _write_annotation(path, *, image_name, session_id, frame_id,
                      digest, shapes):
    path.write_text(json.dumps({
        "version": "6.2.0",
        "flags": {"reviewed": True},
        "imagePath": image_name,
        "imageData": None,
        "imageHeight": 40,
        "imageWidth": 40,
        "session": {
            "session_id": session_id,
            "expected_physical_count": 48,
            "frame_id": frame_id,
            "source_sha256": digest,
        },
        "shapes": [
            {
                "label": "lego_piece",
                "points": points,
                "group_id": index,
                "shape_type": "polygon",
                "flags": {},
            }
            for index, points in enumerate(shapes, start=1)
        ],
    }))


def _bundle_fixture(tmp_path):
    session_id = "20260718-161438"
    session_dir = tmp_path / "session"
    frames_dir = session_dir / "frames"
    frames_dir.mkdir(parents=True)
    image = np.full((40, 40, 3), 180, dtype=np.uint8)
    cv2.rectangle(image, (4, 4), (13, 13), (255, 0, 0), -1)
    cv2.rectangle(image, (22, 20), (34, 32), (0, 0, 255), -1)
    sources = []
    for frame_id in (1, 2):
        source = frames_dir / f"{frame_id:05d}.rgb.jpg"
        assert cv2.imwrite(str(source), image)
        sources.append(source)

    manifest_path = session_dir / "multiview" / "manifest.json"
    manifest_path.parent.mkdir()
    manifest_path.write_text(json.dumps({
        "version": 3,
        "session_dir": str(session_dir),
        "size_wh": [40, 40],
        "views": [
            {
                "frame_id": frame_id,
                "homography": np.eye(3).tolist(),
                "quality": 1.0,
                "rgb": f"frames/{frame_id:05d}.rgb.jpg",
            }
            for frame_id in (1, 2)
        ],
    }))

    bundle_dir = tmp_path / "bundle"
    review_dir = bundle_dir / "review"
    review_dir.mkdir(parents=True)
    selected_frames = []
    shape_sets = [
        [
            [[4, 4], [13, 4], [13, 13], [4, 13]],
            [[22, 20], [34, 20], [34, 32], [22, 32]],
        ],
        [[[22, 20], [34, 20], [34, 32], [22, 32]]],
    ]
    for frame_id, source, shapes in zip((1, 2), sources, shape_sets):
        review_image = review_dir / f"{frame_id:03d}.jpg"
        shutil.copy2(source, review_image)
        digest = hashlib.sha256(source.read_bytes()).hexdigest()
        annotation = review_dir / f"{frame_id:03d}.json"
        _write_annotation(
            annotation,
            image_name=review_image.name,
            session_id=session_id,
            frame_id=frame_id,
            digest=digest,
            shapes=shapes,
        )
        selected_frames.append({
            "frame_id": frame_id,
            "view_index": frame_id - 1,
            "image": review_image.name,
            "annotation": annotation.name,
            "source_rgb": str(source),
            "source_sha256": digest,
        })

    bundle_path = bundle_dir / "bundle.json"
    bundle_path.write_text(json.dumps({
        "image_mode": "original",
        "expected_physical_total": 48,
        "sessions": [{
            "session_id": session_id,
            "expected_physical_count": 48,
            "manifest": str(manifest_path),
            "selected_frames": selected_frames,
        }],
    }))

    old_run = session_dir / "analysis-runs" / "inventory-validation-v2"
    old_run.mkdir(parents=True)
    old_review = old_run / "review.json"
    old_review.write_text(json.dumps({
        "schema_version": 1,
        "session_id": session_id,
        "expected_physical_count": 48,
        "components": [{
            "component_id": "old-piece-000",
            "association": {"reviewed_shape_ids": ["00001:001"]},
            "prediction": {
                "part_id": "3001",
                "part_name": "Brick 2 x 4",
                "color": "blue",
                "score": 0.91,
            },
            "review": {
                "confirmed": True,
                "part_id": "3001",
                "part_name": "Brick 2 x 4",
                "color": "red",
                "included": True,
                "exclusion_reason": None,
                "segmentation": "correct",
            },
        }],
        "manual_pieces": [],
        "locked": False,
    }))
    return bundle_path, old_review


def test_builder_uses_complete_primary_frame_and_single_view_components(
    tmp_path,
):
    bundle, old_review = _bundle_fixture(tmp_path)
    before = hashlib.sha256(old_review.read_bytes()).hexdigest()

    workspace_path = waypoint_review.build_waypoint_workspace(
        bundle,
        tmp_path / "workspace",
        require_all_counts=False,
    )

    assert hashlib.sha256(old_review.read_bytes()).hexdigest() == before
    workspace = json.loads(workspace_path.read_text())
    review_path = Path(workspace["sessions"][0]["review_path"])
    document = json.loads(review_path.read_text())
    assert document["primary_frame_id"] == 1
    assert [row["frame_id"] for row in document["source_frames"]] == [1, 2]
    assert document["source_frames"][0]["size_wh"] == [40, 40]
    assert len(document["components"]) == 2
    assert len(document["waypoint_pool"]) == 1
    assert all(
        row["source_anchor"]["frame_id"] == 1
        and len(row["assets"]["views"]) == 1
        and row["assets"]["views"][0]["frame_id"] == 1
        for row in document["components"]
    )
    frame_asset = review_path.parent / document["source_frames"][0]["image"]
    assert frame_asset.read_bytes() == Path(
        json.loads(bundle.read_text())["sessions"][0]["selected_frames"][0][
            "source_rgb"
        ]
    ).read_bytes()


def test_builder_migrates_only_unique_exact_primary_shape_review(tmp_path):
    bundle, _ = _bundle_fixture(tmp_path)

    workspace_path = waypoint_review.build_waypoint_workspace(
        bundle,
        tmp_path / "workspace",
        require_all_counts=False,
    )

    workspace = json.loads(workspace_path.read_text())
    document = json.loads(
        Path(workspace["sessions"][0]["review_path"]).read_text()
    )
    migrated = next(
        row for row in document["components"]
        if row["source_anchor"]["shape_id"] == "00001:001"
    )
    unmatched = next(
        row for row in document["components"]
        if row["source_anchor"]["shape_id"] == "00001:002"
    )
    assert migrated["prediction"]["part_id"] == "3001"
    assert migrated["review"]["confirmed"] is True
    assert migrated["review"]["color"] == "red"
    assert unmatched["prediction"]["part_name"] == "unknown brick"
    assert unmatched["review"]["confirmed"] is False
    assert document["migration_summary"] == {
        "eligible_confirmed": 1,
        "migrated_confirmed": 1,
        "ambiguous": 0,
        "not_in_primary": 0,
    }


def test_builder_never_combines_shapes_from_different_frames(tmp_path):
    bundle, _ = _bundle_fixture(tmp_path)

    workspace_path = waypoint_review.build_waypoint_workspace(
        bundle,
        tmp_path / "workspace",
        require_all_counts=False,
    )

    workspace = json.loads(workspace_path.read_text())
    document = json.loads(
        Path(workspace["sessions"][0]["review_path"]).read_text()
    )
    all_components = document["components"] + [
        row["component"] for row in document["waypoint_pool"]
    ]
    for row in all_components:
        frame_id = row["source_anchor"]["frame_id"]
        assert {view["frame_id"] for view in row["assets"]["views"]} == {
            frame_id
        }
