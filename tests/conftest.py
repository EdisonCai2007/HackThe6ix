import numpy as np
import pytest


@pytest.fixture
def solid_crop():
    """Factory for a solid-color square crop in BGR (OpenCV order)."""

    def make(bgr: tuple[int, int, int], size: int = 64) -> np.ndarray:
        return np.full((size, size, 3), bgr, dtype=np.uint8)

    return make
