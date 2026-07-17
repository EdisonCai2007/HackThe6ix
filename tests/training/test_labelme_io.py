import json
from pathlib import Path

import cv2
import numpy as np
import pytest

from training.labelme_io import export_labelme_bundle, import_labelme_bundle
from training.labels import parse_label_file


VALID_LABEL = "0 0.1 0.2 0.8 0.2 0.8 0.7 0.1 0.7\n"


def _fixture(root: Path):
    selected = root / "selected"
    images = selected / "images"
    labels = root / "autolabels"
    images.mkdir(parents=True)
    labels.mkdir()
    rows = []
    qa_items = []
    for index, priority in enumerate((55, 90)):
        dataset_id = f"session_{index}__f0000{index}"
        image_path = (images / f"{dataset_id}.jpg").resolve()
        image = np.full((80, 100, 3), 200 - index * 20, np.uint8)
        cv2.rectangle(image, (10, 16), (79, 55), (10, 80, 220), -1)
        assert cv2.imwrite(str(image_path), image)
        (labels / f"{dataset_id}.txt").write_text(VALID_LABEL)
        (labels / f"{dataset_id}.review.json").write_text(json.dumps({
            "status": "unverified",
            "annotation_source": "sam2.1_s.pt",
        }))
        rows.append({
            "dataset_id": dataset_id,
            "selected_image": str(image_path),
            "source_session": f"session_{index}",
            "source_frame": index,
            "source_sha256": f"hash-{index}",
            "split": "train" if index == 0 else "val",
            "environment": "wood",
        })
        qa_items.append({
            "dataset_id": dataset_id,
            "priority_score": priority,
            "touching_or_overlapping": index == 1,
            "issues": [],
        })
    manifest = selected / "manifest.jsonl"
    manifest.write_text("".join(json.dumps(row) + "\n" for row in rows))
    qa = root / "qa-report.json"
    qa.write_text(json.dumps({"items": qa_items}))
    return manifest, labels, qa


def test_export_creates_priority_ordered_lossless_labelme_bundle(tmp_path):
    manifest, labels, qa = _fixture(tmp_path)
    output = tmp_path / "review-labelme"

    bundle_manifest = export_labelme_bundle(manifest, labels, qa, output)

    exported = [json.loads(line) for line in bundle_manifest.read_text().splitlines()]
    assert [row["dataset_id"] for row in exported] == [
        "session_1__f00001", "session_0__f00000"
    ]
    first = exported[0]
    image_copy = output / "review" / first["review_image"]
    source = Path(first["selected_image"])
    assert image_copy.read_bytes() == source.read_bytes()
    labelme = json.loads(
        (output / "review" / first["review_json"]).read_text()
    )
    assert labelme["flags"] == {"reviewed": False}
    assert labelme["imageData"] is None
    assert labelme["shapes"][0]["label"] == "lego_piece"
    assert labelme["shapes"][0]["shape_type"] == "polygon"
    assert labelme["shapes"][0]["points"][0] == pytest.approx([9.9, 15.8])
    assert (output / "labels.txt").read_text() == "lego_piece\n"


def test_import_refuses_to_claim_human_review_without_explicit_confirmation(tmp_path):
    manifest, labels, qa = _fixture(tmp_path)
    bundle = tmp_path / "review-labelme"
    export_labelme_bundle(manifest, labels, qa, bundle)

    with pytest.raises(ValueError, match="explicit confirmation"):
        import_labelme_bundle(bundle, tmp_path / "verified", "Emily", False)
    with pytest.raises(ValueError, match="reviewer"):
        import_labelme_bundle(bundle, tmp_path / "verified", "", True)


def test_import_requires_every_image_review_checkbox(tmp_path):
    manifest, labels, qa = _fixture(tmp_path)
    bundle = tmp_path / "review-labelme"
    export_labelme_bundle(manifest, labels, qa, bundle)

    with pytest.raises(ValueError, match="reviewed flag"):
        import_labelme_bundle(bundle, tmp_path / "verified", "Emily", True)


def test_import_converts_corrected_polygons_and_marks_sidecars_verified(tmp_path):
    manifest, labels, qa = _fixture(tmp_path)
    bundle = tmp_path / "review-labelme"
    export_labelme_bundle(manifest, labels, qa, bundle)
    bundle_rows = [
        json.loads(line)
        for line in (bundle / "bundle-manifest.jsonl").read_text().splitlines()
    ]
    for row in bundle_rows:
        path = bundle / "review" / row["review_json"]
        data = json.loads(path.read_text())
        data["flags"]["reviewed"] = True
        path.write_text(json.dumps(data))
    first_json = bundle / "review" / bundle_rows[0]["review_json"]
    edited = json.loads(first_json.read_text())
    edited["shapes"] = [{
        "label": "lego_piece",
        "points": [[20, 20], [70, 20], [70, 60], [20, 60]],
        "group_id": 1,
        "shape_type": "polygon",
        "flags": {},
    }]
    first_json.write_text(json.dumps(edited))

    report_path = import_labelme_bundle(
        bundle, tmp_path / "verified", "Emily", True
    )

    report = json.loads(report_path.read_text())
    assert report["summary"] == {"images": 2, "instances": 2}
    label_path = tmp_path / "verified" / f"{bundle_rows[0]['dataset_id']}.txt"
    instances = parse_label_file(label_path)
    assert instances[0].points[0] == pytest.approx((20 / 99, 20 / 79))
    sidecar = json.loads(label_path.with_suffix(".review.json").read_text())
    assert sidecar["status"] == "verified"
    assert sidecar["reviewer"] == "Emily"
    assert sidecar["annotation_source"] == "sam2.1_s.pt+human_labelme"
    assert sidecar["source_session"] == "session_1"


@pytest.mark.parametrize(
    ("change", "message"),
    [
        ({"label": "brick"}, "only lego_piece"),
        ({"shape_type": "rectangle"}, "must be a polygon"),
        ({"points": [[1, 1], [2, 2]]}, "at least three"),
    ],
)
def test_import_rejects_invalid_labelme_shapes_without_partial_output(
    tmp_path, change, message
):
    manifest, labels, qa = _fixture(tmp_path)
    bundle = tmp_path / "review-labelme"
    export_labelme_bundle(manifest, labels, qa, bundle)
    for row in [
        json.loads(line)
        for line in (bundle / "bundle-manifest.jsonl").read_text().splitlines()
    ]:
        path = bundle / "review" / row["review_json"]
        data = json.loads(path.read_text())
        data["flags"]["reviewed"] = True
        path.write_text(json.dumps(data))
    first = json.loads((bundle / "bundle-manifest.jsonl").read_text().splitlines()[0])
    json_path = bundle / "review" / first["review_json"]
    data = json.loads(json_path.read_text())
    data["shapes"][0].update(change)
    json_path.write_text(json.dumps(data))
    destination = tmp_path / "verified"

    with pytest.raises(ValueError, match=message):
        import_labelme_bundle(bundle, destination, "Emily", True)

    assert not destination.exists()


def test_import_refuses_missing_review_json(tmp_path):
    manifest, labels, qa = _fixture(tmp_path)
    bundle = tmp_path / "review-labelme"
    export_labelme_bundle(manifest, labels, qa, bundle)
    for row in [
        json.loads(line)
        for line in (bundle / "bundle-manifest.jsonl").read_text().splitlines()
    ]:
        path = bundle / "review" / row["review_json"]
        data = json.loads(path.read_text())
        data["flags"]["reviewed"] = True
        path.write_text(json.dumps(data))
    first = json.loads((bundle / "bundle-manifest.jsonl").read_text().splitlines()[0])
    (bundle / "review" / first["review_json"]).unlink()

    with pytest.raises(ValueError, match="missing reviewed JSON"):
        import_labelme_bundle(bundle, tmp_path / "verified", "Emily", True)
