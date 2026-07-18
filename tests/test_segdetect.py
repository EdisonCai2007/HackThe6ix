import json

import cv2
import numpy as np
import pytest

from pipeline.segdetect import (
    GateConfig,
    RawSegmentation,
    detect_original_instances,
    gate_instance,
    map_instance,
    projected_workspace_roi,
)


def test_projected_workspace_roi_clips_to_original_bounds():
    contours = [[[-0.1, -0.1], [1.2, -0.1], [1.2, 1.2], [-0.1, 1.2]]]

    projection = projected_workspace_roi(
        contours, origin_xy=(0.0, 0.0), px_per_m=100.0,
        homography=np.eye(3), image_wh=(100, 80), pad_fraction=0.1,
    )

    assert 0 <= projection.roi.x0 < projection.roi.x1 <= 100
    assert 0 <= projection.roi.y0 < projection.roi.y1 <= 80
    assert projection.workspace_mask.shape == (80, 100)
    assert projection.workspace_mask.any()


def test_mask_maps_from_original_to_canvas():
    mask = np.zeros((160, 200), dtype=bool)
    mask[40:120, 50:150] = True

    mapped = map_instance(
        mask, canvas_to_original=np.diag([2.0, 2.0, 1.0]),
        canvas_wh=(100, 80),
    )

    assert mapped.box_canvas == pytest.approx((25, 20, 75, 60), abs=1)
    assert mapped.mask_canvas.shape == (80, 100)
    assert mapped.mask_canvas.any()


def test_boundary_piece_with_substantial_overlap_is_not_blanket_deleted():
    workspace = np.zeros((100, 100), dtype=bool)
    workspace[10:90, 10:90] = True
    mask = np.zeros_like(workspace)
    mask[25:55, 5:25] = True

    evidence = gate_instance(
        mask, workspace, confidence=0.90,
        config=GateConfig(min_workspace_overlap=0.50),
    )

    assert evidence.boundary_zone
    assert evidence.workspace_overlap == pytest.approx(0.75)
    assert evidence.accepted


def test_low_overlap_side_clutter_is_rejected_with_evidence():
    workspace = np.zeros((100, 100), dtype=bool)
    workspace[20:80, 20:80] = True
    mask = np.zeros_like(workspace)
    mask[30:50, 75:95] = True

    evidence = gate_instance(mask, workspace, confidence=0.95)

    assert not evidence.accepted
    assert evidence.reason == "workspace_overlap"
    assert evidence.outside_fraction > 0.70


def test_mask_near_full_frame_workspace_edge_is_boundary_evidence():
    workspace = np.ones((100, 100), dtype=bool)
    mask = np.zeros_like(workspace)
    mask[1:12, 30:70] = True

    evidence = gate_instance(mask, workspace, confidence=0.90)

    assert evidence.accepted
    assert evidence.boundary_zone
    assert evidence.reason == "accepted_boundary"


class _FakeModel:
    def predict(self, image):
        mask = np.zeros(image.shape[:2], dtype=bool)
        mask[20:50, 30:70] = True
        return [RawSegmentation(mask, 0.92, "fake-0")]


class _CropBoundaryModel:
    def predict(self, image):
        mask = np.zeros(image.shape[:2], dtype=bool)
        mask[:20, 30:70] = True
        return [RawSegmentation(mask, 0.92, "crop-boundary")]


def _write_v3_fixture(tmp_path):
    session = tmp_path / "session"
    frames = session / "frames"
    multiview = session / "multiview"
    frames.mkdir(parents=True)
    multiview.mkdir()
    original = np.full((100, 120, 3), 230, np.uint8)
    original[30:60, 40:80] = (20, 40, 200)
    cv2.imwrite(str(frames / "00001.rgb.jpg"), original)
    rectified = original.copy()
    valid = np.full(original.shape[:2], 255, np.uint8)
    cv2.imwrite(str(multiview / "view_00001.jpg"), rectified)
    cv2.imwrite(str(multiview / "view_00001.mask.png"), valid)
    manifest = {
        "version": 3,
        "session_dir": str(session),
        "px_per_m": 100.0,
        "origin_xy": [0.0, 0.0],
        "size_wh": [120, 100],
        "edge_margin_px": 0,
        "union_coverage": 1.0,
        "selected_coverage": 1.0,
        "workspace_geometry": {
            "hard_source": "depth_observed_plane_component",
            "hard_contours_table_xy": [[
                [0.1, 0.1], [1.1, 0.1], [1.1, 0.9], [0.1, 0.9]
            ]],
            "dense_bounds_table_xy": [[0.1, 1.1], [0.1, 0.9]],
            "table_extent_xy": [[0.0, 1.2], [0.0, 1.0]],
        },
        "views": [{
            "frame_id": 1,
            "quality": 1.0,
            "image": "multiview/view_00001.jpg",
            "mask": "multiview/view_00001.mask.png",
            "size_wh": [120, 100],
            "homography": np.eye(3).tolist(),
            "rgb": "frames/00001.rgb.jpg",
            "rgb_size": [100, 120],
            "raise_uv_per_cm": [0.0, 0.0],
        }],
    }
    return manifest


def test_injected_model_runs_on_original_workspace_crop_and_maps_back(tmp_path):
    from pipeline.multiview import (
        load_views,
        observations_from_segmentations,
    )

    manifest = _write_v3_fixture(tmp_path)
    path = tmp_path / "session/multiview/manifest.json"
    path.write_text(json.dumps(manifest))
    loaded, views = load_views(path)

    detections = detect_original_instances(loaded, views, _FakeModel())

    assert len(detections) == 1
    detection = detections[0]
    assert detection.accepted
    assert detection.source_instance_id == "fake-0"
    assert detection.box_original[0] >= 10
    assert detection.box_canvas == pytest.approx(detection.box_original, abs=1)
    # Filled polygons include their boundary pixel before the five-pixel pad.
    assert detection.inference_roi == (5, 5, 116, 96)

    observations = observations_from_segmentations(detections, views)
    assert len(observations) == 1
    assert observations[0].box == detection.box_canvas
    assert observations[0].detector == "seg"
    assert observations[0].source_instance_id == "fake-0"
    assert observations[0].confidence == pytest.approx(0.92)
    assert observations[0].mask_original is detection.mask_original


def test_mask_touching_inference_crop_boundary_is_partial(tmp_path):
    from pipeline.multiview import load_views

    manifest = _write_v3_fixture(tmp_path)
    path = tmp_path / "session/multiview/manifest.json"
    path.write_text(json.dumps(manifest))
    loaded, views = load_views(path)

    detections = detect_original_instances(
        loaded, views, _CropBoundaryModel()
    )

    assert len(detections) == 1
    assert detections[0].accepted
    assert detections[0].gate.boundary_zone
    assert detections[0].gate.reason == "accepted_boundary"


def test_segmenter_refuses_legacy_manifest_without_physical_workspace():
    with pytest.raises(ValueError, match="manifest v3"):
        detect_original_instances({"version": 2}, [], _FakeModel())


def test_segmented_scan_uses_true_instance_mask_for_original_crop(
    tmp_path, monkeypatch
):
    import pipeline.multiview
    from pipeline.identify import Identification

    manifest = _write_v3_fixture(tmp_path)
    path = tmp_path / "session/multiview/manifest.json"
    path.write_text(json.dumps(manifest))
    monkeypatch.setattr(
        pipeline.multiview, "identify_all",
        lambda crops, **kwargs: [
            Identification("3001", "Brick 2 x 4", "Bricks", 0.90)
            for _ in crops
        ],
    )
    from pipeline.studs import StudEvidence
    monkeypatch.setattr(
        pipeline.multiview,
        "analyze_studs",
        lambda *args, **kwargs: StudEvidence(
            0, "low", "not_visible", False, 100.0, (), "fixture"
        ),
    )

    result = pipeline.multiview.scan_manifest(
        path, detector="seg", seg_model=_FakeModel()
    )

    assert len(result.instances) == 1
    assert result.id_crops[0]["source"] == "yolo-instance-mask"
    assert result.id_crops[0]["source_instance_id"] == "fake-0"
    assert result.id_crops[0]["segmentation_confidence"] == pytest.approx(0.92)
    metric = result.id_crops[0]["metric_silhouette"]
    assert metric["action"] == "shadow_only"
    assert metric["evidence"]["reliability"] == "low"
    assert metric["evidence"]["used_frame_ids"] == [1]
