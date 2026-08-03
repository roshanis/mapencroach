"""H3 grid helpers and the /analytics/hotspots aggregation endpoint."""

from datetime import UTC, datetime, timedelta

import h3
import pytest
from fastapi.testclient import TestClient
from shapely.geometry import shape
from sqlalchemy import create_engine
from sqlalchemy.pool import StaticPool

from mapencroach.api.app import create_app
from mapencroach.api.auth import Role, create_token
from mapencroach.api.store import Store
from mapencroach.db.store import DatabaseStore, init_db, seed_demo_database
from mapencroach.spatial.h3grid import (
    cell_boundary_geojson,
    cell_for_geometry,
    cells_for_geometry,
    neighbors,
)

SECRET = "dev-secret-do-not-deploy"  # noqa: S105 - matches auth.py dev default

# The demo parcel-1 square (~110 m) — smaller than a res-8 or res-9 hexagon.
TINY_PARCEL = {
    "type": "Polygon",
    "coordinates": [
        [
            [78.1445, 29.9375],
            [78.1455, 29.9375],
            [78.1455, 29.9385],
            [78.1445, 29.9385],
            [78.1445, 29.9375],
        ]
    ],
}


class TestGridHelpers:
    def test_sub_cell_geometry_still_maps_to_a_cell(self):
        # h3's centroid-based fill returns zero cells here; the helper must not.
        assert h3.geo_to_cells(TINY_PARCEL, 8) == []
        cells = cells_for_geometry(TINY_PARCEL, 8)
        assert len(cells) == 1
        assert all(h3.get_resolution(c) == 8 for c in cells)

    def test_finer_resolution_never_yields_fewer_cells(self):
        counts = [len(cells_for_geometry(TINY_PARCEL, res)) for res in (8, 9, 10, 11, 12)]
        assert counts == sorted(counts)
        assert counts[-1] > 1  # at ~3m cells the parcel spans many hexes

    def test_cell_for_geometry_is_deterministic_and_local(self):
        cell = cell_for_geometry(TINY_PARCEL, 9)
        assert cell == cell_for_geometry(TINY_PARCEL, 9)
        lat, lng = h3.cell_to_latlng(cell)
        assert lat == pytest.approx(29.938, abs=0.01)
        assert lng == pytest.approx(78.145, abs=0.01)

    def test_boundary_is_a_closed_lnglat_polygon_containing_the_center(self):
        cell = cell_for_geometry(TINY_PARCEL, 8)
        boundary = cell_boundary_geojson(cell)
        ring = boundary["coordinates"][0]
        assert ring[0] == ring[-1]
        assert len(ring) == 7  # hexagon + closure
        hexagon = shape(boundary)
        lat, lng = h3.cell_to_latlng(cell)
        assert hexagon.contains(shape({"type": "Point", "coordinates": [lng, lat]}))

    def test_neighbors_include_self(self):
        cell = cell_for_geometry(TINY_PARCEL, 8)
        ring = neighbors(cell, 1)
        assert cell in ring
        assert len(ring) == 7  # self + 6 neighbors


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


class TestHotspotsEndpoint:
    def test_all_visible_alerts_are_bucketed(self, client, store):
        body = client.get("/analytics/hotspots", headers=headers(Role.VIEWER)).json()
        assert body["resolution"] == 8
        assert sum(c["alert_count"] for c in body["cells"]) == len(store.alerts)
        assert body["cells"] == sorted(
            body["cells"], key=lambda c: (-c["alert_count"], c["cell"])
        )
        top = body["cells"][0]
        assert top["boundary"]["type"] == "Polygon"
        assert top["parcel_count"] >= 1

    def test_jurisdiction_scoping_applies(self, client, store):
        state = client.get("/analytics/hotspots", headers=headers(Role.VIEWER)).json()
        dist_b = client.get(
            "/analytics/hotspots", headers=headers(Role.CASE_OFFICER, "dist-b")
        ).json()
        state_total = sum(c["alert_count"] for c in state["cells"])
        dist_b_total = sum(c["alert_count"] for c in dist_b["cells"])
        assert 0 < dist_b_total < state_total

    def test_tier_filter_isolates_red_hotspots(self, client, store):
        body = client.get(
            "/analytics/hotspots?tier=RED", headers=headers(Role.VIEWER)
        ).json()
        reds = [a for a in store.alerts.values() if a["tier"] == "RED"]
        assert sum(c["alert_count"] for c in body["cells"]) == len(reds)
        assert all(c["red_alerts"] == c["alert_count"] for c in body["cells"])

    def test_shadow_alerts_never_shape_the_heat_map(self, client, store):
        store.save_alert(
            {
                "id": "alert-shadow-h3",
                "parcel_id": "parcel-1",
                "tier": "RED",
                "severity_score": 90.0,
                "area_m2": 5000.0,
                "status": "OPEN",
                "detected_at": datetime(2026, 7, 1, tzinfo=UTC).isoformat(),
                "shadow": True,
            }
        )
        body = client.get("/analytics/hotspots", headers=headers(Role.DATA_ADMIN)).json()
        assert sum(c["alert_count"] for c in body["cells"]) == len(store.alerts) - 1

    def test_resolution_changes_bucket_granularity(self, client):
        coarse = client.get(
            "/analytics/hotspots?resolution=5", headers=headers(Role.VIEWER)
        ).json()
        fine = client.get(
            "/analytics/hotspots?resolution=10", headers=headers(Role.VIEWER)
        ).json()
        assert len(coarse["cells"]) <= len(fine["cells"])
        assert len(coarse["cells"]) >= 1

    def test_resolution_is_bounded(self, client):
        assert (
            client.get(
                "/analytics/hotspots?resolution=15", headers=headers(Role.VIEWER)
            ).status_code
            == 422
        )

    def test_requires_authentication(self, client):
        assert client.get("/analytics/hotspots").status_code == 401