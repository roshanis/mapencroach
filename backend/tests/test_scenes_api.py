"""GET /scenes (Restricted-class coverage data) and the TiTiler tile proxy."""

from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient

from mapencroach.api import app as app_module
from mapencroach.api.app import create_app
from mapencroach.api.auth import Role, create_token
from mapencroach.api.store import Store

SECRET = "dev-secret-do-not-deploy"  # noqa: S105 - matches auth.py dev default


def token_for(role: Role) -> str:
    return create_token(
        sub=f"{role.value}-user",
        role=role,
        jurisdiction_id="state",
        secret=SECRET,
        expires_at=datetime.now(UTC) + timedelta(hours=1),
    )


def headers(role: Role) -> dict[str, str]:
    return {"Authorization": f"Bearer {token_for(role)}"}


SCENE = {
    "scene_id": "c3-001",
    "sha256": "a" * 64,
    "cog_sha256": "b" * 64,
    "captured_at": "2026-07-01T05:30:00+00:00",
    "sensor": "Cartosat-3 PAN",
    "resolution_m": 0.28,
    "cloud_pct": 2.0,
    "source": "USAC",
    "href": "/data/cogs/c3-001.tif",
    "stac_item": {"id": "c3-001", "properties": {"gsd": 0.28}},
    "sidecar_sha256": "c" * 64,
    "sidecar_raw": "SatID = CARTOSAT-3",
}


@pytest.fixture
def store() -> Store:
    store = Store.seed_demo()
    store.save_scene(dict(SCENE))
    return store


@pytest.fixture
def client(store: Store) -> TestClient:
    return TestClient(create_app(store))


class TestScenesListing:
    def test_data_admin_sees_scenes(self, client):
        body = client.get("/scenes", headers=headers(Role.DATA_ADMIN)).json()
        assert [s["scene_id"] for s in body] == ["c3-001"]
        assert body[0]["stac_item"]["properties"]["gsd"] == 0.28

    def test_raw_sidecar_is_not_in_the_listing(self, client):
        body = client.get("/scenes", headers=headers(Role.DATA_ADMIN)).json()
        assert "sidecar_raw" not in body[0]
        assert body[0]["sidecar_sha256"] == "c" * 64

    def test_coverage_is_hidden_from_case_officers(self, client):
        # Knowing what is unimaged is what a motivated encroacher wants.
        assert client.get("/scenes", headers=headers(Role.CASE_OFFICER)).status_code == 403

    def test_unauthenticated_is_401(self, client):
        assert client.get("/scenes").status_code == 401


class TestTileProxy:
    def test_unknown_scene_is_404(self, client, monkeypatch):
        monkeypatch.setenv("MAPENCROACH_TITILER_URL", "http://titiler.local")
        resp = client.get("/tiles/nope/12/2900/1700.png", headers=headers(Role.CASE_OFFICER))
        assert resp.status_code == 404

    def test_unconfigured_backend_is_503(self, client, monkeypatch):
        monkeypatch.delenv("MAPENCROACH_TITILER_URL", raising=False)
        resp = client.get("/tiles/c3-001/12/2900/1700.png", headers=headers(Role.CASE_OFFICER))
        assert resp.status_code == 503

    def test_tile_is_proxied_from_titiler(self, client, monkeypatch):
        monkeypatch.setenv("MAPENCROACH_TITILER_URL", "http://titiler.local")
        captured: dict = {}

        class FakeResponse:
            status_code = 200
            content = b"\x89PNG fake"

        def fake_get(url, params, timeout):
            captured["url"] = url
            captured["params"] = params
            return FakeResponse()

        monkeypatch.setattr(app_module.httpx, "get", fake_get)
        resp = client.get("/tiles/c3-001/12/2900/1700.png", headers=headers(Role.CASE_OFFICER))
        assert resp.status_code == 200
        assert resp.content == b"\x89PNG fake"
        assert resp.headers["content-type"] == "image/png"
        assert captured["url"] == "http://titiler.local/cog/tiles/WebMercatorQuad/12/2900/1700.png"
        assert captured["params"] == {"url": "/data/cogs/c3-001.tif"}

    def test_upstream_error_is_502(self, client, monkeypatch):
        monkeypatch.setenv("MAPENCROACH_TITILER_URL", "http://titiler.local")

        class FakeResponse:
            status_code = 500
            content = b""

        monkeypatch.setattr(app_module.httpx, "get", lambda *a, **k: FakeResponse())
        resp = client.get("/tiles/c3-001/12/2900/1700.png", headers=headers(Role.CASE_OFFICER))
        assert resp.status_code == 502