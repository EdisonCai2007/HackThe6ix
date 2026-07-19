from types import SimpleNamespace
from pathlib import Path
import subprocess
import sys

import cv2
import numpy as np

from pipeline.fast_showcase import (
    early_exit,
    rank_showcase_indices,
    write_selected_masks,
)


def _instance(index, *, confidence=0.9, complete=True, boundary=False,
              focus=20.0, area=4000):
    side = int(area ** 0.5)
    observation = SimpleNamespace(
        confidence=confidence,
        complete=complete,
        identification_focus=focus,
        box=(index * 100, 0, index * 100 + side, side),
        gate_provenance={"boundary_zone": boundary},
    )
    return SimpleNamespace(best=observation, observations=[observation])


def test_shortlist_caps_at_twelve_and_rejects_boundary_instances():
    instances = [_instance(index) for index in range(15)]
    instances[4] = _instance(4, boundary=True)

    indices = rank_showcase_indices(instances, limit=12)

    assert len(indices) == 12
    assert 4 not in indices


def test_shortlist_prioritizes_complete_high_confidence_focused_crops():
    instances = [
        _instance(0, confidence=0.70, focus=5.0),
        _instance(1, confidence=0.95, focus=30.0),
        _instance(2, complete=False, confidence=0.99, focus=100.0),
    ]

    assert rank_showcase_indices(instances, limit=1) == [1]


def test_early_exit_stops_after_first_attempt_with_enough_safe_results():
    attempts = []

    def attempt(view_limit):
        attempts.append(view_limit)
        return {"selected_count": 3, "selected": [1, 2, 3]}

    result = early_exit(attempt, min_safe=3, max_views=3)

    assert attempts == [1]
    assert result["selected_count"] == 3


def test_early_exit_expands_until_minimum_or_view_budget():
    attempts = []

    def attempt(view_limit):
        attempts.append(view_limit)
        return {"selected_count": view_limit, "selected": list(range(view_limit))}

    result = early_exit(attempt, min_safe=3, max_views=3)

    assert attempts == [1, 3]
    assert result["selected_count"] == 3


def test_fast_showcase_cli_exposes_bounded_demo_options():
    root = Path(__file__).resolve().parents[1]
    result = subprocess.run(
        [sys.executable, str(root / "fast_showcase_cli.py"), "--help"],
        capture_output=True, text=True, check=False,
    )

    assert result.returncode == 0
    assert "--max-views" in result.stdout
    assert "--identify-limit" in result.stdout
    assert "--min-safe" in result.stdout
    assert "--workspace" in result.stdout
    assert "--fixed-inventory" in result.stdout


def test_selected_showcase_masks_are_cropped_and_referenced(tmp_path):
    mask = np.zeros((100, 140), dtype=bool)
    mask[20:70, 30:90] = True
    observation = SimpleNamespace(frame_id=7, mask_original=mask)
    result = SimpleNamespace(instances=[SimpleNamespace(
        best=observation, observations=[observation]
    )])
    payload = {"selected": [{
        "instance_id": 0,
        "best_frame_id": 7,
        "box_original": [30, 20, 90, 70],
    }]}

    write_selected_masks(result, payload, tmp_path)

    relative = payload["selected"][0]["mask"]
    written = cv2.imread(str(tmp_path / relative), cv2.IMREAD_GRAYSCALE)
    assert written.shape == (50, 60)
    assert np.all(written == 255)
