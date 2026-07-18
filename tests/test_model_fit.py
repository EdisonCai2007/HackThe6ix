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
