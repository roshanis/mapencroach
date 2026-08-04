"""The parcel_h3 index, /parcels?h3_cell lookup, and /analytics/coverage rollups."""

from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, func, select
from sqlalchemy.pool import StaticPool

from mapencroach.api.app import create_app
from mapencroach.api.auth import Role, create_token
from mapencroach.api.store import Store
from mapencroach.db import models
from mapencroach.db.store import DatabaseStore, init_db, seed_demo_database
from mapencroach.spatial.h3grid import cell_for_geometry

SECRET = "dev-secret-do-not-deploy"  # noqa: S105 - matches auth.py dev default


def _database_store():
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    init_db(engine)
    seed_demo_database(engine)
    return DatabaseStore(engine)


@pytest.fixture(params=["memory", "database"])
def store(request):
    return Store.seed_demo() if request.param == "memory" else _database_store()


@pytest.fixture
def client(store) -> TestClient:
    return TestClient(create_app(store))


def headers(role: Role, jurisdiction: str = "state") -> dict[str, str]:
    token = create_token(
        sub=f"{role.value}-u",
        role=role,
        jurisdiction_id=jurisdiction,
        secret=SECRET,
        expires_at=datetime.now(UTC) + timedelta(hours=1),
    )
    return {"Authorization": f"Bearer {token}"}


def save_scene(store, scene_id: str, bbox, *, cloud_pct=2.0, captured="2026-07-01"):
    stac: dict = {"id": scene_id}
    if bbox is not None:
        stac["bbox"] = list(bbox)
    store.save_scene(
        {
            "scene_id": scene_id,
            "sha256": f"{hash(scene_id) & 0xFFFF:04x}".ljust(64, "0"),
            "captured_at": f"{captured}T05:30:00+00:00",
            "sensor": "Cartosat-3 PAN",
            "resolution_m": 0.28,
            "cloud_pct": cloud_pct,
            "source": "USAC",
            "href": f"unused://{scene_id}.tif",
            "stac_item": stac,
        }
    )


# The demo corridor: everything, and the Haridwar (eastern) half only.
FULL_BBOX = (77.5, 29.5, 78.5, 30.5)
EAST_BBOX = (78.0, 29.5, 78.5, 30.5)


class TestParcelH3Index:
    def test_every_parcel_indexes_to_at_least_one_cell(self, store):
        index = store.parcel_h3_index(9)
        indexed = set().union(*index.values())
        assert indexed == set(store.parcels)

    def test_lookup_matches_direct_computation(self, store):
        parcel = store.parcels["parcel-1"]
        cell = cell_for_geometry(parcel["geometry"], 9)
        assert "parcel-1" in store.parcel_h3_index(9)[cell]

    def test_database_index_is_materialized_once(self):
        store = _database_store()
        first = store.parcel_h3_index(9)
        with store.engine.connect() as conn:
            persisted = conn.execute(
                select(func.count())
                .select_from(models.ParcelH3.__table__)
                .where(models.ParcelH3.resolution == 9)
            ).scalar_one()
        assert persisted == sum(len(ids) for ids in first.values())
        # Second call reads the persisted rows and agrees exactly.
        assert store.parcel_h3_index(9) == first

    def test_reindex_is_idempotent(self, store):
        first = store.reindex_parcels_h3(8)
        second = store.reindex_parcels_h3(8)
        assert first == second

    def test_resolutions_are_independent(self, store):
        assert store.parcel_h3_index(8) != store.parcel_h3_index(10)


class TestParcelCellLookup:
    def test_h3_cell_filters_to_parcels_under_the_hexagon(self, client, store):
        cell = cell_for_geometry(store.parcels["parcel-1"]["geometry"], 10)
        body = client.get(f"/parcels?h3_cell={cell}", headers=headers(Role.VIEWER)).json()
        ids = {f["properties"]["id"] for f in body["features"]}
        assert "parcel-1" in ids
        expected = {
            pid
            for pid, parcel in store.parcels.items()
            if cell_for_geometry(parcel["geometry"], 10) == cell
        }
        assert expected <= ids  # index may add fill cells, never lose the point cell

    def test_cell_lookup_respects_jurisdiction_scope(self, client, store):
        # parcel-5 is in taluk-b1 (dist-b); a dist-a officer must not see it.
        cell = cell_for_geometry(store.parcels["parcel-5"]["geometry"], 9)
        body = client.get(
            f"/parcels?h3_cell={cell}", headers=headers(Role.CASE_OFFICER, "dist-a")
        ).json()
        assert body["features"] == []

    def test_empty_cell_returns_empty_collection(self, client):
        # A valid res-9 cell over the middle of the Bay of Bengal.
        import h3

        cell = h3.latlng_to_cell(15.0, 88.0, 9)
        body = client.get(f"/parcels?h3_cell={cell}", headers=headers(Role.VIEWER)).json()
        assert body == {"type": "FeatureCollection", "features": []}

    def test_invalid_cell_is_422(self, client):
        resp = client.get("/parcels?h3_cell=not-a-cell", headers=headers(Role.VIEWER))
        assert resp.status_code == 422

    def test_without_filter_all_parcels_return(self, client, store):
        body = client.get("/parcels", headers=headers(Role.VIEWER)).json()
        assert len(body["features"]) == len(store.parcels)


class TestCoverageRollup:
    def test_no_scenes_means_zero_coverage(self, client, store):
        body = client.get("/analytics/coverage", headers=headers(Role.VIEWER)).json()
        assert body["coverage_pct"] == 0.0
        assert body["covered_cells"] == []
        assert body["total_cells"] == len(body["uncovered"])
        assert body["total_cells"] > 0
        counts = [c["parcel_count"] for c in body["uncovered"]]
        assert counts == sorted(counts, reverse=True)
        assert body["uncovered"][0]["boundary"]["type"] == "Polygon"

    def test_full_footprint_covers_everything(self, client, store):
        save_scene(store, "s-full", FULL_BBOX)
        body = client.get("/analytics/coverage", headers=headers(Role.VIEWER)).json()
        assert body["coverage_pct"] == 100.0
        assert body["uncovered"] == []
        assert body["scenes_considered"] == 1

    def test_partial_footprint_leaves_the_roorkee_side_uncovered(self, client, store):
        save_scene(store, "s-east", EAST_BBOX)
        body = client.get("/analytics/coverage", headers=headers(Role.VIEWER)).json()
        assert 0.0 < body["coverage_pct"] < 100.0
        assert body["covered_cells"] and body["uncovered"]

    def test_cloudy_scene_never_counts(self, client, store):
        save_scene(store, "s-cloudy", FULL_BBOX, cloud_pct=60.0)
        body = client.get("/analytics/coverage", headers=headers(Role.VIEWER)).json()
        assert body["scenes_considered"] == 0
        assert body["coverage_pct"] == 0.0
        relaxed = client.get(
            "/analytics/coverage?max_cloud_pct=80", headers=headers(Role.VIEWER)
        ).json()
        assert relaxed["coverage_pct"] == 100.0

    def test_month_filter_scopes_the_window(self, client, store):
        save_scene(store, "s-june", FULL_BBOX, captured="2026-06-15")
        july = client.get(
            "/analytics/coverage?month=2026-07", headers=headers(Role.VIEWER)
        ).json()
        assert july["coverage_pct"] == 0.0
        june = client.get(
            "/analytics/coverage?month=2026-06", headers=headers(Role.VIEWER)
        ).json()
        assert june["coverage_pct"] == 100.0
        assert client.get(
            "/analytics/coverage?month=July", headers=headers(Role.VIEWER)
        ).status_code == 422

    def test_scene_without_footprint_proves_nothing(self, client, store):
        # Absence of evidence is absence of coverage.
        save_scene(store, "s-no-bbox", None)
        body = client.get("/analytics/coverage", headers=headers(Role.VIEWER)).json()
        assert body["scenes_considered"] == 0
        assert body["coverage_pct"] == 0.0

    def test_jurisdiction_scoping_limits_the_cell_universe(self, client):
        state = client.get("/analytics/coverage", headers=headers(Role.VIEWER)).json()
        dist_b = client.get(
            "/analytics/coverage", headers=headers(Role.CASE_OFFICER, "dist-b")
        ).json()
        assert 0 < dist_b["total_cells"] < state["total_cells"]

    def test_requires_authentication(self, client):
        assert client.get("/analytics/coverage").status_code == 401
