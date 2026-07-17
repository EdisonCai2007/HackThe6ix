import numpy as np

from pipeline.color import PALETTE
from pipeline.multiview import (
    FusedInstance,
    Observation,
    RectifiedView,
    box_is_complete,
    compose_object_aware_mosaic,
    consensus_color,
    filter_unconfirmed_instances,
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


def test_partial_views_with_different_visible_areas_still_fuse():
    observations = [
        _obs(1, (0, 20, 120, 180), color="gray", complete=False),
        _obs(2, (55, 40, 120, 145), color="dark gray", complete=False),
    ]

    instances = fuse_observations(observations)

    assert len(instances) == 1


def test_same_piece_fuses_when_warm_color_shifts_between_views():
    observations = [
        _obs(1, (30, 30, 80, 100), color="yellow"),
        _obs(2, (34, 32, 84, 102), color="tan"),
    ]

    assert len(fuse_observations(observations)) == 1


def test_nearly_identical_geometry_overrules_cross_family_color_shift():
    observations = [
        _obs(1, (220, 635, 477, 904), color="dark blue"),
        _obs(2, (276, 645, 473, 872), color="dark gray"),
    ]

    assert len(fuse_observations(observations)) == 1


def test_consensus_color_overrules_one_bad_best_crop():
    observations = [
        _obs(1, (30, 30, 80, 100), color="red", complete=False),
        _obs(2, (31, 30, 81, 100), color="pink", complete=True),
        _obs(3, (30, 31, 80, 101), color="orange", complete=True),
        _obs(4, (29, 30, 79, 100), color="orange", complete=False),
    ]
    instance = FusedInstance(observations, observations[1])

    assert consensus_color(instance).name == "orange"


def test_unconfirmed_singleton_requires_two_contradicting_views_to_remove():
    observation = _obs(1, (30, 30, 60, 60), color="dark gray")
    instance = FusedInstance([observation], observation)
    full = np.ones((100, 100), dtype=np.uint8) * 255
    empty = np.zeros_like(full)
    image = np.full((100, 100, 3), 220, dtype=np.uint8)

    covered_views = [
        RectifiedView(1, 1, image, full, 1.0),
        RectifiedView(2, 2, image, full, 1.0),
        RectifiedView(3, 3, image, full, 1.0),
    ]
    uncovered_views = [
        RectifiedView(1, 1, image, full, 1.0),
        RectifiedView(2, 2, image, empty, 1.0),
    ]

    assert filter_unconfirmed_instances([instance], covered_views) == []
    assert filter_unconfirmed_instances([instance], uncovered_views) == [instance]


def test_one_detector_miss_cannot_remove_a_singleton():
    observation = _obs(1, (30, 30, 60, 60), color="gray")
    instance = FusedInstance([observation], observation)
    full = np.ones((100, 100), dtype=np.uint8) * 255
    image = np.full((100, 100, 3), 220, dtype=np.uint8)
    views = [
        RectifiedView(1, 1, image, full, 1.0),
        RectifiedView(2, 2, image, full, 1.0),
    ]

    assert filter_unconfirmed_instances([instance], views) == [instance]


def test_three_segmentation_views_require_support_for_boundary_singleton():
    observation = _obs(
        1, (-20, 30, 15, 70), color="gray", complete=False
    )
    observation.detector = "seg"
    observation.confidence = 0.95
    instance = FusedInstance([observation], observation)
    empty = np.zeros((100, 100), dtype=np.uint8)
    image = np.full((100, 100, 3), 220, dtype=np.uint8)
    views = [
        RectifiedView(frame, frame, image, empty, 1.0)
        for frame in (1, 2, 3)
    ]

    assert filter_unconfirmed_instances([instance], views) == []


def test_three_segmentation_views_keep_strong_complete_uncovered_singleton():
    observation = _obs(1, (30, 30, 60, 60), color="red", complete=True)
    observation.detector = "seg"
    observation.confidence = 0.95
    instance = FusedInstance([observation], observation)
    empty = np.zeros((100, 100), dtype=np.uint8)
    image = np.full((100, 100, 3), 220, dtype=np.uint8)
    views = [
        RectifiedView(frame, frame, image, empty, 1.0)
        for frame in (1, 2, 3)
    ]

    assert filter_unconfirmed_instances([instance], views) == [instance]


def test_three_segmentation_views_reject_weak_complete_singleton():
    observation = _obs(1, (30, 30, 60, 60), complete=True)
    observation.detector = "seg"
    observation.confidence = 0.24
    instance = FusedInstance([observation], observation)
    empty = np.zeros((100, 100), dtype=np.uint8)
    image = np.full((100, 100, 3), 220, dtype=np.uint8)
    views = [
        RectifiedView(frame, frame, image, empty, 1.0)
        for frame in (1, 2, 3)
    ]

    assert filter_unconfirmed_instances([instance], views) == []


def test_boundary_only_segmentation_needs_majority_view_support():
    observations = [
        _obs(frame, (30, 30, 60, 60), complete=False)
        for frame in (1, 2)
    ]
    for observation in observations:
        observation.detector = "seg"
        observation.confidence = 0.95
    instance = FusedInstance(observations, observations[0])
    empty = np.zeros((100, 100), dtype=np.uint8)
    image = np.full((100, 100, 3), 220, dtype=np.uint8)
    views = [
        RectifiedView(frame, frame, image, empty, 1.0)
        for frame in (1, 2, 3, 4)
    ]

    assert filter_unconfirmed_instances([instance], views) == []


def test_mosaic_contains_one_intact_selected_object_without_source_ghost():
    first = np.full((100, 120, 3), 220, dtype=np.uint8)
    second = np.full((100, 120, 3), 235, dtype=np.uint8)
    first[30:60, 20:50] = (9, 26, 201)
    second[30:60, 40:70] = (9, 26, 201)
    valid = np.ones((100, 120), dtype=np.uint8) * 255
    views = [
        RectifiedView(1, 0, first, valid, 2.0),
        RectifiedView(2, 1, second, valid, 1.0),
    ]
    first_obs = _obs(1, (20, 30, 50, 60), quality=2.0)
    first_obs.view_index = 0
    first_obs.image = first
    first_obs.valid_mask = valid
    second_obs = _obs(2, (40, 30, 70, 60), quality=1.0)
    second_obs.view_index = 1
    second_obs.image = second
    second_obs.valid_mask = valid
    instance = FusedInstance([first_obs, second_obs], first_obs)

    mosaic = compose_object_aware_mosaic(views, [instance])

    red = ((mosaic[..., 2] > 150) & (mosaic[..., 1] < 80)).astype(np.uint8)
    count, _ = __import__("cv2").connectedComponents(red)
    assert count - 1 == 1
    assert red[30:60, 20:50].mean() > 0.95
    assert red[30:60, 40:70].mean() < 0.40


def test_mosaic_keeps_clean_base_background_without_box_shaped_patches():
    first = np.full((100, 120, 3), 220, dtype=np.uint8)
    second = np.full((100, 120, 3), 235, dtype=np.uint8)
    first[30:60, 20:50] = (9, 26, 201)
    second[30:60, 40:70] = (9, 26, 201)
    valid = np.ones((100, 120), dtype=np.uint8) * 255
    views = [
        RectifiedView(1, 0, first, valid, 2.0),
        RectifiedView(2, 1, second, valid, 1.0),
    ]
    first_obs = _obs(1, (20, 30, 50, 60), quality=2.0)
    first_obs.view_index = 0
    first_obs.image = first
    first_obs.valid_mask = valid
    second_obs = _obs(2, (40, 30, 70, 60), quality=1.0)
    second_obs.view_index = 1
    second_obs.image = second
    second_obs.valid_mask = valid
    instance = FusedInstance([first_obs, second_obs], first_obs)

    mosaic = compose_object_aware_mosaic(views, [instance])

    assert np.allclose(mosaic[25, 15], mosaic[25, 75], atol=2)
