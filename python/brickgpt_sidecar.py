#!/usr/bin/env python3
"""One-request JSON sidecar for the official BrickGPT Python package."""

from __future__ import annotations

import contextlib
import json
import os
import sys
from typing import Any


def emit(payload: dict[str, Any]) -> None:
    json.dump(payload, sys.stdout, separators=(",", ":"))
    sys.stdout.write("\n")
    sys.stdout.flush()


def fail(code: str, message: str) -> None:
    emit({"ok": False, "error": {"code": code, "message": message}})


def positive_integer(value: Any, field: str) -> int:
    if not isinstance(value, int) or isinstance(value, bool) or value <= 0:
        raise ValueError(f"{field} must be a positive integer.")
    return value


def non_negative_integer(value: Any, field: str) -> int:
    if not isinstance(value, int) or isinstance(value, bool) or value < 0:
        raise ValueError(f"{field} must be a non-negative integer.")
    return value


def validate_request(payload: Any) -> dict[str, Any]:
    if not isinstance(payload, dict):
        raise ValueError("Request must be a JSON object.")

    prompt = payload.get("prompt")
    if not isinstance(prompt, str) or not prompt.strip():
        raise ValueError("prompt must be a non-empty string.")

    use_gurobi = payload.get("use_gurobi", False)
    if not isinstance(use_gurobi, bool):
        raise ValueError("use_gurobi must be a boolean.")

    return {
        "prompt": prompt,
        "seed": non_negative_integer(payload.get("seed"), "seed"),
        "world_dim": positive_integer(payload.get("world_dim"), "world_dim"),
        "max_bricks": positive_integer(payload.get("max_bricks"), "max_bricks"),
        "use_gurobi": use_gurobi,
    }


def main() -> None:
    try:
        request = validate_request(json.load(sys.stdin))
    except (ValueError, json.JSONDecodeError) as error:
        fail("invalid_request", str(error))
        return

    if not os.environ.get("HF_TOKEN"):
        fail(
            "missing_hf_token",
            "HF_TOKEN is required for the gated Llama 3.2 base model used by BrickGPT.",
        )
        return

    try:
        import transformers
        from brickgpt.models import BrickGPT, BrickGPTConfig
    except ImportError as error:
        fail(
            "missing_package",
            f"Install the official BrickGPT Python package before generation: {error}",
        )
        return

    try:
        transformers.set_seed(request["seed"])
        config = BrickGPTConfig(
            world_dim=request["world_dim"],
            max_bricks=request["max_bricks"],
            use_gurobi=request["use_gurobi"],
        )
        with contextlib.redirect_stdout(sys.stderr):
            model = BrickGPT(config)
            output = model(request["prompt"])
        bricks = [
            {
                "width": brick.h,
                "depth": brick.w,
                "x": brick.x,
                "y": brick.y,
                "z": brick.z,
            }
            for brick in output["bricks"].bricks
        ]
        rejection_reasons = dict(output["rejection_reasons"])
        emit(
            {
                "ok": True,
                "seed": request["seed"],
                "bricks": bricks,
                "metadata": {
                    "rejections": sum(rejection_reasons.values()),
                    "rejection_reasons": rejection_reasons,
                    "regenerations": output["n_regenerations"],
                },
            }
        )
    except Exception as error:  # BrickGPT/HF/Gurobi expose several runtime error types.
        fail("generation_failed", f"BrickGPT generation failed: {error}")


if __name__ == "__main__":
    main()
