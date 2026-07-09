"""Alert tiering and severity scoring for encroachment detections.

Severity drives which alerts get escalated to case creation, so the
scoring formula must be deterministic and explainable to officers and
courts. `persistence_check` prevents single-observation noise (e.g. a
one-off satellite artifact) from raising an alert on its own.
"""

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
    actionability), with a 20% bump for repeat offenders. Clamped to 100.
    """
    if land_category not in LAND_CATEGORY_WEIGHTS:
        raise ValueError(f"unknown land_category: {land_category!r}")
    if boundary_grade not in BOUNDARY_GRADE_MULTIPLIERS:
        raise ValueError(f"unknown boundary_grade: {boundary_grade!r}")

    area_factor = min(area_m2 / _ONE_HECTARE_M2, 1.0)
    weight = LAND_CATEGORY_WEIGHTS[land_category]
    grade_multiplier = BOUNDARY_GRADE_MULTIPLIERS[boundary_grade]

    score = area_factor * weight * grade_multiplier * 100
    if repeat_offender:
        score *= _REPEAT_OFFENDER_MULTIPLIER

    score = min(score, 100.0)
    return round(score, 1)


def persistence_check(observation_count: int, required: int = 2) -> bool:
    """True once an alert has been observed enough times to be raised."""
    return observation_count >= required
