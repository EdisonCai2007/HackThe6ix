"""Scan a photo of spread-out LEGO pieces into an inventory JSON.

Usage:
    python cli.py photo.jpg -o inventory.json --debug [--detector auto|yolo|cv]

--debug writes debug.jpg (annotated boxes) next to the output JSON.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import cv2

from pipeline.inventory import draw_debug
from pipeline.scan import scan_image


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("photo")
    parser.add_argument("-o", "--output", default="inventory.json")
    parser.add_argument("--debug", action="store_true",
                        help="write annotated debug.jpg next to the output")
    parser.add_argument("--detector", default="auto", choices=["auto", "yolo", "cv"])
    args = parser.parse_args(argv)

    img = cv2.imread(args.photo)
    if img is None:
        raise SystemExit(f"could not read image: {args.photo}")

    result = scan_image(img, detector=args.detector)

    out = Path(args.output)
    out.write_text(json.dumps(result.inventory, indent=2) + "\n")
    total = sum(e["quantity"] for e in result.inventory)
    print(f"{total} pieces ({len(result.inventory)} kinds) -> {out}")
    if result.clusters:
        print(f"WARNING: {len(result.clusters)} cluster(s) of touching pieces "
              "skipped — separate them and re-scan")

    if args.debug:
        debug_path = out.parent / "debug.jpg"
        cv2.imwrite(
            str(debug_path),
            draw_debug(img, result.boxes, result.labels, result.clusters),
        )
        print(f"debug overlay -> {debug_path}")


if __name__ == "__main__":
    main()
