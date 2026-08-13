"""API tests for the H3 index endpoints: parcel cell cover and the
jurisdiction-scoped alert density rollup."""

from datetime import UTC, datetime, timedelta

import h3
import pytest
from fastapi.testclient import TestClient

from conftest import TEST_JWT_SECRET
from mapencroach.api.app import create_app
from mapencroach.api.auth import Role, create_token
from mapencroach.api.store import Store

SECRET = TEST_JWT_SECRET


def token_for(sub: str, role: Role, jurisdiction_id: str) -> str:
    return create_token(
        sub=sub,
        role=role,
        jurisdiction_id=jurisdiction_id,
        secret=SECRET,
        expires_at=datetime.now(UTC) + timedelta(hours=1),
    )


def auth_headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def store() -> Store:
    return Store.seed_demo()


@pytest.fixture
def client(store: Store) -> TestClient:
    return TestClient(create_app(store))


@pytest.fixture
def state_token(store: Store) -> str:
    return token_for("state-admin", Role.DATA_ADMIN, store.primary_authority_id)


@pytest.fixture
def dist_a_token(store: Store) -> str:
    return token_for("dist-a-officer", Role.CASE_OFFICER, store.district_a_id)


class TestParcelH3:
    def test_default_res13_cover(self, client: TestClient, dist_a_token: str):
        resp = client.get("/parcels/parcel-9/h3", headers=auth_headers(dist_a_token))
        assert resp.status_code == 200
        body = resp.json()
        assert body["resolution"] == 13
        assert body["count"] == len(body["cells"]) > 100
        assert all(h3.get_resolution(c) == 13 for c in body["cells"])
        assert 0 < len(body["compact_cells"]) < body["count"]
        assert len(body["geojson"]["features"]) == body["count"]

    def test_res_param(self, client: TestClient, dist_a_token: str):
        resp = client.get("/parcels/parcel-9/h3?res=11", headers=auth_headers(dist_a_token))
        assert resp.status_code == 200
        body = resp.json()
        assert body["resolution"] == 11
        # ~110m parcel vs ~2,150 m2 cells: a handful of cells
        assert 1 <= body["count"] <= 20

    def test_res_out_of_range_is_422(self, client: TestClient, dist_a_token: str):
        resp = client.get("/parcels/parcel-9/h3?res=3", headers=auth_headers(dist_a_token))
        assert resp.status_code == 422

    def test_cell_budget_exceeded_is_422(self, client: TestClient, dist_a_token: str):
        resp = client.get("/parcels/parcel-9/h3?res=15", headers=auth_headers(dist_a_token))
        assert resp.status_code == 422
        assert "budget" in resp.json()["detail"]

    def test_out_of_scope_parcel_is_404(self, client: TestClient, dist_a_token: str):
        # parcel-20 is Roorkee City (dist-b)
        resp = client.get("/parcels/parcel-20/h3", headers=auth_headers(dist_a_token))
        assert resp.status_code == 404

    def test_no_token_is_401(self, client: TestClient):
        assert client.get("/parcels/parcel-9/h3").status_code == 401


class TestAlertsH3Summary:
    def test_statewide_summary_covers_all_alerts(self, client: TestClient, state_token: str):
        alerts = client.get(
            "/alerts?limit=1000", headers=auth_headers(state_token)
        ).json()
        resp = client.get("/alerts/h3-summary", headers=auth_headers(state_token))
        assert resp.status_code == 200
        body = resp.json()
        assert body["resolution"] == 9
        assert body["total_alerts"] == len(alerts) > 0
        assert sum(row["count"] for row in body["cells"]) == body["total_alerts"]
        for row in body["cells"]:
            assert h3.get_resolution(row["cell"]) == 9
            assert row["max_severity"] > 0
        assert len(body["geojson"]["features"]) == len(body["cells"])

    def test_scoped_summary_sees_fewer_alerts(
        self, client: TestClient, state_token: str, dist_a_token: str
    ):
        statewide = client.get(
            "/alerts/h3-summary", headers=auth_headers(state_token)
        ).json()
        scoped = client.get("/alerts/h3-summary", headers=auth_headers(dist_a_token)).json()
        assert 0 < scoped["total_alerts"] < statewide["total_alerts"]

    def test_coarser_res_merges_cells(self, client: TestClient, state_token: str):
        fine = client.get(
            "/alerts/h3-summary?res=12", headers=auth_headers(state_token)
        ).json()
        coarse = client.get(
            "/alerts/h3-summary?res=5", headers=auth_headers(state_token)
        ).json()
        assert len(coarse["cells"]) <= len(fine["cells"])
        assert coarse["total_alerts"] == fine["total_alerts"]

    def test_status_filter(self, client: TestClient, state_token: str):
        all_alerts = client.get(
            "/alerts/h3-summary", headers=auth_headers(state_token)
        ).json()
        open_only = client.get(
            "/alerts/h3-summary?status=OPEN", headers=auth_headers(state_token)
        ).json()
        assert open_only["total_alerts"] <= all_alerts["total_alerts"]

    def test_res_finer_than_dedup_is_422(self, client: TestClient, state_token: str):
        resp = client.get("/alerts/h3-summary?res=13", headers=auth_headers(state_token))
        assert resp.status_code == 422

    def test_no_token_is_401(self, client: TestClient):
        assert client.get("/alerts/h3-summary").status_code == 401


class TestAlertCreationDedupCell:
    def test_created_alert_carries_res12_cell(self, client: TestClient, dist_a_token: str):
        resp = client.post(
            "/alerts",
            headers=auth_headers(dist_a_token),
            json={
                "parcel_id": "parcel-9",
                "tier": "RED",
                "area_m2": 250.0,
                "detected_at": "2026-08-01T05:30:00Z",
            },
        )
        assert resp.status_code == 201
        cell = resp.json()["h3_cell"]
        assert h3.get_resolution(cell) == 12
        # same parcel, second detection -> same dedup key
        resp2 = client.post(
            "/alerts",
            headers=auth_headers(dist_a_token),
            json={
                "parcel_id": "parcel-9",
                "tier": "AMBER",
                "area_m2": 90.0,
                "detected_at": "2026-08-02T05:30:00Z",
            },
        )
        assert resp2.json()["h3_cell"] == cell
