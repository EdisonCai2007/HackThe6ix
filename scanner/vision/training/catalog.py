"""Typed, validated session catalog for the Phase 3 segmentation dataset."""
from __future__ import annotations

from dataclasses import dataclass, fields
from pathlib import Path

import yaml


ALLOWED_SPLITS = {"train", "val", "test", "exclude"}


@dataclass(frozen=True)
class SessionSpec:
    environment: str
    split: str
    target_frames: int
    provenance: str
    cohort: str
    reason: str | None = None
    geometry_risk: str | None = None
    scene_density: str = "standard"
    touching_priority: bool = False
    notes: str = ""


@dataclass(frozen=True)
class Catalog:
    version: int
    held_out_environment: str | None
    sessions: dict[str, SessionSpec]

    def validate(self) -> None:
        if self.version != 1:
            raise ValueError(f"unsupported catalog version: {self.version}")
        if not self.sessions:
            raise ValueError("catalog has no sessions")

        held_out_count = 0
        for session_id, spec in self.sessions.items():
            if not session_id:
                raise ValueError("session id cannot be empty")
            if spec.split not in ALLOWED_SPLITS:
                raise ValueError(
                    f"{session_id}: invalid split {spec.split!r}"
                )
            if not spec.environment:
                raise ValueError(f"{session_id}: environment is required")
            if not spec.provenance:
                raise ValueError(f"{session_id}: provenance is required")
            if not spec.cohort:
                raise ValueError(f"{session_id}: cohort is required")
            if spec.target_frames < 0:
                raise ValueError(
                    f"{session_id}: target_frames cannot be negative"
                )
            if spec.split == "exclude":
                if spec.target_frames != 0:
                    raise ValueError(
                        f"{session_id}: excluded target_frames must be zero"
                    )
                if not spec.reason:
                    raise ValueError(
                        f"{session_id}: excluded session needs a reason"
                    )
            elif spec.target_frames <= 0:
                raise ValueError(
                    f"{session_id}: target_frames must be positive"
                )

            if spec.environment == self.held_out_environment:
                held_out_count += 1
                if spec.split != "test":
                    raise ValueError(
                        f"{session_id}: held-out environment "
                        f"{self.held_out_environment!r} must use test split"
                    )
        if self.held_out_environment and held_out_count == 0:
            raise ValueError(
                f"held-out environment {self.held_out_environment!r} "
                "has no sessions"
            )

    def for_cohort(self, cohort: str | None) -> dict[str, SessionSpec]:
        if cohort is None:
            return dict(self.sessions)
        return {
            session_id: spec
            for session_id, spec in self.sessions.items()
            if spec.cohort == cohort
        }


def load_catalog(path: str | Path) -> Catalog:
    path = Path(path)
    raw = yaml.safe_load(path.read_text())
    if not isinstance(raw, dict):
        raise ValueError("catalog root must be a mapping")
    allowed_top = {"version", "held_out_environment", "sessions"}
    unknown_top = set(raw) - allowed_top
    if unknown_top:
        raise ValueError(
            f"unknown catalog fields: {sorted(unknown_top)}"
        )
    raw_sessions = raw.get("sessions")
    if not isinstance(raw_sessions, dict):
        raise ValueError("catalog sessions must be a mapping")

    allowed_session = {field.name for field in fields(SessionSpec)}
    sessions = {}
    for session_id, values in raw_sessions.items():
        if not isinstance(values, dict):
            raise ValueError(f"{session_id}: session spec must be a mapping")
        unknown = set(values) - allowed_session
        if unknown:
            raise ValueError(
                f"{session_id}: unknown session fields: {sorted(unknown)}"
            )
        try:
            sessions[str(session_id)] = SessionSpec(**values)
        except TypeError as exc:
            raise ValueError(f"{session_id}: invalid session spec: {exc}") from exc

    catalog = Catalog(
        version=raw.get("version"),
        held_out_environment=raw.get("held_out_environment"),
        sessions=sessions,
    )
    catalog.validate()
    return catalog
