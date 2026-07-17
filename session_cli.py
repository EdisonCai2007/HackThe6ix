"""Scan a Record3D multi-view session into one fused LEGO inventory.

Usage: python session_cli.py /path/to/session [--detector cv]

Outputs in the session dir: inventory.json, topdown.jpg (box-free coverage
preview), multiview_result.json (instances + id-crop provenance), and debug/:
crop_gallery.jpg (each fused piece's identification crop, cut from the
ORIGINAL frame, with its Brickognize label) and frame_<id>_overlay.jpg
(fused boxes projected onto each original source frame).
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import cv2
import numpy as np

from pipeline.multiview import consensus_color, scan_manifest
from pipeline.original_crop import original_box

GALLERY_TILE_H = 180
GALLERY_PAD = 8


def _manifest_path(value: str) -> Path:
    path = Path(value)
    return path / "multiview" / "manifest.json" if path.is_dir() else path


def crop_gallery(crops, labels, id_crops) -> np.ndarray:
    """One tile per fused piece: identification crop + label + provenance."""
    tiles = []
    for crop, label, prov in zip(crops, labels, id_crops):
        if crop.size == 0:
            crop = np.zeros((8, 8, 3), dtype=np.uint8)
        scale = GALLERY_TILE_H / crop.shape[0]
        tile = cv2.resize(
            crop, (max(1, int(crop.shape[1] * scale)), GALLERY_TILE_H)
        )
        caption = f"{label}  [f{prov['frame_id']}|{prov['source']}]"
        width = max(tile.shape[1], 8 * len(caption) + 10)
        canvas = np.full((GALLERY_TILE_H + 24, width, 3), 32, dtype=np.uint8)
        canvas[:GALLERY_TILE_H, :tile.shape[1]] = tile
        cv2.putText(canvas, caption, (4, GALLERY_TILE_H + 16),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.42, (255, 255, 255), 1,
                    cv2.LINE_AA)
        tiles.append(canvas)
    if not tiles:
        return np.zeros((32, 32, 3), dtype=np.uint8)
    height = max(tile.shape[0] for tile in tiles)
    total = sum(tile.shape[1] + GALLERY_PAD for tile in tiles) - GALLERY_PAD
    gallery = np.full((height, total, 3), 32, dtype=np.uint8)
    x = 0
    for tile in tiles:
        gallery[:tile.shape[0], x:x + tile.shape[1]] = tile
        x += tile.shape[1] + GALLERY_PAD
    return gallery


def frame_overlays(result, session_dir: Path, debug_dir: Path) -> list[Path]:
    """Project all fused boxes onto each original source frame (v2 views)."""
    written = []
    for view in result.views:
        if view.homography is None or view.rgb is None:
            continue
        original = cv2.imread(str(session_dir / view.rgb))
        if original is None:
            continue
        for index, instance in enumerate(result.instances):
            box = original_box(instance.best.box, view.homography,
                               original.shape[:2], view.raise_uv_per_cm,
                               pad_frac=0.0, raise_cm=0.0)
            is_best = instance.best.view_index == view.view_index
            color = (0, 220, 0) if is_best else (0, 170, 255)
            cv2.rectangle(original, box[:2], box[2:], color, 2)
            cv2.putText(original, f"#{index}", (box[0] + 3, box[1] + 22),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.7, color, 2, cv2.LINE_AA)
        path = debug_dir / f"frame_{view.frame_id:05d}_overlay.jpg"
        cv2.imwrite(str(path), original, [cv2.IMWRITE_JPEG_QUALITY, 90])
        written.append(path)
    return written


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("session_or_manifest")
    parser.add_argument("--detector", default="auto",
                        choices=["auto", "yolo", "cv"])
    args = parser.parse_args(argv)
    manifest_path = _manifest_path(args.session_or_manifest)
    if not manifest_path.exists():
        raise SystemExit(
            f"missing {manifest_path}; run lego-capture/multiview.py first"
        )
    manifest = json.loads(manifest_path.read_text())
    session_dir = Path(manifest["session_dir"])
    result = scan_manifest(
        manifest_path, detector=args.detector,
        cache_dir=Path(".cache"),
    )
    (session_dir / "inventory.json").write_text(
        json.dumps(result.inventory, indent=2) + "\n"
    )
    # Coverage preview only — final boxes are never drawn on the mosaic.
    cv2.imwrite(str(session_dir / "topdown.jpg"), result.mosaic,
                [cv2.IMWRITE_JPEG_QUALITY, 95])

    debug_dir = session_dir / "debug"
    debug_dir.mkdir(exist_ok=True)
    gallery = crop_gallery(result.crops, result.labels, result.id_crops)
    cv2.imwrite(str(debug_dir / "crop_gallery.jpg"), gallery,
                [cv2.IMWRITE_JPEG_QUALITY, 92])
    overlays = frame_overlays(result, session_dir, debug_dir)

    details = {
        "manifest": str(manifest_path.resolve()),
        "instance_count": len(result.instances),
        "partial_count": sum(not instance.best.complete
                             for instance in result.instances),
        "selected_coverage": result.manifest["selected_coverage"],
        "union_coverage": result.manifest["union_coverage"],
        "instances": [
            {
                "box": list(instance.best.box),
                "color": consensus_color(instance).name,
                "best_frame_id": instance.best.frame_id,
                "complete": instance.best.complete,
                "observation_frames": [observation.frame_id
                                       for observation in instance.observations],
                "id_crop": id_crop,
            }
            for instance, id_crop in zip(result.instances, result.id_crops)
        ],
    }
    (session_dir / "multiview_result.json").write_text(
        json.dumps(details, indent=2) + "\n"
    )
    print(
        f"{len(result.instances)} fused pieces from "
        f"{len(result.manifest['views'])} views -> {session_dir}"
    )
    print(
        f"usable RGB coverage: {100 * result.manifest['selected_coverage']:.1f}% "
        f"({100 * result.manifest['union_coverage']:.1f}% recorded union)"
    )
    print(f"debug: {debug_dir / 'crop_gallery.jpg'} + "
          f"{len(overlays)} frame overlay(s)")
    if details["partial_count"]:
        print(f"warning: {details['partial_count']} piece(s) only partially observed")


if __name__ == "__main__":
    main()
