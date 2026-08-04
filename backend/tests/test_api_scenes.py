"""API tests for Sentinel-2 scene discovery on parcels.

Uses a stub STAC client injected via create_app so no test touches the
network; upstream behavior (results, outages) is simulated per test.
"""

from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient

from mapencroach.api.app import create_app
from mapencroach.api.auth import Role, create_token
from mapencroach.api.store import Store
from mapencroach.imagery.stac_search import SceneCandidate, StacSearchError

SECRET = "dev-secret-do-not-deploy"  # noqa: S105 - test fixture default, matches auth.py default


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


def make_candidate(scene_id: str = "S2B_43RGM_20260730_0_L2A") -> SceneCandidate:
    return SceneCandidate(
        scene_id=scene_id,
        captured_at=datetime(2026, 7, 30, 5, 25, 31, tzinfo=UTC),
        cloud_pct=12.5,
        resolution_m=10.0,
        sensor="sentinel-2b",
        source="https://stac.test/v1/search",
        thumbnail_href="https://example.com/thumb.jpg",
        visual_href="https://example.com/TCI.tif",
        stac_item={"id": scene_id},
    )


class StubStacClient:
    def __init__(self, candidates: list[SceneCandidate] | None = None, error: bool = False):
        self.candidates = candidates or []
        self.error = error
        self.calls: list[dict] = []

    def search(self, bbox, *, start, end, max_cloud_pct=None, limit=12):
        self.calls.append(
            {
                "bbox": bbox,
                "start": start,
                "end": end,
                "max_cloud_pct": max_cloud_pct,
                "limit": limit,
            }
        )
        if self.error:
            raise StacSearchError("catalog down")
        return self.candidates


@pytest.fixture
def store() -> Store:
    return Store.seed_demo()


@pytest.fixture
def dist_a_token(store: Store) -> str:
    return token_for("dist-a-officer", Role.CASE_OFFICER, store.district_a_id)


def make_client(store: Store, stac: StubStacClient) -> TestClient:
    return TestClient(create_app(store, stac_client=stac))


class TestParcelScenes:
    def test_returns_scenes_for_in_scope_parcel(self, store: Store, dist_a_token: str):
        stac = StubStacClient([make_candidate()])
        client = make_client(store, stac)
        resp = client.get("/parcels/parcel-9/scenes", headers=auth_headers(dist_a_token))
        assert resp.status_code == 200
        body = resp.json()
        assert body["parcel_id"] == "parcel-9"
        [scene] = body["scenes"]
        assert scene["scene_id"] == "S2B_43RGM_20260730_0_L2A"
        assert scene["thumbnail_href"] == "https://example.com/thumb.jpg"
        assert scene["captured_at"] == "2026-07-30T05:25:31+00:00"

    def test_bbox_covers_buffered_parcel(self, store: Store, dist_a_token: str):
        stac = StubStacClient()
        client = make_client(store, stac)
        resp = client.get("/parcels/parcel-9/scenes", headers=auth_headers(dist_a_token))
        assert resp.status_code == 200
        [call] = stac.calls
        min_lon, min_lat, max_lon, max_lat = call["bbox"]
        # parcel-9 is a ~110m square centred on (78.135, 29.945), buffered outward
        assert min_lon < 78.135 < max_lon
        assert min_lat < 29.945 < max_lat
        assert max_lon - min_lon > 0.001
        assert resp.json()["bbox"] == list(call["bbox"])

    def test_query_params_reach_catalog(self, store: Store, dist_a_token: str):
        stac = StubStacClient()
        client = make_client(store, stac)
        resp = client.get(
            "/parcels/parcel-9/scenes?days=30&max_cloud_pct=15&limit=3",
            headers=auth_headers(dist_a_token),
        )
        assert resp.status_code == 200
        [call] = stac.calls
        assert call["max_cloud_pct"] == 15.0
        assert call["limit"] == 3
        assert (call["end"] - call["start"]).days == 30

    def test_out_of_scope_parcel_is_404_and_catalog_untouched(
        self, store: Store, dist_a_token: str
    ):
        stac = StubStacClient([make_candidate()])
        client = make_client(store, stac)
        # parcel-20 is Roorkee City (dist-b): must not exist for a dist-a officer
        resp = client.get("/parcels/parcel-20/scenes", headers=auth_headers(dist_a_token))
        assert resp.status_code == 404
        assert stac.calls == []

    def test_unknown_parcel_is_404(self, store: Store, dist_a_token: str):
        client = make_client(store, StubStacClient())
        resp = client.get("/parcels/nope/scenes", headers=auth_headers(dist_a_token))
        assert resp.status_code == 404

    def test_no_token_is_401(self, store: Store):
        client = make_client(store, StubStacClient())
        assert client.get("/parcels/parcel-9/scenes").status_code == 401

    def test_catalog_outage_is_502(self, store: Store, dist_a_token: str):
        client = make_client(store, StubStacClient(error=True))
        resp = client.get("/parcels/parcel-9/scenes", headers=auth_headers(dist_a_token))
        assert resp.status_code == 502
        assert "imagery catalog unavailable" in resp.json()["detail"]

    def test_invalid_days_is_422(self, store: Store, dist_a_token: str):
        client = make_client(store, StubStacClient())
        resp = client.get(
            "/parcels/parcel-9/scenes?days=0", headers=auth_headers(dist_a_token)
        )
        assert resp.status_code == 422
