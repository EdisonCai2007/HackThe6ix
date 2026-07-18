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
