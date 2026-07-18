import numpy as np
import pytest


def _kwargs(confidence):
    world_to_table = np.eye(4)
    world_to_table[2, 3] = 1.0
    return {
        "depth": np.full((6, 8), 0.9904, dtype=np.float32),
        "confidence": confidence,
        "mask_rgb": np.ones((6, 8), dtype=bool),
        "intrinsics": {
            "fx": 10.0, "fy": 10.0, "cx": 3.5, "cy": 2.5,
        },
        "rgb_size": [6, 8],
        "pose_mat": np.eye(4),
        "world_to_table": world_to_table,
        "frame_id": 4,
    }


def test_historical_frame_without_confidence_is_unavailable():
    from pipeline.depth_height import measure_aligned_depth

    evidence = measure_aligned_depth(**_kwargs(None))

    assert evidence.action == "shadow_only"
    assert evidence.reliability == "unavailable"
    assert "confidence" in evidence.reason


def test_confident_depth_reports_table_relative_height():
    from pipeline.depth_height import measure_aligned_depth

    evidence = measure_aligned_depth(
        **_kwargs(np.full((6, 8), 2, dtype=np.uint8))
    )

    assert evidence.action == "shadow_only"
    assert evidence.median_mm == pytest.approx(9.6, abs=0.5)
    assert evidence.p10_mm == pytest.approx(9.6, abs=0.5)
    assert evidence.p90_mm == pytest.approx(9.6, abs=0.5)
    assert evidence.usable_pixels == 48
    assert evidence.confidence_counts == {"2": 48}


def test_zero_confidence_pixels_are_rejected():
    from pipeline.depth_height import measure_aligned_depth

    confidence = np.zeros((6, 8), dtype=np.uint8)
    confidence[2:4, 3:5] = 2
    evidence = measure_aligned_depth(**_kwargs(confidence))

    assert evidence.usable_pixels == 4
    assert evidence.confidence_counts == {"2": 4}

