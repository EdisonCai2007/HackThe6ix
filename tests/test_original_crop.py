import numpy as np

from pipeline.original_crop import original_box


IDENTITY = np.eye(3)


def test_identity_homography_pads_box_symmetrically():
    # 60x40 box, 20% pad: +/-12 in x, +/-8 in y.
    box = (100, 100, 160, 140)
    out = original_box(box, IDENTITY, rgb_size=(1440, 1920),
                       raise_uv_per_cm=(0.0, 0.0), pad_frac=0.2)
    assert out == (88, 92, 172, 148)


def test_scale_homography_maps_corners():
    H = np.diag([2.0, 3.0, 1.0])
    out = original_box((10, 10, 20, 20), H, rgb_size=(1000, 1000),
                       raise_uv_per_cm=(0.0, 0.0), pad_frac=0.0)
    assert out == (20, 30, 40, 60)


def test_perspective_homography_takes_aabb_of_mapped_corners():
    # Perspective divide shrinks the right edge: AABB must still contain
    # every mapped corner.
    H = np.array([[1.0, 0.0, 0.0],
                  [0.0, 1.0, 0.0],
                  [0.001, 0.0, 1.0]])
    box = (0, 0, 100, 100)
    out = original_box(box, H, rgb_size=(500, 500),
                       raise_uv_per_cm=(0.0, 0.0), pad_frac=0.0)
    corners = np.array([[0, 0, 1], [100, 0, 1], [0, 100, 1], [100, 100, 1]],
                       dtype=float)
    mapped = corners @ H.T
    uv = mapped[:, :2] / mapped[:, 2:3]
    assert out[0] <= uv[:, 0].min() and out[2] >= uv[:, 0].max()
    assert out[1] <= uv[:, 1].min() and out[3] >= uv[:, 1].max()


def test_raise_bias_extends_only_toward_displacement():
    # raise (10, -20) px/cm at 1.5 cm: +15 px on the right, -30 px on top.
    out = original_box((100, 100, 160, 140), IDENTITY, rgb_size=(1440, 1920),
                       raise_uv_per_cm=(10.0, -20.0), pad_frac=0.0,
                       raise_cm=1.5)
    assert out == (100, 70, 175, 140)


def test_clamped_to_image_bounds():
    out = original_box((0, 0, 50, 50), IDENTITY, rgb_size=(100, 80),
                       raise_uv_per_cm=(0.0, 0.0), pad_frac=0.5)
    assert out == (0, 0, 75, 75)
    out2 = original_box((60, 80, 90, 110), IDENTITY, rgb_size=(100, 80),
                        raise_uv_per_cm=(50.0, 50.0), pad_frac=0.2,
                        raise_cm=2.0)
    assert out2[2] <= 80 and out2[3] <= 100
