import json

import pytest
import requests

from pipeline import identify
from pipeline.identify import Identification, identify_all, identify_crop

BRICK_RESP = {
    "items": [
        {"id": "3001", "name": "Brick 2 x 4", "category": "Bricks",
         "type": "part", "score": 0.93,
         "img_url": "https://example.test/parts/3001.webp"},
        {"id": "3002", "name": "Brick 2 x 3", "category": "Bricks",
         "type": "part", "score": 0.41},
    ]
}


class FakeResponse:
    def __init__(self, payload=None, status_code=200):
        self._payload = payload
        self.status_code = status_code

    def json(self):
        return self._payload

    def raise_for_status(self):
        if self.status_code >= 400:
            raise requests.HTTPError(f"{self.status_code}")


@pytest.fixture(autouse=True)
def no_sleep(monkeypatch):
    monkeypatch.setattr(identify.time, "sleep", lambda s: None)


@pytest.fixture
def crop(solid_crop):
    return solid_crop((9, 26, 201))


def mock_post(monkeypatch, side_effects):
    """side_effects: list of FakeResponse or Exception, consumed per call."""
    calls = []

    def fake_post(self, url, files=None, timeout=None):
        calls.append(url)
        effect = side_effects[min(len(calls) - 1, len(side_effects) - 1)]
        if isinstance(effect, Exception):
            raise effect
        return effect

    monkeypatch.setattr(requests.Session, "post", fake_post)
    return calls


def test_takes_top_item(monkeypatch, tmp_path, crop):
    mock_post(monkeypatch, [FakeResponse(BRICK_RESP)])
    result = identify_crop(crop, cache_dir=tmp_path)
    assert (result.part_id, result.name, result.category, result.score) == \
        ("3001", "Brick 2 x 4", "Bricks", 0.93)
    # Raw candidates ride along for downstream advisories (stud check).
    assert result.candidates[0]["part_id"] == "3001"
    assert result.candidates[0]["img_url"] == \
        "https://example.test/parts/3001.webp"


def test_low_score_discarded(monkeypatch, tmp_path, crop):
    resp = {"items": [{"id": "3001", "name": "Brick 2 x 4",
                       "category": "Bricks", "type": "part", "score": 0.42}]}
    mock_post(monkeypatch, [FakeResponse(resp)])
    result = identify_crop(crop, cache_dir=tmp_path)
    assert result.part_id is None
    assert result.name == "unknown brick"
    assert result.score == 0.42


def test_empty_items_degrades(monkeypatch, tmp_path, crop):
    mock_post(monkeypatch, [FakeResponse({"items": []})])
    result = identify_crop(crop, cache_dir=tmp_path)
    assert result.part_id is None


def test_cache_hit_skips_http(monkeypatch, tmp_path, crop):
    calls = mock_post(monkeypatch, [FakeResponse(BRICK_RESP)])
    first = identify_crop(crop, cache_dir=tmp_path)
    second = identify_crop(crop, cache_dir=tmp_path)
    assert len(calls) == 1
    assert first == second
    assert len(list(tmp_path.glob("*.json"))) == 1


def test_cache_file_is_raw_api_response(monkeypatch, tmp_path, crop):
    mock_post(monkeypatch, [FakeResponse(BRICK_RESP)])
    identify_crop(crop, cache_dir=tmp_path)
    cached = json.loads(next(tmp_path.glob("*.json")).read_text())
    assert cached == BRICK_RESP


def test_api_down_degrades_gracefully(monkeypatch, tmp_path, crop):
    mock_post(monkeypatch, [requests.ConnectionError("api down")])
    result = identify_crop(crop, cache_dir=tmp_path)
    assert result.part_id is None
    assert result.name == "unknown brick"
    assert result.score == 0.0


def test_api_failure_not_cached(monkeypatch, tmp_path, crop):
    mock_post(monkeypatch, [requests.ConnectionError("api down")])
    identify_crop(crop, cache_dir=tmp_path)
    assert list(tmp_path.glob("*.json")) == []


def test_retry_then_success(monkeypatch, tmp_path, crop):
    calls = mock_post(monkeypatch, [
        FakeResponse(status_code=503),
        FakeResponse(status_code=503),
        FakeResponse(BRICK_RESP),
    ])
    result = identify_crop(crop, cache_dir=tmp_path)
    assert result.part_id == "3001"
    assert len(calls) == 3


def test_identify_all_preserves_order(monkeypatch, tmp_path, solid_crop):
    import hashlib

    import cv2

    crops = [solid_crop((10 * i, 20, 30)) for i in range(1, 6)]
    # Precompute which upload bytes belong to which crop, so the fake's
    # answers are deterministic regardless of concurrent call order.
    expected_id = {}
    for i, c in enumerate(crops):
        _, buf = cv2.imencode(".jpg", c, [cv2.IMWRITE_JPEG_QUALITY, 95])
        expected_id[hashlib.sha1(buf.tobytes()).hexdigest()] = f"part-{i}"

    def fake_post(self, url, files=None, timeout=None):
        key = hashlib.sha1(files["query_image"][1]).hexdigest()
        return FakeResponse({"items": [{
            "id": expected_id[key], "name": "x", "category": "c",
            "type": "part", "score": 0.9}]})

    monkeypatch.setattr(requests.Session, "post", fake_post)
    results = identify_all(crops, cache_dir=tmp_path, min_interval=0.0)
    assert [r.part_id for r in results] == [f"part-{i}" for i in range(5)]
