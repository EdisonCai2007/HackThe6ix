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
    reassign_confirmation_only_instances,
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


def test_consensus_color_downweights_oblique_shadowed_observation():
    observations = [
        _obs(1, (30, 30, 80, 100), color="blue"),
        _obs(2, (31, 30, 81, 100), color="blue"),
        _obs(3, (30, 31, 80, 101), color="light blue"),
    ]
    for observation, rgb, flags, tilt in zip(
        observations,
        [(0, 75, 180), (5, 70, 170), (90, 147, 219)],
        [[], [], ["possible_specular", "oblique_view"]],
        [12.0, 18.0, 52.0],
    ):
        observation.color_evidence = {
            "decision_rgb": list(rgb),
            "raw_rgb": list(rgb),
            "background": {"rgb": [175, 165, 148]},
            "decision": {"gate": "chromatic"},
            "flags": flags,
            "view_quality": {"tilt_deg": tilt},
        }
    instance = FusedInstance(observations, observations[2])

    assert consensus_color(instance).name == "blue"


def test_consensus_color_emits_ambiguity_for_dark_low_light_neutral():
    observations = [
        _obs(1, (30, 30, 80, 100), color="dark gray"),
        _obs(2, (31, 30, 81, 100), color="dark gray"),
    ]
    for observation, rgb in zip(observations, [(50, 59, 68), (45, 52, 62)]):
        observation.color_evidence = {
            "decision_rgb": list(rgb),
            "raw_rgb": list(rgb),
            "background": {"rgb": [175, 165, 148]},
            "decision": {"gate": "neutral"},
            "flags": [],
            "view_quality": {"tilt_deg": 15.0},
        }
    instance = FusedInstance(observations, observations[0])

    assert consensus_color(instance).name == "ambiguous(black/dark gray)"


def test_final_consensus_cannot_emit_dark_red():
    observation = _obs(1, (30, 30, 80, 100), color="dark red")
    observation.color_evidence = {
        "decision_rgb": list(_color("dark red").rgb),
        "raw_rgb": list(_color("dark red").rgb),
        "background": {"rgb": [175, 165, 148]},
        "decision": {"gate": "chromatic"},
        "flags": [],
        "view_quality": {"tilt_deg": 15.0},
    }

    assert consensus_color(FusedInstance([observation], observation)).name == "red"


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


def test_confirmation_only_cross_match_is_reassigned_to_coverage_anchors():
    image = np.full((100, 120, 3), 220, dtype=np.uint8)
    valid = np.full((100, 120), 255, dtype=np.uint8)
    views = [
        RectifiedView(
            frame_id=index,
            view_index=index,
            image=image,
            valid_mask=valid,
            quality=1.0,
            selection_role=("coverage" if index < 3 else "confirmation"),
        )
        for index in range(5)
    ]
    blue_top = _obs(0, (40, 40, 70, 70), color="blue")
    blue_top.view_index = 0
    blue_second = _obs(1, (41, 41, 71, 71), color="blue")
    blue_second.view_index = 1
    blue_existing_confirmation = _obs(
        4, (43, 42, 73, 72), color="blue"
    )
    blue_existing_confirmation.view_index = 4
    white_top = _obs(0, (20, 30, 48, 55), color="white")
    white_top.view_index = 0
    white_second = _obs(1, (21, 31, 49, 56), color="white")
    white_second.view_index = 1
    white_existing_confirmation = _obs(
        3, (18, 28, 52, 60), color="white"
    )
    white_existing_confirmation.view_index = 3
    orphan_blue = _obs(3, (38, 37, 74, 75), color="blue")
    orphan_blue.view_index = 3
    orphan_white = _obs(4, (16, 26, 55, 63), color="light gray")
    orphan_white.view_index = 4
    blue = FusedInstance(
        [blue_top, blue_second, blue_existing_confirmation], blue_top
    )
    white = FusedInstance(
        [white_top, white_second, white_existing_confirmation], white_top
    )
    crossed = FusedInstance([orphan_blue, orphan_white], orphan_blue)

    reassigned = reassign_confirmation_only_instances(
        [blue, white, crossed], views
    )

    assert len(reassigned) == 2
    blue_result = next(
        instance for instance in reassigned
        if instance.best.color.name == "blue"
    )
    white_result = next(
        instance for instance in reassigned
        if instance.best.color.name == "white"
    )
    assert orphan_blue in blue_result.observations
    assert orphan_white in white_result.observations
    assert len({obs.view_index for obs in blue_result.observations}) == 4
    assert len({obs.view_index for obs in white_result.observations}) == 4


def test_confirmation_only_piece_is_not_collapsed_into_one_coverage_anchor():
    image = np.full((100, 120, 3), 220, dtype=np.uint8)
    valid = np.full((100, 120), 255, dtype=np.uint8)
    views = [
        RectifiedView(
            frame_id=index,
            view_index=index,
            image=image,
            valid_mask=valid,
            quality=1.0,
            selection_role=("coverage" if index == 0 else "confirmation"),
        )
        for index in (0, 3, 4)
    ]
    anchor_obs = _obs(0, (40, 40, 70, 70), color="blue")
    anchor_obs.view_index = 0
    orphan_first = _obs(3, (41, 41, 71, 71), color="blue")
    orphan_first.view_index = 3
    orphan_second = _obs(4, (42, 42, 72, 72), color="blue")
    orphan_second.view_index = 4
    anchor = FusedInstance([anchor_obs], anchor_obs)
    genuine_piece = FusedInstance(
        [orphan_first, orphan_second], orphan_first
    )

    reassigned = reassign_confirmation_only_instances(
        [anchor, genuine_piece], views
    )

    assert len(reassigned) == 2
    assert any(
        instance.observations == [orphan_first, orphan_second]
        for instance in reassigned
    )


def test_confirmation_only_reassignment_requires_strong_geometry():
    image = np.full((120, 220, 3), 220, dtype=np.uint8)
    valid = np.full((120, 220), 255, dtype=np.uint8)
    views = [
        RectifiedView(
            frame_id=index,
            view_index=index,
            image=image,
            valid_mask=valid,
            quality=1.0,
            selection_role=("coverage" if index == 0 else "confirmation"),
        )
        for index in (0, 3, 4)
    ]
    blue_anchor_obs = _obs(0, (10, 20, 50, 60), color="blue")
    blue_anchor_obs.view_index = 0
    white_anchor_obs = _obs(0, (130, 20, 170, 60), color="white")
    white_anchor_obs.view_index = 0
    weak_blue = _obs(3, (35, 20, 75, 60), color="blue")
    weak_blue.view_index = 3
    weak_white = _obs(4, (155, 20, 195, 60), color="light gray")
    weak_white.view_index = 4
    blue_anchor = FusedInstance([blue_anchor_obs], blue_anchor_obs)
    white_anchor = FusedInstance([white_anchor_obs], white_anchor_obs)
    crossed = FusedInstance([weak_blue, weak_white], weak_blue)

    reassigned = reassign_confirmation_only_instances(
        [blue_anchor, white_anchor, crossed], views
    )

    assert len(reassigned) == 3
    assert any(instance.observations == [weak_blue, weak_white]
               for instance in reassigned)


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
