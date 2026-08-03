"""Shadow-mode precision measurement: the go-live gate for detection.

Shadow alerts exist so the model's precision is measured before any
officer spends trust on it (PLAN §5). This module closes that loop:
field checks on shadow alerts are recorded as dispositions, and the
report aggregates them into per-run and overall precision. Detection
goes live only when measured precision clears the threshold (PLAN §10:
≥60% field-confirmed) — a number this module computes, never asserts.
"""

from datetime import datetime
from typing import Any

GO_LIVE_PRECISION = 0.6


class DispositionError(ValueError):
    pass


def record_shadow_disposition(
    store: Any,
    alert_id: str,
    *,
    field_verified_real: bool,
    actor: str,
    verified_at: datetime,
    note: str = "",
) -> dict[str, Any]:
    """Attach a field-verification verdict to a shadow alert."""
    alert = store.alerts.get(alert_id)
    if alert is None:
        raise KeyError(alert_id)
    if not alert.get("shadow", False):
        raise DispositionError(
            "dispositions are precision-measurement data for shadow alerts; "
            "live alerts are handled through case triage"
        )
    if alert.get("disposition"):
        raise DispositionError(f"alert {alert_id!r} already has a disposition")

    updated = store.update_alert(
        alert_id,
        disposition={
            "field_verified_real": field_verified_real,
            "actor": actor,
            "verified_at": verified_at.isoformat(),
            "note": note,
        },
    )
    store.record_audit(
        actor=actor,
        action="alert.shadow_disposition",
        object_type="alert",
        object_id=alert_id,
    )
    return updated


def precision_report(
    alerts: list[dict[str, Any]], *, threshold: float = GO_LIVE_PRECISION
) -> dict[str, Any]:
    """Precision of shadow detection alerts, overall and per detection run.

    Takes the alert dicts directly so callers control the population
    (e.g. jurisdiction-scoped via the API, or store-wide in a batch job).
    """
    shadow = [
        a for a in alerts if a.get("shadow", False) and a.get("detection_run_id") is not None
    ]
    disposed = [a for a in shadow if a.get("disposition")]
    real = [a for a in disposed if a["disposition"]["field_verified_real"]]

    per_run: dict[int, dict[str, int]] = {}
    for alert in shadow:
        run = per_run.setdefault(
            alert["detection_run_id"], {"alerts": 0, "disposed": 0, "real": 0}
        )
        run["alerts"] += 1
        if alert.get("disposition"):
            run["disposed"] += 1
            if alert["disposition"]["field_verified_real"]:
                run["real"] += 1

    precision = len(real) / len(disposed) if disposed else None
    return {
        "shadow_alerts": len(shadow),
        "disposed": len(disposed),
        "field_verified_real": len(real),
        "precision": round(precision, 3) if precision is not None else None,
        "go_live_threshold": threshold,
        # Go-live needs evidence, not absence of evidence: an empty or
        # undisposed shadow period never clears the gate.
        "go_live_ready": precision is not None and precision >= threshold,
        "runs": {
            str(run_id): {
                **counts,
                "precision": (
                    round(counts["real"] / counts["disposed"], 3)
                    if counts["disposed"]
                    else None
                ),
            }
            for run_id, counts in sorted(per_run.items())
        },
    }
