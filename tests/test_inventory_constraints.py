import csv

import pytest

from pipeline.inventory_constraints import InventoryCatalog


def _write_inventory(path, rows):
    with path.open("w", newline="") as stream:
        writer = csv.DictWriter(
            stream, fieldnames=["piece_type", "color", "quantity"]
        )
        writer.writeheader()
        writer.writerows(rows)


def test_catalog_reranks_disallowed_slope_to_allowed_plate(tmp_path):
    path = tmp_path / "inventory.csv"
    _write_inventory(path, [{
        "piece_type": "Plate 2 x 2", "color": "red", "quantity": "3",
    }])

    catalog = InventoryCatalog.load(path)
    resolved = catalog.resolve(
        {"part_id": "3039", "name": "Slope 45 2 x 2", "score": 0.91},
        {"candidates": [
            {"part_id": "3039", "name": "Slope 45 2 x 2", "score": 0.91},
            {"part_id": "3022", "name": "Plate 2 x 2", "score": 0.84},
        ]},
    )

    assert resolved == {
        "part_id": "3022", "name": "Plate 2 x 2", "score": 0.84,
    }


def test_catalog_returns_none_when_no_inventory_candidate_exists(tmp_path):
    path = tmp_path / "inventory.csv"
    _write_inventory(path, [{
        "piece_type": "Brick 2 x 2", "color": "blue", "quantity": "3",
    }])
    catalog = InventoryCatalog.load(path)

    assert catalog.resolve(
        {"part_id": "3039", "name": "Slope 45 2 x 2", "score": 0.91},
        {"candidates": []},
    ) is None


def test_catalog_normalizes_names_and_aggregates_quantities(tmp_path):
    path = tmp_path / "inventory.csv"
    _write_inventory(path, [
        {"piece_type": "Brick 2 x 4", "color": "red", "quantity": "2"},
        {"piece_type": "Brick  2  x  4", "color": "blue", "quantity": "5"},
    ])

    catalog = InventoryCatalog.load(path)

    assert catalog.allowed_names == ("Brick 2 x 4",)
    assert catalog.quantity_for(" brick  2 X 4 ") == 7
    assert catalog.canonical_name("brick 2 x 4") == "Brick 2 x 4"


@pytest.mark.parametrize(
    "contents, message",
    [
        ("piece_type,color\nBrick 2 x 4,red\n", "quantity"),
        ("piece_type,color,quantity\nBrick 2 x 4,red,0\n", "positive"),
        ("piece_type,color,quantity\nBrick 2 x 4,red,many\n", "integer"),
    ],
)
def test_catalog_rejects_malformed_inventory(tmp_path, contents, message):
    path = tmp_path / "inventory.csv"
    path.write_text(contents)

    with pytest.raises(ValueError, match=message):
        InventoryCatalog.load(path)
