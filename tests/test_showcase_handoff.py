import json

import pytest

from pipeline.showcase_handoff import write_showcase_handoff
from training.inventory_review import new_review_document


def _document():
    document = new_review_document("scan-1", 1, [{
        "component_id": "showcase-000",
        "prediction": {
            "part_id": "3022", "part_name": "Plate 2 x 2",
            "color": "red", "score": 0.91,
        },
    }])
    document.update({
        "showcase_only": True,
        "fixed_inventory": "/demo/inventory.csv",
        "generator_url": "http://127.0.0.1:9000/build",
    })
    return document


def test_handoff_requires_every_showcase_piece_to_be_confirmed(tmp_path):
    with pytest.raises(ValueError, match="confirm every showcase piece"):
        write_showcase_handoff(tmp_path / "review.json", _document())


def test_handoff_matches_existing_browser_schema(tmp_path):
    document = _document()
    document["components"][0]["review"].update({
        "confirmed": True,
        "part_id": "3022",
        "part_name": "Plate 2 x 2",
        "color": "red",
        "segmentation": "correct",
    })

    result = write_showcase_handoff(tmp_path / "review.json", document)

    payload = json.loads((tmp_path / "handoff.json").read_text())
    assert payload == {
        "schema_version": 1,
        "session_id": "scan-1",
        "fixed_inventory": "/demo/inventory.csv",
        "confirmed_pieces": [{
            "component_id": "showcase-000",
            "part_id": "3022",
            "part_name": "Plate 2 x 2",
            "color": "red",
            "accepted_prediction": True,
        }],
    }
    assert result == {
        "handoff_path": str(tmp_path / "handoff.json"),
        "generator_url": "http://127.0.0.1:9000/build",
    }


def test_handoff_rejects_confirmed_type_outside_document_inventory(tmp_path):
    document = _document()
    document["inventory_piece_types"] = ["Plate 2 x 2"]
    document["components"][0]["review"].update({
        "confirmed": True,
        "part_id": "3039",
        "part_name": "Slope 45 2 x 2",
        "segmentation": "correct",
    })

    with pytest.raises(ValueError, match="not present in the inventory"):
        write_showcase_handoff(tmp_path / "review.json", document)
