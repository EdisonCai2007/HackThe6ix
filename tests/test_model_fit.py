from pathlib import Path
from types import SimpleNamespace
import json

import cv2
import numpy as np


TARGET_SESSION = Path(
    "/Users/emily/lego-capture/sessions/20260717-233252"
)


def _synthetic_calibration():
    from pipeline.model_fit import FrameCalibration

    camera_to_world = np.eye(4)
    camera_to_world[2, 3] = 1.0
    return FrameCalibration(
        frame_id=1,
        intrinsics=(500.0, 500.0, 320.0, 240.0),
        rgb_size=(640, 480),
        camera_to_world=camera_to_world,
        world_to_table=np.eye(4),
        view_tilt_deg=45.0,
    )


def test_projection_centers_table_origin_for_identity_arkit_camera():
    from pipeline.model_fit import project_table_points

    pixels, valid = project_table_points(
        np.array([[0.0, 0.0, 0.0]]), _synthetic_calibration()
    )

    np.testing.assert_allclose(pixels, [[320.0, 240.0]])
    np.testing.assert_array_equal(valid, [True])


def test_projection_rejects_points_behind_camera():
    from pipeline.model_fit import project_table_points

    _, valid = project_table_points(
        np.array([[0.0, 0.0, 2.0]]), _synthetic_calibration()
    )

    np.testing.assert_array_equal(valid, [False])


def test_real_frame_projection_agrees_with_stored_plane_homography():
    from pipeline.model_fit import (
        load_frame_calibrations,
        project_table_points,
    )

    manifest = json.loads(
        (TARGET_SESSION / "multiview" / "manifest.json").read_text()
    )
    stored_view = next(
        view for view in manifest["views"] if view["frame_id"] == 14
    )
    view = SimpleNamespace(
        frame_id=14,
        view_tilt_deg=stored_view["view_tilt_deg"],
    )
    calibration = load_frame_calibrations(TARGET_SESSION, [view])[14]
    points_table = np.array([
        [-0.10, -0.08, 0.0],
        [0.00, 0.00, 0.0],
        [0.10, 0.08, 0.0],
    ])

    projected, valid = project_table_points(points_table, calibration)

    origin = np.asarray(manifest["origin_xy"])
    canvas = (
        (points_table[:, :2] - origin) * float(manifest["px_per_m"])
    )
    expected = cv2.perspectiveTransform(
        canvas.reshape(-1, 1, 2).astype(np.float64),
        np.asarray(stored_view["homography"], dtype=np.float64),
    ).reshape(-1, 2)
    np.testing.assert_array_equal(valid, [True, True, True])
    np.testing.assert_allclose(projected, expected, atol=1e-5, rtol=0.0)


def test_regular_model_parses_brick_and_plate_dimensions():
    from pipeline.model_fit import RegularModel

    brick = RegularModel.from_identification("3001", "Brick 2 x 4")
    plate = RegularModel.from_identification("3020", "Plate 2 x 4")

    assert brick is not None
    assert brick.part_id == "3001"
    np.testing.assert_allclose(brick.dimensions_xyz, (0.016, 0.032, 0.0096))
    assert plate is not None
    np.testing.assert_allclose(plate.dimensions_xyz, (0.016, 0.032, 0.0032))


def test_regular_model_rejects_irregular_names():
    from pipeline.model_fit import RegularModel

    assert RegularModel.from_identification("2445", "Plate 2 x 12") is not None
    assert RegularModel.from_identification("3040", "Slope 45 2 x 1") is None
    assert RegularModel.from_identification("4073", "Plate, Round 1 x 1") is None
    assert RegularModel.from_identification(None, "Brick 2 x 4") is None


def test_resting_orientations_deduplicate_xy_yaw_symmetry():
    from pipeline.model_fit import RegularModel, resting_orientations

    rectangular = RegularModel.from_identification("3001", "Brick 2 x 4")
    square = RegularModel.from_identification("3003", "Brick 2 x 2")

    rectangular_orientations = resting_orientations(rectangular)
    square_orientations = resting_orientations(square)

    assert len(rectangular_orientations) == 3
    assert len(square_orientations) == 2
    assert {
        round(orientation.dimensions_xyz[2], 4)
        for orientation in rectangular_orientations
    } == {0.0096, 0.016, 0.032}
    assert len({
        tuple(round(value, 6) for value in orientation.dimensions_xyz)
        for orientation in rectangular_orientations
    }) == 3


def test_projected_cuboid_rasterizes_nonempty_boolean_mask():
    from pipeline.model_fit import cuboid_vertices, render_cuboid

    vertices = cuboid_vertices(
        center_xy=(0.0, 0.0),
        yaw_deg=30.0,
        dimensions_xyz=(0.032, 0.016, 0.0096),
    )
    mask = render_cuboid((480, 640), _synthetic_calibration(), vertices)

    assert mask.dtype == np.bool_
    assert mask.shape == (480, 640)
    assert int(mask.sum()) > 0
    np.testing.assert_allclose(vertices[:, 2].min(), 0.0)
    np.testing.assert_allclose(vertices[:, 2].max(), 0.0096)


def _rectangle_mask(box, shape=(80, 100)):
    x0, y0, x1, y1 = box
    mask = np.zeros(shape, dtype=bool)
    mask[y0:y1, x0:x1] = True
    return mask


def test_equal_silhouettes_have_perfect_terms_and_zero_loss():
    from pipeline.model_fit import score_silhouettes

    mask = _rectangle_mask((25, 20, 70, 60))
    loss = score_silhouettes(mask, mask.copy())

    assert loss.iou == 1.0
    assert loss.boundary_error == 0.0
    assert loss.under_coverage == 0.0
    assert loss.spill == 0.0
    assert loss.total == 0.0


def test_contained_prediction_reports_undercoverage_not_spill():
    from pipeline.model_fit import score_silhouettes

    observed = _rectangle_mask((20, 15, 80, 65))
    predicted = _rectangle_mask((30, 25, 70, 55))
    loss = score_silhouettes(observed, predicted)

    assert loss.under_coverage > 0.0
    assert loss.spill == 0.0


def test_oversized_prediction_reports_spill_not_undercoverage():
    from pipeline.model_fit import score_silhouettes

    observed = _rectangle_mask((30, 25, 70, 55))
    predicted = _rectangle_mask((20, 15, 80, 65))
    loss = score_silhouettes(observed, predicted)

    assert loss.spill > 0.0
    assert loss.under_coverage == 0.0


def test_boundary_error_is_symmetric_for_opposite_translations():
    from pipeline.model_fit import score_silhouettes

    observed = _rectangle_mask((35, 25, 65, 55))
    shifted_left = _rectangle_mask((30, 25, 60, 55))
    shifted_right = _rectangle_mask((40, 25, 70, 55))

    left = score_silhouettes(observed, shifted_left)
    right = score_silhouettes(observed, shifted_right)

    assert left.boundary_error == right.boundary_error
    assert left.total == right.total


def _look_at_calibration(frame_id, position, tilt_deg):
    from pipeline.model_fit import FrameCalibration

    position = np.asarray(position, dtype=float)
    forward = -position / np.linalg.norm(position)
    right = np.cross(forward, np.array([0.0, 0.0, 1.0]))
    right /= np.linalg.norm(right)
    up = np.cross(right, forward)
    camera_to_world = np.eye(4)
    camera_to_world[:3, :3] = np.column_stack([right, up, -forward])
    camera_to_world[:3, 3] = position
    return FrameCalibration(
        frame_id=frame_id,
        intrinsics=(260.0, 260.0, 80.0, 80.0),
        rgb_size=(160, 160),
        camera_to_world=camera_to_world,
        world_to_table=np.eye(4),
        view_tilt_deg=tilt_deg,
    )


def _fit_observations(model, orientation_index=0, corrupt_frame=None,
                      tilts=(40.0, 50.0, 55.0, 60.0)):
    from pipeline.model_fit import (
        FitObservation,
        cuboid_vertices,
        render_cuboid,
        resting_orientations,
    )

    positions = (
        (0.00, -0.12, 0.12),
        (0.10, -0.08, 0.10),
        (-0.10, -0.07, 0.11),
        (0.02, 0.12, 0.09),
    )
    dimensions = resting_orientations(model)[orientation_index].dimensions_xyz
    vertices = cuboid_vertices((0.0, 0.0), 30.0, dimensions)
    observations = []
    for frame_id, (position, tilt) in enumerate(zip(positions, tilts), 1):
        calibration = _look_at_calibration(frame_id, position, tilt)
        mask = render_cuboid((160, 160), calibration, vertices)
        if frame_id == corrupt_frame:
            mask = np.roll(mask, 35, axis=1)
        observations.append(FitObservation(
            frame_id=frame_id,
            mask_original=mask,
            calibration=calibration,
            confidence=1.0,
            boundary_zone=False,
            sharpness=1.0,
        ))
    return observations


def test_side_resting_brick_prefers_brick_over_plate():
    from pipeline.model_fit import RegularModel, compare_regular_candidates

    brick = RegularModel.from_identification("3001", "Brick 2 x 4")
    plate = RegularModel.from_identification("3020", "Plate 2 x 4")
    observations = _fit_observations(brick, orientation_index=0)

    evidence = compare_regular_candidates(
        (brick, plate), observations, (0.0, 0.0), yaw_values=(30.0,)
    )

    assert evidence.best_part_id == "3001"
    assert evidence.candidates[0].total < evidence.candidates[1].total
    assert evidence.reliability == "diagnostic"


def test_side_resting_plate_prefers_plate_over_brick():
    from pipeline.model_fit import RegularModel, compare_regular_candidates

    brick = RegularModel.from_identification("3001", "Brick 2 x 4")
    plate = RegularModel.from_identification("3020", "Plate 2 x 4")
    observations = _fit_observations(plate, orientation_index=0)

    evidence = compare_regular_candidates(
        (brick, plate), observations, (0.0, 0.0), yaw_values=(30.0,)
    )

    assert evidence.best_part_id == "3020"


def test_two_by_two_silhouette_prefers_two_by_two_over_one_by_two():
    from pipeline.model_fit import RegularModel, compare_regular_candidates

    two_by_two = RegularModel.from_identification("3003", "Brick 2 x 2")
    one_by_two = RegularModel.from_identification("3004", "Brick 1 x 2")
    observations = _fit_observations(two_by_two, orientation_index=1)

    evidence = compare_regular_candidates(
        (one_by_two, two_by_two), observations, (0.0, 0.0),
        yaw_values=(30.0,),
    )

    assert evidence.best_part_id == "3003"


def test_fit_may_trim_one_corrupted_nonessential_auxiliary_view():
    from pipeline.model_fit import RegularModel, fit_regular_candidate

    brick = RegularModel.from_identification("3001", "Brick 2 x 4")
    observations = _fit_observations(brick, corrupt_frame=4)

    fit = fit_regular_candidate(
        brick, observations, (0.0, 0.0), yaw_values=(30.0,)
    )

    assert fit.trimmed_frame_id == 4
    assert len(fit.view_losses) == 4


def test_fit_never_trims_the_only_oblique_view():
    from pipeline.model_fit import RegularModel, fit_regular_candidate

    brick = RegularModel.from_identification("3001", "Brick 2 x 4")
    observations = _fit_observations(
        brick, corrupt_frame=4, tilts=(10.0, 10.0, 10.0, 45.0)
    )

    fit = fit_regular_candidate(
        brick, observations, (0.0, 0.0), yaw_values=(30.0,)
    )

    assert fit.trimmed_frame_id != 4


def test_fit_without_oblique_view_is_low_reliability():
    from pipeline.model_fit import RegularModel, fit_regular_candidate

    brick = RegularModel.from_identification("3001", "Brick 2 x 4")
    observations = _fit_observations(
        brick, tilts=(10.0, 12.0, 15.0, 20.0)
    )

    fit = fit_regular_candidate(
        brick, observations, (0.0, 0.0), yaw_values=(30.0,)
    )

    assert fit.reliability == "low"
    assert "oblique" in fit.reason


def test_fit_scores_bounded_crop_for_large_original_mask(monkeypatch):
    import pipeline.model_fit as model_fit
    from pipeline.model_fit import FitObservation, RegularModel, ViewFitLoss

    calibration = _synthetic_calibration()
    calibration = model_fit.FrameCalibration(
        frame_id=calibration.frame_id,
        intrinsics=(500.0, 500.0, 600.0, 500.0),
        rgb_size=(1200, 1000),
        camera_to_world=calibration.camera_to_world,
        world_to_table=calibration.world_to_table,
        view_tilt_deg=45.0,
    )
    mask = np.zeros((1000, 1200), dtype=bool)
    mask[480:520, 570:630] = True
    observation = FitObservation(1, mask, calibration)
    scored_shapes = []

    def fake_evaluate(orientation, center, yaw, observations, weights,
                      allow_trim=True):
        scored_shapes.extend(item.mask_original.shape for item in observations)
        losses = [ViewFitLoss(1.0, 0.0, 0.0, 0.0, 0.0)
                  for _ in observations]
        return 0.0, losses, None

    monkeypatch.setattr(model_fit, "_evaluate_hypothesis", fake_evaluate)
    brick = RegularModel.from_identification("3001", "Brick 2 x 4")

    model_fit.fit_regular_candidate(
        brick, [observation], (0.0, 0.0), yaw_values=(0.0,)
    )

    assert scored_shapes
    assert max(height for height, _ in scored_shapes) < 300
    assert max(width for _, width in scored_shapes) < 300
