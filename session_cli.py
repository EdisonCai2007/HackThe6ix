"""Scan a Record3D multi-view session into one fused LEGO inventory.

Usage: python session_cli.py /path/to/session [--detector cv]
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import cv2

from pipeline.inventory import draw_debug
from pipeline.multiview import scan_manifest


def _manifest_path(value: str) -> Path:
    path = Path(value)
    return path / "multiview" / "manifest.json" if path.is_dir() else path


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
    cv2.imwrite(str(session_dir / "topdown.jpg"), result.mosaic,
                [cv2.IMWRITE_JPEG_QUALITY, 95])
    boxes = [instance.best.box for instance in result.instances]
    debug = draw_debug(result.mosaic, boxes, result.labels, [])
    cv2.imwrite(str(session_dir / "debug.jpg"), debug,
                [cv2.IMWRITE_JPEG_QUALITY, 95])
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
                "color": instance.best.color.name,
                "best_frame_id": instance.best.frame_id,
                "complete": instance.best.complete,
                "observation_frames": [observation.frame_id
                                       for observation in instance.observations],
            }
            for instance in result.instances
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
    if details["partial_count"]:
        print(f"warning: {details['partial_count']} piece(s) only partially observed")


if __name__ == "__main__":
    main()
