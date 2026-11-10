"""Reproducible local-MPS training for the verified LEGO segmenter dataset."""
from __future__ import annotations

import argparse
import csv
import hashlib
import json
import math
import platform
import shutil
import time
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import yaml


@dataclass(frozen=True)
class TrainingConfig:
    data: str
    mode: str
    model: str = "yolo11n-seg.pt"
    device: str = "mps"
    epochs: int = 3
    fraction: float = 0.25
    imgsz: int = 640
    batch: int = 4
    workers: int = 0
    seed: int = 17
    patience: int = 0
    project: str = "training/runs/segment"

    @classmethod
    def smoke(cls, data: str | Path) -> "TrainingConfig":
        return cls(data=str(data), mode="smoke")

    @classmethod
    def full(cls, data: str | Path) -> "TrainingConfig":
        return cls(
            data=str(data), mode="full", epochs=100, fraction=1.0,
            batch=4, patience=20,
        )


def _read_yaml(path: Path) -> dict:
    try:
        data = yaml.safe_load(path.read_text())
    except (OSError, yaml.YAMLError) as exc:
        raise ValueError(f"invalid dataset YAML: {path}") from exc
    if not isinstance(data, dict):
        raise ValueError(f"invalid dataset YAML: {path}")
    return data


def verified_dataset_preflight(data_yaml: str | Path) -> dict:
    data_yaml = Path(data_yaml).resolve()
    data = _read_yaml(data_yaml)
    root = Path(data.get("path", data_yaml.parent)).resolve()
    metadata_path = root / "dataset-metadata.json"
    if not metadata_path.exists():
        raise ValueError(f"missing verified dataset metadata: {metadata_path}")
    try:
        metadata = json.loads(metadata_path.read_text())
    except (OSError, json.JSONDecodeError) as exc:
        raise ValueError(f"invalid dataset metadata: {metadata_path}") from exc
    if metadata.get("require_verified") is not True:
        raise ValueError("training requires a verified-label dataset")
    if metadata.get("class_names") != ["lego_piece"]:
        raise ValueError("training dataset must contain only class lego_piece")
    names = data.get("names")
    if names not in ({0: "lego_piece"}, {"0": "lego_piece"}):
        raise ValueError("data.yaml must define only class 0 lego_piece")
    dataset_hash = metadata.get("dataset_sha256", "")
    if len(dataset_hash) != 64 or not root.name.endswith(dataset_hash[:12]):
        raise ValueError("dataset path does not match its content hash")
    counts = metadata.get("counts", {})
    if counts.get("train", 0) <= 0 or counts.get("val", 0) <= 0:
        raise ValueError("verified dataset needs non-empty train and val splits")
    sessions = metadata.get("sessions_by_split", {})
    membership: dict[str, set[str]] = {
        split: set(sessions.get(split, []))
        for split in ("train", "val", "test")
    }
    leaks = {
        f"{left}/{right}": sorted(membership[left] & membership[right])
        for index, left in enumerate(membership)
        for right in list(membership)[index + 1:]
        if membership[left] & membership[right]
    }
    if leaks:
        raise ValueError(f"session leakage across dataset splits: {leaks}")
    return {**metadata, "data_yaml": str(data_yaml), "dataset_root": str(root)}


def inspect_training_csv(path: str | Path) -> dict:
    path = Path(path)
    with path.open(newline="") as handle:
        rows = list(csv.DictReader(handle))
    if not rows:
        raise ValueError(f"training log contains no epochs: {path}")
    numeric_rows = []
    for row in rows:
        converted = {}
        for key, value in row.items():
            key = key.strip()
            try:
                converted[key] = float(value)
            except (TypeError, ValueError) as exc:
                raise ValueError(f"non-numeric training metric {key}: {value}") from exc
        numeric_rows.append(converted)
    seg_keys = [
        key for key in numeric_rows[-1]
        if "seg_loss" in key
    ]
    seg_values = [row[key] for row in numeric_rows for key in seg_keys]
    if (
        not seg_keys
        or not all(math.isfinite(value) for value in seg_values)
        or not all(value > 0 for value in seg_values)
    ):
        raise ValueError("training log has pathological segmentation loss")
    loss_values = [
        value for row in numeric_rows for key, value in row.items()
        if "loss" in key
    ]
    if not loss_values or not all(math.isfinite(value) for value in loss_values):
        raise ValueError("training log has non-finite loss")
    return {
        "epochs_completed": len(numeric_rows),
        "first": numeric_rows[0],
        "last": numeric_rows[-1],
        "segmentation_loss_keys": seg_keys,
    }


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _jsonable(value: Any) -> Any:
    if isinstance(value, dict):
        return {str(key): _jsonable(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_jsonable(item) for item in value]
    if hasattr(value, "item"):
        return _jsonable(value.item())
    if isinstance(value, (str, int, float, bool)) or value is None:
        return value
    return str(value)


def _metrics(result: Any) -> dict:
    return _jsonable(getattr(result, "results_dict", {}) or {})


def _split_image(data_yaml: Path, split: str) -> Path:
    data = _read_yaml(data_yaml)
    root = Path(data.get("path", data_yaml.parent)).resolve()
    split_path = data.get(split)
    if not isinstance(split_path, str):
        raise ValueError(f"dataset has no {split} image directory")
    directory = Path(split_path)
    if not directory.is_absolute():
        directory = root / directory
    images = sorted(
        path for path in directory.iterdir()
        if path.suffix.lower() in {".jpg", ".jpeg", ".png"}
    )
    if not images:
        raise ValueError(f"dataset {split} split contains no images")
    return images[0]


def run_training(config: TrainingConfig) -> Path:
    import torch
    import ultralytics
    from ultralytics import YOLO

    metadata = verified_dataset_preflight(config.data)
    if config.device == "mps" and not torch.backends.mps.is_available():
        raise RuntimeError("MPS requested but unavailable in this environment")
    data_yaml = Path(metadata["data_yaml"])
    dataset_hash = metadata["dataset_sha256"]
    project = Path(config.project).resolve()
    run_name = f"{config.mode}-{dataset_hash[:12]}"
    started_at = datetime.now(timezone.utc)
    started = time.perf_counter()

    model = YOLO(config.model)
    source_checkpoint = Path(getattr(model, "ckpt_path", config.model))
    source_hash = _sha256(source_checkpoint) if source_checkpoint.exists() else None
    train_result = model.train(
        data=str(data_yaml),
        device=config.device,
        epochs=config.epochs,
        fraction=config.fraction,
        imgsz=config.imgsz,
        batch=config.batch,
        workers=config.workers,
        seed=config.seed,
        deterministic=True,
        patience=config.patience,
        project=str(project),
        name=run_name,
        exist_ok=False,
        pretrained=True,
        val=True,
        plots=True,
        verbose=True,
    )
    duration = time.perf_counter() - started
    trainer_device = str(model.trainer.device)
    if config.device == "mps" and trainer_device != "mps":
        raise RuntimeError(
            f"training did not use the requested MPS device: {trainer_device}"
        )
    save_dir = Path(model.trainer.save_dir).resolve()
    csv_summary = inspect_training_csv(save_dir / "results.csv")
    best = save_dir / "weights" / "best.pt"
    last = save_dir / "weights" / "last.pt"
    if not best.exists() or not last.exists():
        raise RuntimeError("training did not produce reloadable checkpoints")

    reloaded = YOLO(str(best))
    inference = reloaded.predict(
        source=str(_split_image(data_yaml, "val")),
        device=config.device,
        imgsz=config.imgsz,
        conf=0.001,
        verbose=False,
    )
    if len(inference) != 1:
        raise RuntimeError("checkpoint reload inference did not return one result")

    split_metrics = {"validation": _metrics(train_result)}
    if config.mode == "full":
        for split, report_name in (("train", "train_seen"), ("test", "test_environment")):
            evaluated = reloaded.val(
                data=str(data_yaml), split=split, device=config.device,
                imgsz=config.imgsz, batch=config.batch,
                workers=config.workers, plots=False, verbose=True,
                project=str(project), name=f"{run_name}-eval-{split}",
            )
            split_metrics[report_name] = _metrics(evaluated)

    report = {
        "version": 1,
        "healthy": True,
        "mode": config.mode,
        "started_at": started_at.isoformat(),
        "completed_at": datetime.now(timezone.utc).isoformat(),
        "duration_seconds": duration,
        "seconds_per_epoch": duration / csv_summary["epochs_completed"],
        "config": asdict(config),
        "environment": {
            "python": platform.python_version(),
            "platform": platform.platform(),
            "torch": torch.__version__,
            "ultralytics": ultralytics.__version__,
            "mps_built": torch.backends.mps.is_built(),
            "mps_available": torch.backends.mps.is_available(),
            "trainer_device": trainer_device,
        },
        "dataset": metadata,
        "source_checkpoint": {
            "path": str(source_checkpoint.resolve()),
            "sha256": source_hash,
        },
        "checkpoints": {
            "best": str(best), "best_sha256": _sha256(best),
            "last": str(last), "last_sha256": _sha256(last),
        },
        "training_log": csv_summary,
        "metrics_by_evidence": split_metrics,
        "reload_inference": {
            "image": str(_split_image(data_yaml, "val")),
            "result_count": len(inference),
            "predicted_instances": (
                0 if inference[0].masks is None else len(inference[0].masks.data)
            ),
        },
    }
    report_path = save_dir / "training-report.json"
    report_path.write_text(json.dumps(report, indent=2) + "\n")
    if config.mode == "full":
        model_path = Path("models/lego_seg.pt")
        model_path.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(best, model_path)
        model_metadata = {
            **report,
            "installed_model": str(model_path.resolve()),
            "installed_sha256": _sha256(model_path),
        }
        Path("models/lego_seg.metadata.json").write_text(
            json.dumps(model_metadata, indent=2) + "\n"
        )
    return report_path


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data", type=Path, required=True)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--smoke", action="store_true")
    mode.add_argument("--full", action="store_true")
    args = parser.parse_args()
    config = (
        TrainingConfig.smoke(args.data)
        if args.smoke else TrainingConfig.full(args.data)
    )
    print(run_training(config))


if __name__ == "__main__":
    main()
