"""Bridge tests: identification crops come from ORIGINAL frames (manifest v2)."""
import json

import cv2
import numpy as np
import pytest

import pipeline.multiview
from pipeline.identify import Identification
from pipeline.multiview import scan_manifest


RECTIFIED_BGR = (9, 26, 201)   # red-ish block in the rectified view
ORIGINAL_BGR = (201, 26, 9)    # blue-ish block in the original frame


def _write_session(session, with_bridge=True, second_view=False):
    """Canvas 800x600, original 1600x1200 per view, H = diag(2,2,1).

    Block dimensions mirror the proven test_session_cli fixture — smaller
    synthetic blocks get fragmented by the cv detector's morphology.
    second_view adds a lower-quality frame 2 seeing the same block.
    """
    output = session / "multiview"
    output.mkdir(parents=True)
    frames = session / "frames"
    frames.mkdir()

    views = []
    frame_specs = [(1, 1.0, 0)] + ([(2, 0.5, 4)] if second_view else [])
    for frame_id, quality, offset in frame_specs:
        rectified = np.full((600, 800, 3), 245, dtype=np.uint8)
        rectified[180 + offset:280 + offset,
                  250 + offset:370 + offset] = RECTIFIED_BGR
        original = np.full((1200, 1600, 3), 245, dtype=np.uint8)
        original[360:560, 500:740] = ORIGINAL_BGR

        cv2.imwrite(str(output / f"view_{frame_id:05d}.jpg"), rectified)
        cv2.imwrite(str(output / f"view_{frame_id:05d}.mask.png"),
                    np.full((600, 800), 255, dtype=np.uint8))
        cv2.imwrite(str(frames / f"{frame_id:05d}.rgb.jpg"), original)

        view = {
            "frame_id": frame_id,
            "quality": quality,
            "image": f"multiview/view_{frame_id:05d}.jpg",
            "mask": f"multiview/view_{frame_id:05d}.mask.png",
            "size_wh": [800, 600],
        }
        if with_bridge:
            view.update({
                "homography": np.diag([2.0, 2.0, 1.0]).tolist(),
                "rgb": f"frames/{frame_id:05d}.rgb.jpg",
                "rgb_size": [1200, 1600],
                "raise_uv_per_cm": [4.0, -6.0],
            })
        views.append(view)
    manifest = {
        "version": 2 if with_bridge else 1,
        "session_dir": str(session),
        "px_per_m": 1000.0,
        "origin_xy": [0.0, 0.0],
        "size_wh": [800, 600],
        "edge_margin_px": 8,
        "union_coverage": 1.0,
        "selected_coverage": 1.0,
        "views": views,
    }
    path = output / "manifest.json"
    path.write_text(json.dumps(manifest))
    return path


def _fake_identify(captured):
    def fake(crops, **kwargs):
        captured.extend(crops)
        return [Identification("3001", "Brick 2 x 4", "Bricks", 0.9)
                for _ in crops]
    return fake


def test_v2_identifies_from_original_pixels(tmp_path, monkeypatch):
    manifest = _write_session(tmp_path / "session", with_bridge=True)
    captured = []
    monkeypatch.setattr(pipeline.multiview, "identify_all",
                        _fake_identify(captured))
    result = scan_manifest(manifest, detector="cv")
    assert len(result.instances) == 1
    assert len(captured) == 1
    center = captured[0][captured[0].shape[0] // 2, captured[0].shape[1] // 2]
    # The crop must contain the ORIGINAL frame's pixels, not the rectified's.
    assert np.abs(center.astype(int) - ORIGINAL_BGR).max() < 30

    prov = result.id_crops[0]
    assert prov["frame_id"] == 1
    assert prov["rgb"] == "frames/00001.rgb.jpg"
    x0, y0, x1, y1 = prov["box_original"]
    # Mapped block (500..740, 360..560) padded 20% and raise-extended.
    assert x0 <= 500 and x1 >= 740 and y0 <= 360 and y1 >= 560
    assert prov["brickognize_primary"]["part_id"] == "3001"
    assert prov["brickognize_raw"]["part_id"] == "3001"
    assert prov["brickognize_views"][0]["frame_id"] == 1
    assert prov["identity_support"] == {"3001": 1}
    assert prov["depth_height"]["action"] == "shadow_only"
    assert prov["depth_height"]["reliability"] == "unavailable"
    assert prov["brickognize"]["part_id"] == "3001"
    assert prov["brickognize"]["score"] == pytest.approx(0.9)


def test_v1_falls_back_to_rectified_crop(tmp_path, monkeypatch):
    manifest = _write_session(tmp_path / "session", with_bridge=False)
    captured = []
    monkeypatch.setattr(pipeline.multiview, "identify_all",
                        _fake_identify(captured))
    result = scan_manifest(manifest, detector="cv")
    assert len(result.instances) == 1
    center = captured[0][captured[0].shape[0] // 2, captured[0].shape[1] // 2]
    assert np.abs(center.astype(int) - RECTIFIED_BGR).max() < 30
    assert result.id_crops[0]["rgb"] is None  # provenance marks the fallback


def test_load_views_accepts_optional_camera_geometry(tmp_path):
    from pipeline.multiview import load_views

    manifest_path = _write_session(tmp_path / "session", with_bridge=True)
    manifest = json.loads(manifest_path.read_text())
    manifest["version"] = 3
    manifest["views"][0].update({
        "topdownness": 0.93,
        "sharpness": 117.5,
        "camera_position_table_xyz": [0.1, -0.2, 0.4],
        "camera_bearing_deg": 296.5,
    })
    manifest_path.write_text(json.dumps(manifest))

    _, views = load_views(manifest_path)

    assert views[0].topdownness == pytest.approx(0.93)
    assert views[0].sharpness_score == pytest.approx(117.5)
    assert views[0].camera_position_table_xyz == pytest.approx((0.1, -0.2, 0.4))
    assert views[0].camera_bearing_deg == pytest.approx(296.5)


def test_load_views_accepts_view_ray_geometry(tmp_path):
    from pipeline.multiview import load_views

    manifest_path = _write_session(tmp_path / "session", with_bridge=True)
    manifest = json.loads(manifest_path.read_text())
    manifest["version"] = 3
    manifest["views"][0].update({
        "viewing_ray_table_xyz": [0.3, 0.0, -0.9539],
        "view_tilt_deg": 17.46,
        "selection_role": "confirmation",
    })
    manifest_path.write_text(json.dumps(manifest))

    _, views = load_views(manifest_path)

    assert views[0].viewing_ray_table_xyz == pytest.approx(
        (0.3, 0.0, -0.9539)
    )
    assert views[0].view_tilt_deg == pytest.approx(17.46)
    assert views[0].selection_role == "confirmation"


def test_legacy_v3_view_geometry_defaults_to_unavailable(tmp_path):
    from pipeline.multiview import load_views

    manifest_path = _write_session(tmp_path / "session", with_bridge=True)
    manifest = json.loads(manifest_path.read_text())
    manifest["version"] = 3
    manifest_path.write_text(json.dumps(manifest))

    _, views = load_views(manifest_path)

    assert views[0].topdownness is None
    assert views[0].sharpness_score is None
    assert views[0].camera_position_table_xyz is None
    assert views[0].camera_bearing_deg is None
    assert views[0].viewing_ray_table_xyz is None
    assert views[0].view_tilt_deg is None
    assert views[0].selection_role is None


def _obs(view_index, box, complete, clearance=10.0):
    from pipeline.color import PALETTE
    from pipeline.multiview import Observation
    return Observation(
        frame_id=view_index, view_index=view_index, box=box,
        color=PALETTE[0], complete=complete, boundary_clearance=clearance,
        quality=0.0,
    )


def _view(view_index, quality, rgb_size=(1200, 1600)):
    from pipeline.multiview import RectifiedView
    return RectifiedView(
        frame_id=view_index, view_index=view_index,
        image=np.zeros((600, 800, 3), np.uint8),
        valid_mask=np.full((600, 800), 255, np.uint8),
        quality=quality,
        homography=np.diag([2.0, 2.0, 1.0]),
        rgb=f"frames/{view_index:05d}.rgb.jpg",
        rgb_size=rgb_size,
        raise_uv_per_cm=(0.0, 0.0),
    )


def test_id_observation_prefers_sharp_topdown_view_over_canvas_complete():
    """A piece clipped by the CANVAS crop is usually whole in the original
    frame — the sharp top-down view must win over an oblique complete one."""
    from pipeline.multiview import FusedInstance, _identification_observation

    views = [_view(0, quality=8.0), _view(1, quality=1.0)]
    # In view 0 (sharp, top-down) the observation is canvas-incomplete;
    # in view 1 (oblique) it is complete. Both fit the original frame.
    sharp = _obs(0, (600, 400, 690, 490), complete=False)
    oblique = _obs(1, (100, 100, 190, 190), complete=True)
    instance = FusedInstance([sharp, oblique], best=oblique)
    chosen, box = _identification_observation(instance, views)
    assert chosen is sharp
    assert box is not None


def test_id_observation_rejects_view_clipped_in_original_frame():
    """If the mapped crop runs off the original image, that view loses."""
    from pipeline.multiview import FusedInstance, _identification_observation

    # Tiny original: the mapped box (plus padding) cannot fit.
    views = [_view(0, quality=8.0, rgb_size=(300, 300)), _view(1, quality=1.0)]
    clipped = _obs(0, (700, 500, 790, 590), complete=False)
    safe = _obs(1, (100, 100, 190, 190), complete=True)
    instance = FusedInstance([clipped, safe], best=safe)
    chosen, _ = _identification_observation(instance, views)
    assert chosen is safe


def test_stud_advisory_does_not_correct_from_one_view(tmp_path, monkeypatch):
    manifest = _write_session(tmp_path / "session", with_bridge=True)

    def fake_identify(crops, **kwargs):
        return [Identification("3008", "Brick 1 x 8", None, 0.79, candidates=(
            {"part_id": "3008", "name": "Brick 1 x 8", "score": 0.79},
            {"part_id": "3028", "name": "Plate 6 x 12", "score": 0.55},
        )) for _ in crops]

    monkeypatch.setattr(pipeline.multiview, "identify_all", fake_identify)
    from pipeline.studs import StudEvidence
    monkeypatch.setattr(
        pipeline.multiview,
        "analyze_studs",
        lambda crop, radius_px, mask=None: StudEvidence(
            30, "high", "stud_face", False, 100.0, (), "fixture"
        ),
    )
    result = scan_manifest(manifest, detector="cv")
    assert result.id_crops[0]["stud"]["action"] == "ambiguous"
    assert result.id_crops[0]["brickognize_raw"]["part_id"] == "3008"
    assert result.id_crops[0]["brickognize"]["part_id"] == "3008"
    assert result.inventory[0]["part_id"] == "3008"


def test_stud_advisory_skips_when_studs_invisible(tmp_path, monkeypatch):
    manifest = _write_session(tmp_path / "session", with_bridge=True)

    def fake_identify(crops, **kwargs):
        return [Identification("3007", "Brick 2 x 8", None, 0.79)
                for _ in crops]

    monkeypatch.setattr(pipeline.multiview, "identify_all", fake_identify)
    from pipeline.studs import StudEvidence
    monkeypatch.setattr(
        pipeline.multiview,
        "analyze_studs",
        lambda crop, radius_px, mask=None: StudEvidence(
            1, "low", "partial", False, 100.0, (), "fixture"
        ),
    )
    result = scan_manifest(manifest, detector="cv")
    assert result.id_crops[0]["stud"]["action"] == "unreliable"
    assert result.id_crops[0]["brickognize"]["part_id"] == "3007"


def test_second_chance_uses_alternate_view_for_weak_id(tmp_path, monkeypatch):
    # Two views of the same block; the chosen view's crop IDs weakly, the
    # alternate strongly — the strong one must win and be recorded.
    session = tmp_path / "session"
    manifest = _write_session(session, with_bridge=True, second_view=True)

    def fake_identify_all(crops, **kwargs):
        return [Identification(None, "unknown brick", None, 0.55)
                for _ in crops]

    def fake_identify_crop(crop, **kwargs):
        return Identification("3008", "Brick 1 x 8", None, 0.84)

    monkeypatch.setattr(pipeline.multiview, "identify_all", fake_identify_all)
    monkeypatch.setattr(pipeline.multiview, "identify_crop",
                        fake_identify_crop)
    from pipeline.studs import StudEvidence
    monkeypatch.setattr(
        pipeline.multiview,
        "analyze_studs",
        lambda crop, radius_px, mask=None: StudEvidence(
            0, "low", "not_visible", False, 100.0, (), "fixture"
        ),
    )
    result = scan_manifest(manifest, detector="cv")
    assert len(result.instances) == 1
    prov = result.id_crops[0]
    assert prov["source"] == "original-masked-second-chance"
    assert prov["brickognize"]["part_id"] == "3008"


def test_second_chance_picks_best_alternate_not_first(tmp_path, monkeypatch):
    """Among alternates, the highest confident score wins — a clipped view's
    confident-but-lower ID (wedge 0.74) must lose to a clean 0.84."""
    from pipeline.multiview import FusedInstance, _second_chance

    session = tmp_path / "session"
    frames = session / "frames"
    frames.mkdir(parents=True)
    for fid in (1, 2, 3):
        cv2.imwrite(str(frames / f"{fid:05d}.rgb.jpg"),
                    np.full((1200, 1600, 3), 245, dtype=np.uint8))

    views = [_view(i, quality=8.0 - i) for i in range(3)]
    # RectifiedView is a plain dataclass; fix rgb paths to match frame ids.
    for i, v in enumerate(views):
        v.rgb = f"frames/{i + 1:05d}.rgb.jpg"
        v.frame_id = i + 1
    obs = [_obs(i, (300, 300, 390, 390), complete=True) for i in range(3)]
    instance = FusedInstance(obs, best=obs[0])

    by_frame = {2: Identification("XXXX", "Wedge 2 x 2", None, 0.74),
                3: Identification("3008", "Brick 1 x 8", None, 0.84)}
    calls = []

    def fake_identify_crop(crop, **kwargs):
        calls.append(1)
        return by_frame[len(calls) + 1]

    monkeypatch.setattr(pipeline.multiview, "identify_crop",
                        fake_identify_crop)
    identifications = [Identification(None, "unknown brick", None, 0.55)]
    crops = [np.zeros((8, 8, 3), np.uint8)]
    id_crops = [{"frame_id": 1, "rgb": views[0].rgb, "box_original": [0, 0, 8, 8],
                 "source": "original-masked"}]
    identifications, crops, id_crops = _second_chance(
        [instance], views, session, identifications, crops, id_crops,
        cache_dir=tmp_path)
    assert identifications[0].part_id == "3008"
    assert identifications[0].score == 0.84
    assert id_crops[0]["source"] == "original-masked-second-chance"


def test_segmentation_reviews_safe_context_crop_for_moderate_id(
    tmp_path, monkeypatch
):
    """A moderate masked ID can hide a brick's side; when no neighboring
    instance enters the padding, retain real context and use stronger ID."""
    from pipeline.multiview import FusedInstance, _second_chance

    original = np.full((120, 160, 3), 225, dtype=np.uint8)
    original[40:80, 40:120] = (0, 80, 240)
    mask = np.zeros((120, 160), dtype=bool)
    mask[40:80, 40:120] = True
    observation = _obs(0, (40, 40, 120, 80), complete=True)
    observation.frame_id = 1
    observation.detector = "seg"
    observation.mask_original = mask
    observation.original_image = original
    observation.box_original = (40, 40, 120, 80)
    observation.source_instance_id = "piece-0"
    observation.confidence = 0.95
    instance = FusedInstance([observation], observation)
    view = _view(0, quality=2.0, rgb_size=(160, 120))
    view.frame_id = 1
    view.rgb = "frames/00001.rgb.jpg"
    calls = []

    def fake_identify_crop(crop, **kwargs):
        calls.append(crop.copy())
        if len(calls) == 1:
            return Identification("3460", "Plate 1 x 8", None, 0.80)
        return Identification("3008", "Brick 1 x 8", None, 0.91)

    monkeypatch.setattr(
        pipeline.multiview, "identify_crop", fake_identify_crop
    )
    identifications, crops, id_crops = _second_chance(
        [instance], [view], tmp_path,
        [Identification("3460", "Plate 1 x 8", None, 0.79)],
        [np.zeros((8, 8, 3), np.uint8)],
        [{
            "frame_id": 1,
            "rgb": view.rgb,
            "box_original": [0, 0, 8, 8],
            "source": "yolo-instance-mask",
        }],
        cache_dir=tmp_path,
    )

    assert len(calls) == 2
    assert identifications[0].part_id == "3008"
    assert id_crops[0]["source"] == "yolo-instance-context-second-chance"


def test_high_score_regular_segmentation_still_requires_family_review():
    from pipeline.multiview import _needs_family_review

    primary = Identification(
        "3021", "Plate 2 x 3", None, 0.90,
        candidates=(
            {"part_id": "3021", "name": "Plate 2 x 3", "score": 0.90},
            {"part_id": "3002", "name": "Brick 2 x 3", "score": 0.72},
        ),
    )

    assert _needs_family_review(
        primary, detector="seg", metric_flag=None
    )


def test_two_alternate_frames_overrule_one_high_primary():
    from pipeline.multiview import _select_identity_consensus

    entries = [
        {"frame_id": 1, "part_id": "3021", "name": "Plate 2 x 3",
         "score": 0.90},
        {"frame_id": 2, "part_id": "3002", "name": "Brick 2 x 3",
         "score": 0.88},
        {"frame_id": 3, "part_id": "3002", "name": "Brick 2 x 3",
         "score": 0.86},
    ]

    selected, disagreement, support = _select_identity_consensus(entries)

    assert selected["part_id"] == "3002"
    assert not disagreement
    assert support == {"3021": 1, "3002": 2}


def test_conflicting_single_alternate_preserves_high_primary_and_flags():
    from pipeline.multiview import _select_identity_consensus

    entries = [
        {"frame_id": 1, "part_id": "3021", "name": "Plate 2 x 3",
         "score": 0.90},
        {"frame_id": 2, "part_id": "3002", "name": "Brick 2 x 3",
         "score": 0.91},
    ]

    selected, disagreement, support = _select_identity_consensus(entries)

    assert selected["part_id"] == "3021"
    assert disagreement
    assert support == {"3021": 1, "3002": 1}


def test_family_review_uses_distinct_frame_consensus(tmp_path, monkeypatch):
    from pipeline.multiview import FusedInstance, _second_chance

    original = np.full((120, 160, 3), 225, dtype=np.uint8)
    original[40:80, 40:120] = (0, 80, 240)
    mask = np.zeros((120, 160), dtype=bool)
    mask[40:80, 40:120] = True
    observations = []
    views = []
    for index, frame_id in enumerate((1, 2, 3)):
        observation = _obs(index, (40, 40, 120, 80), complete=True)
        observation.frame_id = frame_id
        observation.detector = "seg"
        observation.mask_original = mask
        observation.original_image = original
        observation.box_original = (40, 40, 120, 80)
        observation.source_instance_id = f"piece-{index}"
        observation.confidence = 0.95
        observations.append(observation)
        view = _view(index, quality=3.0 - index, rgb_size=(160, 120))
        view.frame_id = frame_id
        view.rgb = f"frames/{frame_id:05d}.rgb.jpg"
        views.append(view)
    instance = FusedInstance(observations, observations[0])
    primary = Identification(
        "3021", "Plate 2 x 3", None, 0.90,
        candidates=(
            {"part_id": "3021", "name": "Plate 2 x 3", "score": 0.90},
            {"part_id": "3002", "name": "Brick 2 x 3", "score": 0.72},
        ),
    )
    monkeypatch.setattr(
        pipeline.multiview,
        "identify_crop",
        lambda crop, **kwargs: Identification(
            "3002", "Brick 2 x 3", None, 0.88
        ),
    )
    id_crops = [{
        "frame_id": 1,
        "rgb": views[0].rgb,
        "box_original": [40, 40, 120, 80],
        "source": "yolo-instance-mask",
    }]

    identifications, _, id_crops = _second_chance(
        [instance], views, tmp_path, [primary],
        [original[40:80, 40:120].copy()], id_crops,
        cache_dir=tmp_path,
    )

    assert identifications[0].part_id == "3002"
    assert id_crops[0]["identity_support"] == {"3021": 1, "3002": 2}
    assert "family_reviewed" in id_crops[0]["flags"]
    assert len({entry["frame_id"]
                for entry in id_crops[0]["brickognize_views"]}) == 3
    support = id_crops[0]["appearance_support"]
    assert support["unique_top_candidate"] == "3002"
    assert support["unique_top_count"] == 2
    assert support["candidate_support"]["3002"]["accepted_frame_ids"] == [2, 3]


def test_model_fit_diagnostic_ranks_regular_conflicts_without_changing_id(
    tmp_path, monkeypatch,
):
    from pipeline.model_fit import (
        CandidateFit,
        FrameCalibration,
        ModelFitEvidence,
        resting_orientations,
    )
    from pipeline.multiview import (
        FusedInstance,
        _attach_model_fit_diagnostics,
    )

    observation = _obs(0, (20, 20, 60, 50), complete=True)
    observation.frame_id = 7
    observation.confidence = 0.9
    observation.mask_original = np.zeros((100, 120), dtype=bool)
    observation.mask_original[35:65, 45:80] = True
    instance = FusedInstance([observation], observation)
    calibration = FrameCalibration(
        frame_id=7,
        intrinsics=(100.0, 100.0, 60.0, 50.0),
        rgb_size=(120, 100),
        camera_to_world=np.eye(4),
        world_to_table=np.eye(4),
        view_tilt_deg=45.0,
    )
    monkeypatch.setattr(
        pipeline.multiview,
        "load_frame_calibrations",
        lambda session_dir, views: {7: calibration},
    )
    calls = []

    def fake_compare(models, observations, seed_xy):
        calls.append(tuple(model.part_id for model in models))
        fits = []
        for index, model in enumerate(models):
            fits.append(CandidateFit(
                model=model,
                total=0.1 + index * 0.1,
                orientation=resting_orientations(model)[0],
                center_xy=seed_xy,
                yaw_deg=0.0,
                view_losses=({
                    "frame_id": 7, "weight": 1.0, "trimmed": False,
                    "iou": 0.8, "boundary_error": 0.01,
                    "under_coverage": 0.1, "spill": 0.1, "total": 0.1,
                },),
                trimmed_frame_id=None,
                reliability="diagnostic",
                reason="fixture",
            ))
        return ModelFitEvidence(
            candidates=tuple(fits),
            best_part_id=fits[0].model.part_id,
            runner_up_margin=0.1,
            reliability="diagnostic",
            reason="fixture",
        )

    monkeypatch.setattr(
        pipeline.multiview, "compare_regular_candidates", fake_compare
    )
    identity = {"part_id": "3001", "name": "Brick 2 x 4", "score": 0.88}
    id_crops = [{
        "brickognize": dict(identity),
        "appearance_support": {"candidate_support": {
            "3020": {
                "part_id": "3020", "name": "Plate 2 x 4",
                "accepted_frame_ids": [7], "weak_frame_ids": [],
            },
            "3001": {
                "part_id": "3001", "name": "Brick 2 x 4",
                "accepted_frame_ids": [], "weak_frame_ids": [7],
            },
        }},
    }]
    analysis_dir = tmp_path / "analysis"
    manifest = {
        "session_dir": str(tmp_path / "session"),
        "origin_xy": [0.0, 0.0],
        "px_per_m": 1000.0,
    }

    _attach_model_fit_diagnostics(
        [instance], [_view(0, quality=1.0)], id_crops, manifest,
        analysis_dir,
    )

    assert calls == [("3020", "3001")]
    assert id_crops[0]["model_fit"]["best_part_id"] == "3020"
    assert id_crops[0]["model_fit"]["review_recommended"] is True
    assert "diagnostic_model_disagreement" in id_crops[0]["flags"]
    assert id_crops[0]["brickognize"] == identity
    overlay_paths = id_crops[0]["model_fit"]["overlay_paths"]
    assert overlay_paths
    assert all(str(path).startswith(str(analysis_dir)) for path in overlay_paths)
    assert not (tmp_path / "session" / "debug").exists()


def test_model_fit_diagnostic_marks_irregular_candidates_unavailable(
    tmp_path, monkeypatch,
):
    from pipeline.multiview import FusedInstance, _attach_model_fit_diagnostics

    observation = _obs(0, (20, 20, 60, 50), complete=True)
    instance = FusedInstance([observation], observation)
    monkeypatch.setattr(
        pipeline.multiview, "load_frame_calibrations", lambda *args: {}
    )
    id_crops = [{
        "appearance_support": {"candidate_support": {
            "3040": {
                "part_id": "3040", "name": "Slope 45 2 x 1",
                "accepted_frame_ids": [1], "weak_frame_ids": [],
            },
        }},
    }]

    _attach_model_fit_diagnostics(
        [instance], [_view(0, quality=1.0)], id_crops,
        {"session_dir": str(tmp_path), "origin_xy": [0, 0],
         "px_per_m": 1000.0},
        tmp_path / "analysis",
    )

    evidence = id_crops[0]["model_fit"]
    assert evidence["reliability"] == "unavailable"
    assert "regular" in evidence["reason"]
