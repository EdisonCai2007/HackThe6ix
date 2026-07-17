"""Stud-count sanity check (Phase 2): an ADVISORY tiebreaker for Brickognize.

HoughCircles counts studs on the identification crop. Counts are noisy (up
to ~2x over on beams, undercounts on big plates), so only order-of-magnitude
disagreement counts as contradiction (>=3x either way), and low counts are
treated as "studs not visible" and skipped — never as evidence. The advisory
never overrides a high-confidence ID.

Actions: skipped | high-confidence | compatible | corrected | demoted |
rescued | no-rescue.
"""
from __future__ import annotations

import re

import cv2
import numpy as np

from pipeline.identify import Identification

STUD_DIAMETER_M = 0.0048
MIN_RELIABLE_COUNT = 4      # below this, studs are simply not visible
CONTRADICTION_FACTOR = 3.0  # count vs expected disagreement to act on
HIGH_CONFIDENCE = 0.90      # never touch IDs at or above this score
MIN_CANDIDATE_SCORE = 0.50  # never switch/rescue to weaker candidates

_NAME_DIMS = re.compile(r"(\d+)\s*x\s*(\d+)")


def expected_studs(name: str) -> int | None:
    """Stud count implied by a part name like 'Brick 1 x 8', else None."""
    match = _NAME_DIMS.search(name or "")
    if not match:
        return None
    return int(match.group(1)) * int(match.group(2))


def stud_radius_px(canvas_box, box_original, px_per_m) -> float:
    """Expected stud radius in ORIGINAL-frame pixels for this crop."""
    cw = max(1, canvas_box[2] - canvas_box[0])
    ch = max(1, canvas_box[3] - canvas_box[1])
    ow = max(1, box_original[2] - box_original[0])
    oh = max(1, box_original[3] - box_original[1])
    scale = (ow / cw + oh / ch) / 2.0
    return (STUD_DIAMETER_M / 2.0) * px_per_m * scale


def count_studs(crop_bgr: np.ndarray, radius_px: float) -> int:
    """Best-effort stud count via HoughCircles (CLAHE-enhanced, two scales)."""
    if crop_bgr is None or crop_bgr.size == 0 or radius_px < 3:
        return 0
    gray = cv2.cvtColor(crop_bgr, cv2.COLOR_BGR2GRAY)
    gray = cv2.createCLAHE(clipLimit=3.0, tileGridSize=(8, 8)).apply(gray)
    gray = cv2.medianBlur(gray, 3)
    best = 0
    for factor in (0.7, 1.0):
        r = radius_px * factor
        if r < 3:
            continue
        circles = cv2.HoughCircles(
            gray, cv2.HOUGH_GRADIENT, dp=1, minDist=r * 1.6,
            param1=110, param2=22,
            minRadius=max(2, int(r * 0.65)), maxRadius=int(r * 1.35))
        if circles is not None:
            best = max(best, circles.shape[1])
    return best


def _contradicts(count: int, expected: int | None) -> bool:
    if expected is None:
        return False
    return (count >= CONTRADICTION_FACTOR * expected
            or count <= expected / CONTRADICTION_FACTOR)


def _from_candidate(candidate: dict, base: Identification) -> Identification:
    return Identification(candidate["part_id"], candidate["name"], None,
                          float(candidate["score"]),
                          candidates=base.candidates)


def advise(ident: Identification, stud_count: int) -> tuple[Identification, str]:
    """Apply the stud advisory to one identification. Returns (id, action)."""
    if stud_count < MIN_RELIABLE_COUNT:
        return ident, "skipped"
    if ident.score >= HIGH_CONFIDENCE:
        return ident, "high-confidence"

    candidates = [c for c in ident.candidates
                  if float(c["score"]) >= MIN_CANDIDATE_SCORE]

    if ident.part_id is None:
        # Rescue path: below the accept threshold, but studs confirm the top
        # candidate's pattern. Never rescue against a contradicting count.
        for candidate in candidates:
            expected = expected_studs(candidate["name"])
            if expected is None:
                continue
            if not _contradicts(stud_count, expected):
                return _from_candidate(candidate, ident), "rescued"
        return ident, "no-rescue"

    if not _contradicts(stud_count, expected_studs(ident.name)):
        return ident, "compatible"
    for candidate in candidates:
        expected = expected_studs(candidate["name"])
        if expected is not None and not _contradicts(stud_count, expected):
            return _from_candidate(candidate, ident), "corrected"
    demoted = Identification(None, "unknown brick", None, ident.score,
                             candidates=ident.candidates)
    return demoted, "demoted"
