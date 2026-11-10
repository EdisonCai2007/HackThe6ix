"""Train a single-class LEGO detector (yolov8n) and install it as
models/lego_yolo.pt for pipeline.detect's "yolo" method.

DO NOT run casually — training takes real time (CPU: hours; Apple Silicon
via --device mps: tens of minutes; CUDA GPU: minutes).

Dataset: any YOLO-format detection dataset with a data.yaml (single "lego"
class recommended). Roboflow Universe has several; export as
"YOLOv8" format, e.g. from a project like lego-brick-object-detection-40:

    pip install roboflow
    python scripts/train_yolo.py --roboflow-key YOUR_KEY \
        --roboflow-project research-g0ycu/lego-brick-object-detection-40/1

or with a local dataset:

    python scripts/train_yolo.py --data path/to/data.yaml --device mps
"""
from __future__ import annotations

import argparse
import shutil
from pathlib import Path


def download_roboflow(key: str, project: str) -> Path:
    from roboflow import Roboflow  # optional dep, only for this path

    workspace, name, version = project.split("/")
    rf = Roboflow(api_key=key)
    dataset = rf.workspace(workspace).project(name).version(int(version))
    loc = dataset.download("yolov8")
    return Path(loc.location) / "data.yaml"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--data", help="path to YOLO data.yaml")
    parser.add_argument("--roboflow-key", help="Roboflow API key")
    parser.add_argument(
        "--roboflow-project",
        help="workspace/project/version to download (YOLOv8 export)",
    )
    parser.add_argument("--epochs", type=int, default=30)
    parser.add_argument("--imgsz", type=int, default=640)
    parser.add_argument(
        "--device", default="cpu", help='"cpu", "mps" (Apple Silicon), or "0" (CUDA)'
    )
    args = parser.parse_args()

    if args.roboflow_key and args.roboflow_project:
        data_yaml = download_roboflow(args.roboflow_key, args.roboflow_project)
    elif args.data:
        data_yaml = Path(args.data)
    else:
        parser.error("need --data or (--roboflow-key and --roboflow-project)")

    from ultralytics import YOLO

    model = YOLO("yolov8n.pt")  # downloads COCO-pretrained base on first run
    results = model.train(
        data=str(data_yaml),
        epochs=args.epochs,
        imgsz=args.imgsz,
        device=args.device,
        project="runs",
        name="lego",
    )
    best = Path(results.save_dir) / "weights" / "best.pt"
    dest = Path("models/lego_yolo.pt")
    dest.parent.mkdir(exist_ok=True)
    shutil.copy(best, dest)
    print(f"installed {best} -> {dest}")


if __name__ == "__main__":
    main()
