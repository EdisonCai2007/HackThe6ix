import json

import cv2
import numpy as np

import pipeline.multiview
import session_cli
from pipeline.identify import Identification


def test_auto_falls_back_to_cv_without_segmentation_weights(tmp_path):
    assert session_cli.resolve_detector(
        "auto", model_path=tmp_path / "missing.pt"
    ) == "cv"


def test_auto_prefers_installed_segmentation_weights(tmp_path):
    weights = tmp_path / "lego_seg.pt"
    weights.write_bytes(b"fixture")

    assert session_cli.resolve_detector("auto", model_path=weights) == "seg"


def _write_manifest(session):
    output = session / "multiview"
    output.mkdir(parents=True)
    valid = np.ones((600, 800), dtype=np.uint8) * 255
    views = []
    for frame_id, offset in [(1, 0), (2, 3)]:
        image = np.full((600, 800, 3), 245, dtype=np.uint8)
        image[180:280, 250 + offset:370 + offset] = (9, 26, 201)
        image_path = output / f"view_{frame_id:05d}.jpg"
        mask_path = output / f"view_{frame_id:05d}.mask.png"
        cv2.imwrite(str(image_path), image)
        cv2.imwrite(str(mask_path), valid)
        views.append({
            "frame_id": frame_id,
            "quality": float(3 - frame_id),
            "image": str(image_path.relative_to(session)),
            "mask": str(mask_path.relative_to(session)),
            "size_wh": [800, 600],
        })
    manifest = {
        "version": 1,
        "session_dir": str(session),
        "px_per_m": 1000.0,
        "origin_xy": [0.0, 0.0],
        "size_wh": [800, 600],
        "edge_margin_px": 8,
        "union_coverage": 1.0,
        "selected_coverage": 1.0,
        "views": views,
    }
    path = output / "manifest.json"
    path.write_text(json.dumps(manifest))
    return path


def test_session_cli_identifies_one_best_crop_and_writes_outputs(
    tmp_path, monkeypatch
):
    session = tmp_path / "session"
    manifest = _write_manifest(session)
    calls = []

    def fake_identify(crops, **kwargs):
        calls.extend(crops)
        return [
            Identification("3003", "Brick 2 x 2", "Bricks", 0.9)
            for _ in crops
        ]

    monkeypatch.setattr(pipeline.multiview, "identify_all", fake_identify)

    session_cli.main([str(manifest), "--detector", "cv"])

    inventory = json.loads((session / "inventory.json").read_text())
    assert sum(item["quantity"] for item in inventory) == 1
    assert len(calls) == 1
    assert (session / "topdown.jpg").exists()
    # Boxes are never drawn on the mosaic; debug moved to debug/.
    assert not (session / "debug.jpg").exists()
    assert (session / "debug" / "crop_gallery.jpg").exists()
    result = json.loads((session / "multiview_result.json").read_text())
    assert result["instance_count"] == 1
    assert result["instances"][0]["id_crop"]["source"] == "rectified-fallback"
    color_evidence = result["instances"][0]["color_evidence"]
    assert color_evidence["strategy"] == "quality_weighted_gated_scores"
    assert color_evidence["predicted_color"] == "red"
    assert color_evidence["vote_counts"] == {"red": 2}
    assert [row["frame_id"] for row in color_evidence["observations"]] == [1, 2]
    assert all(
        len(row["top_palette_matches"]) == 3
        for row in color_evidence["observations"]
    )
    assert all("correction" in row for row in color_evidence["observations"])
    assert all("decision" in row for row in color_evidence["observations"])
    assert all(
        row["aggregation_weight"] > 0
        for row in color_evidence["observations"]
    )
    assert set(result["timings_s"]) == {
        "load", "detect", "fuse", "identify", "evidence",
        "color_inventory", "total",
    }
    assert all(value >= 0 for value in result["timings_s"].values())
    assert result["timings_s"]["total"] >= max(
        value for key, value in result["timings_s"].items() if key != "total"
    )


def test_session_cli_writes_frame_overlays_for_v2(tmp_path, monkeypatch):
    from tests.test_multiview_bridge import _write_session

    session = tmp_path / "session"
    manifest = _write_session(session, with_bridge=True)

    def fake_identify(crops, **kwargs):
        return [Identification("3001", "Brick 2 x 4", "Bricks", 0.9)
                for _ in crops]

    monkeypatch.setattr(pipeline.multiview, "identify_all", fake_identify)
    session_cli.main([str(manifest), "--detector", "cv"])

    assert (session / "debug" / "crop_gallery.jpg").exists()
    assert (session / "debug" / "frame_00001_overlay.jpg").exists()
    result = json.loads((session / "multiview_result.json").read_text())
    id_crop = result["instances"][0]["id_crop"]
    assert id_crop["source"] == "original-masked"
    assert id_crop["rgb"] == "frames/00001.rgb.jpg"
    assert id_crop["brickognize"]["part_id"] == "3001"


def test_analysis_dir_keeps_model_fit_outputs_run_scoped(tmp_path, monkeypatch):
    session = tmp_path / "session"
    manifest = _write_manifest(session)
    analysis = tmp_path / "diagnostic-run"
    (session / "inventory.json").write_text("preserved-session-output\n")
    monkeypatch.setattr(
        pipeline.multiview,
        "identify_all",
        lambda crops, **kwargs: [
            Identification("3003", "Brick 2 x 2", "Bricks", 0.9)
            for _ in crops
        ],
    )

    session_cli.main([
        str(manifest), "--detector", "cv", "--analysis-dir", str(analysis)
    ])

    assert (analysis / "model_fit.json").exists()
    assert (analysis / "inventory.json").exists()
    assert (analysis / "multiview_result.json").exists()
    assert (analysis / "debug" / "crop_gallery.jpg").exists()
    assert (session / "inventory.json").read_text() == "preserved-session-output\n"
    assert not (session / "analysis" / "model_fit.json").exists()


def test_color_worksheet_is_run_scoped_without_running_model_fit(
    tmp_path, monkeypatch
):
    session = tmp_path / "session"
    manifest = _write_manifest(session)
    analysis = tmp_path / "color-evidence-run"
    monkeypatch.setattr(
        pipeline.multiview,
        "identify_all",
        lambda crops, **kwargs: [
            Identification("3003", "Brick 2 x 2", "Bricks", 0.9)
            for _ in crops
        ],
    )

    session_cli.main([
        str(manifest), "--detector", "cv", "--analysis-dir", str(analysis),
        "--color-worksheet",
    ])

    worksheet = analysis / "color-labels" / "color_worksheet.csv"
    assert worksheet.exists()
    assert "truth_color" in worksheet.read_text().splitlines()[0]
    assert (analysis / "color-labels" / "color_worksheet.md").exists()
    assert (analysis / "color-labels" / "thumbnails" / "piece-000.jpg").exists()
    assert not (analysis / "model_fit.json").exists()
    assert not (session / "color-labels").exists()


def test_seg_debug_writes_workspace_and_gate_overlays(tmp_path, monkeypatch):
    import pipeline.segdetect
    from tests.test_segdetect import _FakeModel, _write_v3_fixture

    manifest = _write_v3_fixture(tmp_path)
    path = tmp_path / "session/multiview/manifest.json"
    path.write_text(json.dumps(manifest))
    monkeypatch.setattr(
        pipeline.segdetect, "YoloSegModel", lambda **kwargs: _FakeModel()
    )
    monkeypatch.setattr(
        pipeline.multiview, "identify_all",
        lambda crops, **kwargs: [
            Identification("3001", "Brick 2 x 4", "Bricks", 0.9)
            for _ in crops
        ],
    )
    from pipeline.studs import StudEvidence
    monkeypatch.setattr(
        pipeline.multiview,
        "analyze_studs",
        lambda *args, **kwargs: StudEvidence(
            0, "low", "not_visible", False, 200.0, (), "fixture"
        ),
    )

    session_cli.main([str(path), "--detector", "seg"])

    debug = tmp_path / "session/debug"
    assert (debug / "frame_00001_seg_gate.jpg").exists()
    result = json.loads(
        (tmp_path / "session/multiview_result.json").read_text()
    )
    assert result["detector"] == "seg"
    assert result["segmentation"]["accepted"] == 1
    assert result["segmentation"]["rejected"] == 0
