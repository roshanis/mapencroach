"""High-res confirmation: AMBER screening alerts become RED or are dismissed.

Screening (VNIR band ratios) can only say "something changed here".
Confirmation compares the detected change footprint against known
building footprints: change that falls outside every existing footprint
is *new built-up* → RED. Change explained by existing structures is
dismissed with a machine-readable reason code, and the dismissal is as
much a product as the alert — it feeds precision measurement.

When approved building plans exist for the parcel (requisition §3.4),
the same geometry test reports how much of the new construction lies
outside the approved envelope (footprint deviation). Floor additions
are explicitly out of scope for nadir imagery — that claim needs
stereo/DSM or drone obliques, and pretending otherwise would hand the
defence its first win.
"""

from dataclasses import dataclass
from typing import Any

from shapely.geometry import shape
from shapely.ops import unary_union

from mapencroach.detection.geo import area_m2, buffer_m
from mapencroach.domain.alerts import AlertTier

REASON_NEW_BUILT_UP = "new_built_up"
REASON_MATCHES_EXISTING = "matches_existing_footprint"

# Existing footprints are buffered before differencing so georeferencing
# jitter between the footprint layer and the imagery doesn't spray
# slivers of "new construction" around every real building.
_FOOTPRINT_TOLERANCE_M = 1.0


@dataclass(frozen=True)
class ConfirmationResult:
    alert_id: str
    outcome: str  # "confirmed_red" | "dismissed"
    reason: str
    new_built_m2: float
    deviation_m2: float | None  # vs approved plan; None when no plan available

    def to_dict(self) -> dict[str, Any]:
        result = {
            "outcome": self.outcome,
            "reason": self.reason,
            "new_built_m2": round(self.new_built_m2, 1),
        }
        if self.deviation_m2 is not None:
            result["approved_plan_deviation_m2"] = round(self.deviation_m2, 1)
        return result


def confirm_change(
    change_geometry: dict[str, Any],
    footprint_geometries: list[dict[str, Any]],
    approved_geometries: list[dict[str, Any]] | None = None,
    *,
    new_built_min_m2: float = 25.0,
) -> tuple[str, str, float, float | None]:
    """Pure geometry core: (outcome, reason, new_built_m2, deviation_m2)."""
    change = shape(change_geometry)

    if footprint_geometries:
        existing = unary_union(
            [buffer_m(shape(g), _FOOTPRINT_TOLERANCE_M) for g in footprint_geometries]
        )
        new_built = change.difference(existing)
    else:
        new_built = change
    new_built_area = area_m2(new_built)

    deviation: float | None = None
    if approved_geometries is not None and approved_geometries:
        approved = unary_union(
            [buffer_m(shape(g), _FOOTPRINT_TOLERANCE_M) for g in approved_geometries]
        )
        deviation = area_m2(new_built.difference(approved))
    elif approved_geometries is not None:
        deviation = new_built_area  # a plan register exists but has nothing here

    if new_built_area >= new_built_min_m2:
        return "confirmed_red", REASON_NEW_BUILT_UP, new_built_area, deviation
    return "dismissed", REASON_MATCHES_EXISTING, new_built_area, deviation


def confirm_alert(
    store: Any,
    alert_id: str,
    change_geometry: dict[str, Any],
    footprint_geometries: list[dict[str, Any]],
    approved_geometries: list[dict[str, Any]] | None = None,
    *,
    new_built_min_m2: float = 25.0,
    actor: str = "detection-pipeline",
) -> ConfirmationResult:
    """Apply confirmation to an alert: RED upgrade or dismissal with reason."""
    outcome, reason, new_built, deviation = confirm_change(
        change_geometry,
        footprint_geometries,
        approved_geometries,
        new_built_min_m2=new_built_min_m2,
    )
    result = ConfirmationResult(
        alert_id=alert_id,
        outcome=outcome,
        reason=reason,
        new_built_m2=new_built,
        deviation_m2=deviation,
    )
    if outcome == "confirmed_red":
        store.update_alert(alert_id, tier=AlertTier.RED.value, confirmation=result.to_dict())
    else:
        store.update_alert(alert_id, status="CLOSED", confirmation=result.to_dict())
    store.record_audit(
        actor=actor,
        action=f"alert.confirmation.{outcome}",
        object_type="alert",
        object_id=alert_id,
    )
    return result
