from types import SimpleNamespace

import cv2
import numpy as np
import pytest

from pipeline.footprint import (
    SilhouetteMeasurement,
    aggregate_measurements,
    measure_observation,
)


def _observation(polygons=(), *, frame_id=1, mask_canvas=None):
    return SimpleNamespace(
        frame_id=frame_id,
        polygons_canvas=polygons,
        mask_canvas=mask_canvas,
        confidence=0.9,
        complete=True,
        gate_provenance={"boundary_zone": False},
    )


def _measurement(frame_id, short_mm, long_mm):
    return SilhouetteMeasurement(
        frame_id=frame_id,
        short_mm=short_mm,
        long_mm=long_mm,
        usable=True,
        reason="measured",
        confidence=0.9,
        boundary_zone=False,
        topdownness=0.9,
    )


def test_rotated_unclipped_polygon_converts_to_mm():
    polygon = cv2.boxPoints(((250, 180), (199.6, 39.6), 27))
    observation = _observation(
        (polygon,), mask_canvas=np.zeros((20, 20), dtype=np.uint8)
    )

    measured = measure_observation(observation, px_per_m=2000.0)

    assert measured.usable
    assert measured.short_mm == pytest.approx(19.8, abs=0.3)
    assert measured.long_mm == pytest.approx(99.8, abs=0.3)


def test_measurement_does_not_fall_back_to_clipped_raster_mask():
    clipped_mask = np.ones((100, 100), dtype=np.uint8)

    measured = measure_observation(
        _observation((), mask_canvas=clipped_mask), px_per_m=1000.0
    )

    assert not measured.usable
    assert measured.short_mm is None
    assert measured.reason == "no segmentation polygons"


def test_aggregate_rejects_one_distorted_view():
    result = aggregate_measurements([
        _measurement(1, 19.0, 99.0),
        _measurement(2, 20.0, 100.0),
        _measurement(3, 41.0, 99.0),
    ])

    assert result.reliability == "high"
    assert result.short_mm == pytest.approx(19.5)
    assert result.long_mm == pytest.approx(99.5)
    assert result.used_frame_ids == (1, 2)
    assert result.rejected_frame_ids == (3,)


def test_single_view_is_low_reliability_and_cannot_be_high():
    result = aggregate_measurements([_measurement(7, 18.0, 30.0)])

    assert result.reliability == "low"
    assert result.used_frame_ids == (7,)


def test_high_spread_two_view_measurement_is_low_reliability():
    result = aggregate_measurements([
        _measurement(1, 14.0, 64.0),
        _measurement(2, 43.0, 66.0),
    ])

    assert result.reliability == "low"
    assert "spread" in result.reason


def test_no_usable_measurements_is_unavailable():
    unusable = SilhouetteMeasurement(
        frame_id=1,
        short_mm=None,
        long_mm=None,
        usable=False,
        reason="no segmentation polygons",
        confidence=None,
        boundary_zone=False,
        topdownness=None,
    )

    result = aggregate_measurements([unusable])

    assert result.reliability == "unavailable"
    assert result.short_mm is None
