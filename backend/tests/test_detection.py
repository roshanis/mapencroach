"""Detection engine: screening math, persistence gating, shadow alerts, confirmation.

End-to-end tests build synthetic Cartosat-like 4-band scenes over the
real demo parcel-1 (Upper Ganga Canal bank, Haridwar) and run the whole
chain: run 1 produces a candidate but no alert (persistence), run 2
produces a shadow AMBER alert through the severity path, confirmation
upgrades it to RED or dismisses it against building footprints.
"""

import json
from datetime import UTC, datetime

import numpy as np
import pytest
import rasterio
from pyproj import Transformer
from rasterio.transform import from_origin
from shapely.geometry import mapping, shape
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from mapencroach.db import models
from mapencroach.db.store import DatabaseStore, init_db, seed_demo_database
from mapencroach.detection.confirm import confirm_alert, confirm_change
from mapencroach.detection.geo import area_m2, buffer_m
from mapencroach.detection.run import run_detection
from mapencroach.detection.screening import (
    change_mask,
    ndvi,
    screen_parcel,
)

UTM = "EPSG:32644"
PIXEL_M = 5.0
SIZE = 80  # 400m x 400m — comfortably covers the ~110m demo parcel

# Demo parcel-1 center (see api/store.py seed): canal bank, Haridwar.
PARCEL1_LON, PARCEL1_LAT = 78.145, 29.938

# Band values chosen so the change is unambiguous:
VEG = np.array([60, 60, 40, 200], dtype="uint8")  # B,G,R,NIR — healthy canopy
BUILT = np.array([140, 140, 150, 90], dtype="uint8")  # bright, low NIR


def utm_center() -> tuple[float, float]:
    transformer = Transformer.from_crs(4326, 32644, always_xy=True)
    return transformer.transform(PARCEL1_LON, PARCEL1_LAT)


def write_scene(path, *, built_block=None):
    """A vegetated 4-band scene; built_block=(row0,row1,col0,col1) paves pixels."""
    data = np.empty((4, SIZE, SIZE), dtype="uint8")
    for band in range(4):
        data[band, :, :] = VEG[band]
    if built_block is not None:
        r0, r1, c0, c1 = built_block
        for band in range(4):
            data[band, r0:r1, c0:c1] = BUILT[band]
    cx, cy = utm_center()
    origin_x = cx - SIZE * PIXEL_M / 2
    origin_y = cy + SIZE * PIXEL_M / 2
    with rasterio.open(
        path,
        "w",
        driver="GTiff",
        height=SIZE,
        width=SIZE,
        count=4,
        dtype="uint8",
        crs=UTM,
        transform=from_origin(origin_x, origin_y, PIXEL_M, PIXEL_M),
    ) as dst:
        dst.write(data)
    return path


def register(store, scene_id, path, captured_at):
    with rasterio.open(path) as ds:
        from rasterio.warp import transform_bounds

        left, bottom, right, top = transform_bounds(ds.crs, "EPSG:4326", *ds.bounds)
    store.save_scene(
        {
            "scene_id": scene_id,
            "sha256": scene_id.ljust(64, "0"),
            "cog_sha256": None,
            "captured_at": captured_at.isoformat(),
            "sensor": "Cartosat-3 MX",
            "resolution_m": PIXEL_M,
            "cloud_pct": 1.0,
            "source": "test",
            "href": str(path),
            "stac_item": {"id": scene_id, "bbox": [left, bottom, right, top]},
            "sidecar_sha256": None,
            "sidecar_raw": None,
        }
    )


# The centre of the raster is the centre of parcel-1, so a block around
# the middle rows/cols lands inside the parcel.
CENTER = SIZE // 2
CHANGE_BLOCK = (CENTER - 4, CENTER + 4, CENTER - 4, CENTER + 4)  # 8x8 px = 1600 m2


@pytest.fixture
def store(tmp_path) -> DatabaseStore:
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    init_db(engine)
    seed_demo_database(engine)
    store = DatabaseStore(engine)
    register(
        store,
        "base-2026-01",
        write_scene(tmp_path / "base.tif"),
        datetime(2026, 1, 5, tzinfo=UTC),
    )
    register(
        store,
        "cur-2026-06",
        write_scene(tmp_path / "cur1.tif", built_block=CHANGE_BLOCK),
        datetime(2026, 6, 5, tzinfo=UTC),
    )
    register(
        store,
        "cur-2026-07",
        write_scene(tmp_path / "cur2.tif", built_block=CHANGE_BLOCK),
        datetime(2026, 7, 5, tzinfo=UTC),
    )
    return store


def detect(store, current_scene_id, **kwargs):
    return run_detection(
        store,
        baseline_scene_id="base-2026-01",
        current_scene_id=current_scene_id,
        aoi_jurisdiction_id="taluk-a1",
        **kwargs,
    )


class TestScreeningMath:
    def test_ndvi_of_vegetation_is_high_and_built_is_negative(self):
        veg = VEG.reshape(4, 1, 1).astype("float64")
        built = BUILT.reshape(4, 1, 1).astype("float64")
        assert ndvi(veg)[0, 0] > 0.6
        assert ndvi(built)[0, 0] < 0.0

    def test_change_mask_requires_both_signals(self):
        base = np.tile(VEG.reshape(4, 1, 1), (1, 1, 3)).astype("float64")
        cur = base.copy()
        cur[:, 0, 0] = BUILT  # veg loss + brightening -> change
        cur[3, 0, 1] = 90  # NDVI drop alone, no brightening -> not change
        cur[:, 0, 2] = base[:, 0, 2] * 1.3  # brightening alone -> not change
        valid = np.ones((1, 3), dtype=bool)
        mask = change_mask(base, cur, valid)
        assert mask.tolist() == [[True, False, False]]

    def test_geographic_crs_is_refused(self, tmp_path, store):
        path = tmp_path / "geo.tif"
        data = np.zeros((4, 8, 8), dtype="uint8")
        with rasterio.open(
            path,
            "w",
            driver="GTiff",
            height=8,
            width=8,
            count=4,
            dtype="uint8",
            crs="EPSG:4326",
            transform=from_origin(78.14, 29.94, 0.0001, 0.0001),
        ) as dst:
            dst.write(data)
        parcel = store.parcels["parcel-1"]
        with rasterio.open(path) as ds, pytest.raises(ValueError, match="projected CRS"):
            screen_parcel(ds, ds, "parcel-1", parcel["geometry"])


class TestPersistenceGating:
    def test_first_observation_is_a_candidate_not_an_alert(self, store):
        summary = detect(store, "cur-2026-06")
        assert summary.candidates == 1
        assert summary.alerts_created == []
        with Session(store.engine) as session:
            candidates = (
                session.execute(select(models.DetectionCandidate)).scalars().all()
            )
        assert len(candidates) == 1
        assert candidates[0].parcel_id == "parcel-1"
        assert candidates[0].changed_area_m2 == pytest.approx(1600.0)
        assert candidates[0].promoted_alert_id is None

    def test_second_observation_raises_a_shadow_amber_alert(self, store):
        detect(store, "cur-2026-06")
        summary = detect(store, "cur-2026-07")
        assert len(summary.alerts_created) == 1
        alert = store.alerts[summary.alerts_created[0]]
        assert alert["tier"] == "AMBER"  # screening never asserts RED
        assert alert["shadow"] is True  # shadow mode is the default
        assert alert["detection_run_id"] == summary.run_id
        assert alert["area_m2"] == pytest.approx(1600.0)
        # severity flows through the same explainable formula as manual alerts:
        # waterbody (1.0) x grade A (1.0) x 1600/10000 -> 16.0
        assert alert["severity_score"] == pytest.approx(16.0)

    def test_third_observation_does_not_duplicate_the_alert(self, store, tmp_path):
        detect(store, "cur-2026-06")
        detect(store, "cur-2026-07")
        register(
            store,
            "cur-2026-08",
            write_scene(tmp_path / "cur3.tif", built_block=CHANGE_BLOCK),
            datetime(2026, 8, 5, tzinfo=UTC),
        )
        summary = detect(store, "cur-2026-08")
        assert summary.alerts_created == []
        assert summary.skipped_active_alert == 1

    def test_live_mode_creates_visible_alerts(self, store):
        detect(store, "cur-2026-06")
        summary = detect(store, "cur-2026-07", live=True)
        assert store.alerts[summary.alerts_created[0]]["shadow"] is False

    def test_unchanged_scene_produces_no_candidates(self, store, tmp_path):
        register(
            store,
            "cur-nochange",
            write_scene(tmp_path / "same.tif"),
            datetime(2026, 8, 20, tzinfo=UTC),
        )
        summary = detect(store, "cur-nochange")
        assert summary.candidates == 0

    def test_uncovered_parcels_are_reported_not_silently_skipped(self, store):
        summary = detect(store, "cur-2026-06")
        # taluk-a1 has 5 parcels; the synthetic scene covers only parcel-1.
        assert summary.parcels_screened == 1
        assert summary.parcels_outside_coverage == 4

    def test_run_is_recorded_reproducibly(self, store):
        summary = detect(store, "cur-2026-06")
        with Session(store.engine) as session:
            run = session.get(models.DetectionRun, summary.run_id)
        assert run.status == "SUCCEEDED"
        params = json.loads(run.params)
        assert params["baseline_scene_id"] == "base-2026-01"
        assert params["thresholds"]["ndvi_drop"] == 0.15

    def test_baseline_ordering_is_enforced(self, store):
        with pytest.raises(ValueError, match="after the baseline"):
            run_detection(
                store,
                baseline_scene_id="cur-2026-06",
                current_scene_id="base-2026-01",
                aoi_jurisdiction_id="taluk-a1",
            )


def _promoted_change_geometry(store):
    with Session(store.engine) as session:
        candidate = (
            session.execute(
                select(models.DetectionCandidate).where(
                    models.DetectionCandidate.promoted_alert_id.is_not(None)
                )
            )
            .scalars()
            .one()
        )
    return json.loads(candidate.change_geometry), candidate.promoted_alert_id


class TestConfirmation:
    def test_change_with_no_footprints_confirms_red(self, store):
        detect(store, "cur-2026-06")
        detect(store, "cur-2026-07")
        change_geom, alert_id = _promoted_change_geometry(store)

        result = confirm_alert(store, alert_id, change_geom, footprint_geometries=[])
        assert result.outcome == "confirmed_red"
        assert result.new_built_m2 == pytest.approx(1600.0, rel=0.05)
        alert = store.alerts[alert_id]
        assert alert["tier"] == "RED"
        assert alert["confirmation"]["reason"] == "new_built_up"

    def test_change_matching_existing_footprint_is_dismissed(self, store):
        detect(store, "cur-2026-06")
        detect(store, "cur-2026-07")
        change_geom, alert_id = _promoted_change_geometry(store)

        # A pre-existing building exactly where the change is.
        footprint = mapping(buffer_m(shape(change_geom), 2.0))
        result = confirm_alert(store, alert_id, change_geom, [footprint])
        assert result.outcome == "dismissed"
        assert result.reason == "matches_existing_footprint"
        alert = store.alerts[alert_id]
        assert alert["status"] == "CLOSED"
        assert alert["tier"] == "AMBER"  # never silently promoted

    def test_approved_plan_deviation_is_measured(self):
        change = {
            "type": "Polygon",
            "coordinates": [
                [
                    [78.1000, 29.9000],
                    [78.1004, 29.9000],
                    [78.1004, 29.9004],
                    [78.1000, 29.9004],
                    [78.1000, 29.9000],
                ]
            ],
        }
        # Approved envelope covers the western half of the change only.
        approved = {
            "type": "Polygon",
            "coordinates": [
                [
                    [78.1000, 29.9000],
                    [78.1002, 29.9000],
                    [78.1002, 29.9004],
                    [78.1000, 29.9004],
                    [78.1000, 29.9000],
                ]
            ],
        }
        outcome, _reason, new_built, deviation = confirm_change(
            change, footprint_geometries=[], approved_geometries=[approved]
        )
        assert outcome == "confirmed_red"
        assert deviation is not None
        assert 0 < deviation < new_built

    def test_area_helper_is_metric(self):
        # ~0.0004 deg x 0.0004 deg near 29.9N is roughly 38m x 44m.
        square = shape(
            {
                "type": "Polygon",
                "coordinates": [
                    [
                        [78.1, 29.9],
                        [78.1004, 29.9],
                        [78.1004, 29.9004],
                        [78.1, 29.9004],
                        [78.1, 29.9],
                    ]
                ],
            }
        )
        assert area_m2(square) == pytest.approx(38.6 * 44.3, rel=0.05)


class TestShadowVisibility:
    def test_officers_never_see_shadow_alerts(self, store):
        from datetime import timedelta

        from fastapi.testclient import TestClient

        from mapencroach.api.app import create_app
        from mapencroach.api.auth import Role, create_token

        detect(store, "cur-2026-06")
        summary = detect(store, "cur-2026-07")
        shadow_id = summary.alerts_created[0]
        client = TestClient(create_app(store))

        def headers(role: Role) -> dict[str, str]:
            token = create_token(
                sub="u",
                role=role,
                jurisdiction_id="state",
                secret="dev-secret-do-not-deploy",  # noqa: S106 - dev default
                expires_at=datetime.now(UTC) + timedelta(hours=1),
            )
            return {"Authorization": f"Bearer {token}"}

        officer_ids = {
            a["id"] for a in client.get("/alerts", headers=headers(Role.CASE_OFFICER)).json()
        }
        assert shadow_id not in officer_ids

        # Even asking politely doesn't help a case officer.
        asked = client.get(
            "/alerts?include_shadow=true", headers=headers(Role.CASE_OFFICER)
        ).json()
        assert shadow_id not in {a["id"] for a in asked}

        admin_ids = {
            a["id"]
            for a in client.get(
                "/alerts?include_shadow=true", headers=headers(Role.DATA_ADMIN)
            ).json()
        }
        assert shadow_id in admin_ids