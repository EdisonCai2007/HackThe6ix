"""Conflict-aware arbitration for independent identification evidence."""
from __future__ import annotations

from dataclasses import asdict, dataclass

from pipeline.identify import Identification


@dataclass(frozen=True)
class ArbitrationOutcome:
    identification: Identification
    action: str
    supporting_categories: tuple[str, ...]
    reason: str

    def to_dict(self) -> dict:
        payload = asdict(self)
        payload["identification"] = {
            "part_id": self.identification.part_id,
            "name": self.identification.name,
            "score": self.identification.score,
        }
        return payload


def arbitrate_identification(
    current: Identification,
    dimension_action: str,
    stud_proposal: Identification,
    stud_action: str,
    identity_support: dict[str, int],
) -> ArbitrationOutcome:
    """Require two evidence categories before accepting a stud proposal."""
    if (
        stud_proposal.part_id == current.part_id
        and stud_proposal.name == current.name
    ) or stud_action not in {"corrected", "rescued", "demoted"}:
        return ArbitrationOutcome(
            current,
            stud_action,
            (),
            "stud evidence did not propose an identity change",
        )

    supports = ["stud"]
    if (
        stud_proposal.part_id is not None
        and identity_support.get(stud_proposal.part_id, 0) >= 2
    ):
        supports.append("multi_view_identity")

    if stud_proposal.part_id is None:
        return ArbitrationOutcome(
            current,
            "conflict_preserved",
            tuple(supports),
            "stud evidence cannot demote an identity by itself",
        )
    if dimension_action in {"compatible", "corrected"}:
        return ArbitrationOutcome(
            current,
            "conflict_preserved",
            tuple(supports),
            "metric evidence supports the current identity",
        )
    if len(supports) < 2:
        return ArbitrationOutcome(
            current,
            "conflict_preserved",
            tuple(supports),
            "an identity change requires two evidence categories",
        )
    return ArbitrationOutcome(
        stud_proposal,
        "corrected" if current.part_id is not None else "rescued",
        tuple(supports),
        "stud and multi-view identity evidence agree",
    )
