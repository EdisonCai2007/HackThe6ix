import json
from types import SimpleNamespace

import cv2
import numpy as np
import pytest

from training.inventory_segmentation_labelme import (
    choose_refined_mask,
    copy_source_image,
    labelme_document,
    mask_polygon,
    select_original_review_views,
    validate_inventory_count_contract,
    visible_mask_box,
)


def test_mask_polygon_traces_one_visible_piece():
    mask = np.zeros((80, 100), dtype=np.uint8)
    cv2.rectangle(mask, (10, 20), (70, 60), 1, -1)

    points = mask_polygon(mask)

    assert len(points) == 4
    assert {tuple(point) for point in points} == {
        (10.0, 20.0),
        (10.0, 60.0),
        (70.0, 60.0),
        (70.0, 20.0),
    }


def test_labelme_document_preserves_expected_count_and_editable_polygons():
    document = labelme_document(
        image_name="01__session.jpg",
        image_size_wh=(100, 80),
        session_id="session",
        expected_count=2,
        polygons=[
            [[10.0, 10.0], [20.0, 10.0], [20.0, 20.0]],
            [[40.0, 40.0], [50.0, 40.0], [50.0, 50.0]],
        ],
    )

    assert document["flags"] == {"reviewed": False}
    assert document["imagePath"] == "01__session.jpg"
    assert document["imageWidth"] == 100
    assert document["imageHeight"] == 80
    assert document["session"] == {
        "session_id": "session",
        "expected_physical_count": 2,
        "proposal_count": 2,
    }
    assert [shape["label"] for shape in document["shapes"]] == [
        "lego_piece",
        "lego_piece",
    ]
    assert all(shape["shape_type"] == "polygon" for shape in document["shapes"])
    json.dumps(document)


def test_labelme_document_records_original_frame_provenance():
    document = labelme_document(
        image_name="01__session__frame-00044.jpg",
        image_size_wh=(1920, 1440),
        session_id="session",
        expected_count=74,
        polygons=[[[1.0, 2.0], [3.0, 2.0], [3.0, 4.0]]],
        frame_id=44,
        source_rgb="frames/00044.rgb.jpg",
        source_sha256="abc123",
        covered_fused_components=70,
    )

    assert document["session"] == {
        "session_id": "session",
        "expected_physical_count": 74,
        "proposal_count": 1,
        "frame_id": 44,
        "source_rgb": "frames/00044.rgb.jpg",
        "source_sha256": "abc123",
        "covered_fused_components": 70,
    }


def test_sam_refinement_requires_overlap_and_sane_area():
    original = np.zeros((100, 100), dtype=bool)
    original[20:70, 20:70] = True
    cleaner = np.zeros_like(original)
    cleaner[18:72, 18:72] = True
    wrong_neighbor = np.zeros_like(original)
    wrong_neighbor[20:70, 75:95] = True
    whole_image = np.ones_like(original)

    selected, source = choose_refined_mask(original, cleaner)
    assert source == "sam2_box_prompt"
    assert np.array_equal(selected, cleaner)

    selected, source = choose_refined_mask(original, wrong_neighbor)
    assert source == "yolo_fallback"
    assert np.array_equal(selected, original)

    selected, source = choose_refined_mask(original, whole_image)
    assert source == "yolo_fallback"
    assert np.array_equal(selected, original)


def test_sam_refinement_ignores_disconnected_yolo_noise():
    original = np.zeros((200, 200), dtype=bool)
    original[20:60, 20:60] = True
    for y in (90, 120, 150):
        for x in (20, 50, 80, 110):
            original[y : y + 20, x : x + 20] = True
    cleaner = np.zeros_like(original)
    cleaner[18:62, 18:62] = True

    selected, source = choose_refined_mask(original, cleaner)

    assert source == "sam2_box_prompt"
    assert np.array_equal(selected, cleaner)
    assert visible_mask_box(original) == (20, 20, 60, 60)


def test_original_review_views_use_minimum_cover_then_local_focus():
    def observation(view_index, focus):
        return SimpleNamespace(
            view_index=view_index,
            identification_focus=focus,
            mask_original=np.ones((2, 2), dtype=bool),
        )

    instances = [
        SimpleNamespace(observations=[observation(0, 2), observation(1, 8)]),
        SimpleNamespace(observations=[observation(0, 2), observation(1, 8)]),
        SimpleNamespace(observations=[observation(2, 4)]),
    ]
    views = [
        SimpleNamespace(view_index=0, quality=100),
        SimpleNamespace(view_index=1, quality=10),
        SimpleNamespace(view_index=2, quality=20),
    ]

    assert select_original_review_views(instances, views) == [1, 2]


def test_source_image_copy_is_byte_identical(tmp_path):
    source = tmp_path / "source.jpg"
    destination = tmp_path / "review" / "copied.jpg"
    source.write_bytes(b"not re-encoded image bytes\x00\xff")

    digest = copy_source_image(source, destination)

    assert destination.read_bytes() == source.read_bytes()
    assert digest == (
        "68d297f208e3d7dfa846a50c183a7e4278d591a58132e12ecaa0136e7bee410b"
    )


def test_inventory_count_contract_rejects_changed_batch_count():
    sessions = [
        {"session_id": "20260718-161438", "expected_count": 47},
    ]

    with pytest.raises(ValueError, match="20260718-161438.*48.*47"):
        validate_inventory_count_contract(sessions, require_all=False)
