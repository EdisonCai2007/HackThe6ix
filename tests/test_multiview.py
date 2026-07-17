import numpy as np

from pipeline.color import PALETTE
from pipeline.multiview import (
    Observation,
    box_is_complete,
    fuse_observations,
)


def _color(name):
    return next(color for color in PALETTE if color.name == name)


def _obs(frame, box, color="red", complete=True, quality=1.0,
         clearance=20.0):
    return Observation(
        frame_id=frame,
        view_index=frame,
        box=box,
        color=_color(color),
        complete=complete,
        boundary_clearance=clearance,
        quality=quality,
    )


def test_boundary_observation_is_incomplete():
    mask = np.ones((100, 100), dtype=np.uint8) * 255

    assert not box_is_complete((0, 20, 30, 50), mask, margin=4)
    assert box_is_complete((10, 20, 30, 50), mask, margin=4)


def test_three_views_of_one_piece_fuse_once_and_prefer_complete():
    observations = [
        _obs(1, (10, 10, 40, 40), complete=False, quality=5.0),
        _obs(2, (13, 11, 43, 41), complete=True, quality=2.0),
        _obs(3, (11, 13, 41, 43), complete=True, quality=1.0),
    ]

    instances = fuse_observations(observations)

    assert len(instances) == 1
    assert len(instances[0].observations) == 3
    assert instances[0].best.frame_id == 2


def test_nearby_different_colors_and_distinct_same_color_pieces_stay_separate():
    observations = [
        _obs(1, (10, 20, 35, 45), "red"),
        _obs(1, (42, 20, 67, 45), "yellow"),
        _obs(1, (90, 20, 115, 45), "red"),
        _obs(2, (12, 21, 37, 46), "red"),
        _obs(2, (44, 21, 69, 46), "yellow"),
        _obs(2, (92, 21, 117, 46), "red"),
    ]

    instances = fuse_observations(observations)

    assert len(instances) == 3
    assert sorted(len(instance.observations) for instance in instances) == [2, 2, 2]


def test_one_cluster_never_contains_two_detections_from_the_same_view():
    observations = [
        _obs(1, (10, 10, 40, 40)),
        _obs(1, (30, 10, 60, 40)),
        _obs(2, (20, 11, 50, 41)),
    ]

    instances = fuse_observations(observations)

    assert len(instances) == 2
    assert all(len({obs.view_index for obs in instance.observations})
               == len(instance.observations) for instance in instances)
