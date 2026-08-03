"""The monthly detection run: scenes → candidates → persistence → alerts.

The screening result feeds the *existing* alert machinery — severity
scoring, tiering, the officer queue — so a detected alert is
indistinguishable from a manual one downstream, except that it traces
to a reproducible detection_run and starts life AMBER (screening never
asserts RED; that upgrade needs high-res confirmation, detection/confirm.py).

Shadow mode is the default: alerts are created with shadow=True and
invisible to officers until precision has been measured and the run is
executed with live=True (PLAN §5 — never spend officer trust on an
uncalibrated model). Runs require the database-backed store: candidates
and runs are audit trail, not cache.
"""

import json
from dataclasses import dataclass, field
from datetime import UTC, date, datetime

import rasterio
from shapely.geometry import box, shape
from sqlalchemy import select
from sqlalchemy.orm import Session

from mapencroach.db import models
from mapencroach.db.store import DatabaseStore
from mapencroach.detection.enrichment import enrich
from mapencroach.detection.screening import (
    DEFAULT_BAND_MAP,
    DEFAULT_THRESHOLDS,
    BandMap,
    ScreeningThresholds,
    screen_parcel,
)
from mapencroach.domain.alerts import AlertTier, persistence_check, severity_score

MODEL_VERSION = "screen-vnir-v1"

_ACTIVE_ALERT_STATUSES = ("OPEN", "UNDER_REVIEW", "ESCALATED")


@dataclass
class DetectionSummary:
    run_id: int
    parcels_screened: int = 0
    parcels_outside_coverage: int = 0
    candidates: int = 0
    alerts_created: list[str] = field(default_factory=list)
    skipped_active_alert: int = 0


def _has_active_detection_alert(session: Session, parcel_id: str) -> bool:
    row = session.execute(
        select(models.Alert.id).where(
            models.Alert.parcel_id == parcel_id,
            models.Alert.detection_run_id.is_not(None),
            models.Alert.status.in_(_ACTIVE_ALERT_STATUSES),
        )
    ).first()
    return row is not None


def _persistence_count(session: Session, parcel_id: str, observed_on: date) -> int:
    """Distinct observation dates (including today's) with a candidate on this parcel."""
    dates = set(
        session.execute(
            select(models.DetectionCandidate.observed_on).where(
                models.DetectionCandidate.parcel_id == parcel_id
            )
        ).scalars()
    )
    dates.add(observed_on)
    return len(dates)


def run_detection(
    store: DatabaseStore,
    *,
    current_scene_id: str,
    aoi_jurisdiction_id: str,
    baseline_scene_id: str | None = None,
    live: bool = False,
    band_map: BandMap = DEFAULT_BAND_MAP,
    thresholds: ScreeningThresholds = DEFAULT_THRESHOLDS,
    persistence_required: int = 2,
    enrichment_layers: dict[str, list[dict]] | None = None,
    actor: str = "detection-pipeline",
) -> DetectionSummary:
    """Screen every parcel in the AOI against baseline vs current scene.

    When baseline_scene_id is omitted, the AOI's declared baseline
    (imagery/baseline.py) is resolved — hash-verified — which is the
    normal production path; an explicit id is for ad-hoc comparisons.
    """
    scenes = store.scenes
    if current_scene_id not in scenes:
        raise KeyError(f"scene not registered: {current_scene_id!r}")
    current_scene = scenes[current_scene_id]
    if baseline_scene_id is None:
        from mapencroach.imagery.baseline import resolve_baseline_scene

        baseline_scene_id = resolve_baseline_scene(
            store, aoi_jurisdiction_id, current_scene
        )
    elif baseline_scene_id not in scenes:
        raise KeyError(f"scene not registered: {baseline_scene_id!r}")
    baseline_scene = scenes[baseline_scene_id]
    if current_scene["captured_at"] <= baseline_scene["captured_at"]:
        raise ValueError("current scene must be captured after the baseline scene")

    observed_on = datetime.fromisoformat(current_scene["captured_at"]).date()
    aoi_scope = store.tree.scope_ids(aoi_jurisdiction_id)
    in_scope = [p for p in store.parcels.values() if p["jurisdiction_id"] in aoi_scope]

    # A parcel can only be screened where BOTH scenes actually cover it —
    # partial coverage would bias change area low and hide encroachment.
    covered_area = box(*baseline_scene["stac_item"]["bbox"]).intersection(
        box(*current_scene["stac_item"]["bbox"])
    )
    parcels = [p for p in in_scope if covered_area.covers(shape(p["geometry"]))]
    outside_coverage = len(in_scope) - len(parcels)

    params = {
        "baseline_scene_id": baseline_scene_id,
        "current_scene_id": current_scene_id,
        "baseline_sha256": baseline_scene["sha256"],
        "current_sha256": current_scene["sha256"],
        "thresholds": {
            "ndvi_drop": thresholds.ndvi_drop,
            "brightness_rise": thresholds.brightness_rise,
            "min_changed_area_m2": thresholds.min_changed_area_m2,
        },
        "persistence_required": persistence_required,
        "live": live,
    }

    with Session(store.engine) as session:
        run = models.DetectionRun(
            model_version=MODEL_VERSION,
            aoi_jurisdiction_id=aoi_jurisdiction_id,
            params=json.dumps(params),
            status="RUNNING",
            started_at=datetime.now(UTC),
        )
        session.add(run)
        session.commit()
        run_id = run.id

    summary = DetectionSummary(run_id=run_id, parcels_outside_coverage=outside_coverage)
    try:
        with (
            rasterio.open(baseline_scene["href"]) as baseline_ds,
            rasterio.open(current_scene["href"]) as current_ds,
            Session(store.engine) as session,
        ):
            for parcel in parcels:
                summary.parcels_screened += 1
                result = screen_parcel(
                    baseline_ds,
                    current_ds,
                    parcel["id"],
                    parcel["geometry"],
                    band_map=band_map,
                    thresholds=thresholds,
                )
                if not result.is_candidate:
                    continue
                summary.candidates += 1

                persistence = _persistence_count(session, parcel["id"], observed_on)
                candidate = models.DetectionCandidate(
                    detection_run_id=run_id,
                    parcel_id=parcel["id"],
                    observed_on=observed_on,
                    changed_area_m2=result.changed_area_m2,
                    stats=json.dumps(result.stats()),
                    change_geometry=(
                        json.dumps(result.change_geometry)
                        if result.change_geometry
                        else None
                    ),
                )
                session.add(candidate)
                session.commit()

                if not persistence_check(persistence, required=persistence_required):
                    continue
                if _has_active_detection_alert(session, parcel["id"]):
                    summary.skipped_active_alert += 1
                    continue

                alert_id = store.next_alert_id()
                alert = {
                    "id": alert_id,
                    "parcel_id": parcel["id"],
                    # Screening output is AMBER by definition; RED needs
                    # high-res confirmation (detection/confirm.py).
                    "tier": AlertTier.AMBER.value,
                    "severity_score": severity_score(
                        result.changed_area_m2,
                        parcel["land_category"],
                        parcel["boundary_grade"],
                        False,
                    ),
                    "area_m2": result.changed_area_m2,
                    "status": "OPEN",
                    "detected_at": current_scene["captured_at"],
                    "shadow": not live,
                    "detection_run_id": run_id,
                }
                if enrichment_layers is not None:
                    flags = enrich(
                        result.change_geometry or parcel["geometry"], enrichment_layers
                    )
                    if flags:
                        alert["enrichment"] = flags
                store.save_alert(alert)
                candidate.promoted_alert_id = alert_id
                session.commit()
                store.record_audit(
                    actor=actor,
                    action="alert.detected",
                    object_type="alert",
                    object_id=alert_id,
                )
                summary.alerts_created.append(alert_id)
    except Exception:
        with Session(store.engine) as session:
            run = session.get(models.DetectionRun, run_id)
            run.status = "FAILED"
            run.finished_at = datetime.now(UTC)
            session.commit()
        raise

    with Session(store.engine) as session:
        run = session.get(models.DetectionRun, run_id)
        run.status = "SUCCEEDED"
        run.finished_at = datetime.now(UTC)
        session.commit()
    store.record_audit(
        actor=actor,
        action="detection_run.complete",
        object_type="detection_run",
        object_id=str(run_id),
    )
    return summary
