"""Alert tiering and severity scoring for encroachment detections.

Severity drives which alerts get escalated to case creation, so the
scoring formula must be deterministic and explainable to officers and
courts. `tier_for_score` implements the documented score -> tier mapping
that `severity_score` output feeds into. `persistence_check` prevents
single-observation noise (e.g. a one-off satellite artifact) from raising
an alert on its own.
"""

import math
from enum import StrEnum

BOUNDARY_GRADE_MULTIPLIERS: dict[str, float] = {
    "A": 1.0,
    "B": 0.8,
    "C": 0.5,
}

LAND_CATEGORY_WEIGHTS: dict[str, float] = {
    "waterbody": 1.0,
    "forest": 0.9,
    "irrigation": 0.8,
    "municipal": 0.7,
    "housing": 0.6,
    "industrial": 0.5,
    "revenue": 0.4,
}

_REPEAT_OFFENDER_MULTIPLIER = 1.2
_ONE_HECTARE_M2 = 10_000

# tier_for_score thresholds -- see its docstring.
_RED_THRESHOLD = 70.0
_AMBER_THRESHOLD = 30.0


class AlertTier(StrEnum):
    GREEN = "GREEN"
    AMBER = "AMBER"
    RED = "RED"
    LEGACY = "LEGACY"


def severity_score(
    area_m2: float,
    land_category: str,
    boundary_grade: str,
    repeat_offender: bool,
) -> float:
    """Compute a 0-100 severity score for an encroachment observation.

    area factor = min(area_m2 / 1 hectare, 1.0), weighted by land category
    importance and boundary survey grade (uncertain boundaries lower
    actionability), with a 20% bump for repeat offenders. Clamped to the
    documented [0, 100] range at both ends -- a bogus negative area can't
    produce a negative score that would sort below every legitimate alert.

    Raises ValueError if `area_m2` is not finite (NaN/inf), since those
    would otherwise propagate silently into an uninterpretable score.
    """
    if land_category not in LAND_CATEGORY_WEIGHTS:
        raise ValueError(f"unknown land_category: {land_category!r}")
    if boundary_grade not in BOUNDARY_GRADE_MULTIPLIERS:
        raise ValueError(f"unknown boundary_grade: {boundary_grade!r}")
    if not math.isfinite(area_m2):
        raise ValueError(f"area_m2 must be finite, got {area_m2!r}")

    area_factor = min(area_m2 / _ONE_HECTARE_M2, 1.0)
    weight = LAND_CATEGORY_WEIGHTS[land_category]
    grade_multiplier = BOUNDARY_GRADE_MULTIPLIERS[boundary_grade]

    score = area_factor * weight * grade_multiplier * 100
    if repeat_offender:
        score *= _REPEAT_OFFENDER_MULTIPLIER

    score = min(score, 100.0)
    score = max(score, 0.0)
    return round(score, 1)


def tier_for_score(score: float) -> AlertTier:
    """Map a `severity_score` result to the tier that drives escalation.

    RED    -- score >= 70: highest priority, escalate for enforcement review.
    AMBER  -- 30 <= score < 70: watch-listed, escalate on repeat observation.
    GREEN  -- score < 30: low priority, informational only.

    LEGACY is never returned here. It marks alerts carried over from a
    system that predates this scoring/tiering scheme and is assigned
    out-of-band by whatever imports them, not derived from a score.

    Raises ValueError if `score` is outside the documented 0-100 range or
    is not finite -- callers should pass the (already-clamped) output of
    `severity_score`, not a raw, unvalidated area computation.
    """
    if not math.isfinite(score) or not 0.0 <= score <= 100.0:
        raise ValueError(f"score must be within 0-100, got {score!r}")
    if score >= _RED_THRESHOLD:
        return AlertTier.RED
    if score >= _AMBER_THRESHOLD:
        return AlertTier.AMBER
    return AlertTier.GREEN


def persistence_check(observation_count: int, required: int = 2) -> bool:
    """True once an alert has been observed enough times to be raised.

    `required` must be at least 1 -- `required=0` would make every alert
    (including one with zero observations) pass immediately, silently
    disabling the single-observation-noise protection this function
    exists to provide.
    """
    if required < 1:
        raise ValueError(f"required must be at least 1, got {required!r}")
    return observation_count >= required
