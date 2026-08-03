"""Object storage, GCP/ortho-RMSE endpoints, and the optional Prefect entry point."""

import importlib.util
from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient

from mapencroach.api.app import create_app
from mapencroach.api.auth import Role, create_token
from mapencroach.api.store import Store
from mapencroach.imagery.objectstore import LocalObjectStore, object_store_from_env
from mapencroach.imagery.pipeline import ingest_scene
from test_imagery_pipeline import CAPTURED, write_tif

SECRET = "dev-secret-do-not-deploy"  # noqa: S105 - matches auth.py dev default


def headers(role: Role) -> dict[str, str]:
    token = create_token(
        sub=f"{role.value}-1",
        role=role,
        jurisdiction_id="state",
        secret=SECRET,
        expires_at=datetime.now(UTC) + timedelta(hours=1),
    )
    return {"Authorization": f"Bearer {token}"}


class TestLocalObjectStore:
    def test_round_trip_and_uri(self, tmp_path):
        store = LocalObjectStore(tmp_path / "objects")
        uri = store.put_bytes(b"payload", "scenes/s1/sidecar.txt")
        assert uri.startswith("file://")
        assert (tmp_path / "objects" / "scenes" / "s1" / "sidecar.txt").read_bytes() == b"payload"

    def test_key_escape_is_refused(self, tmp_path):
        store = LocalObjectStore(tmp_path / "objects")
        with pytest.raises(ValueError, match="escapes"):
            store.put_bytes(b"x", "../outside.txt")

    def test_from_env(self, tmp_path, monkeypatch):
        monkeypatch.delenv("MAPENCROACH_OBJECT_STORE_URL", raising=False)
        assert object_store_from_env() is None
        monkeypatch.setenv("MAPENCROACH_OBJECT_STORE_URL", str(tmp_path / "obj"))
        assert isinstance(object_store_from_env(), LocalObjectStore)


class TestPipelineWithObjectStore:
    def test_ingest_uploads_artifacts_and_points_catalog_at_them(self, tmp_path):
        tif = write_tif(tmp_path / "delivered.tif")
        sidecar = tmp_path / "meta.txt"
        sidecar.write_text("SatID = CARTOSAT-3\n")
        objects = LocalObjectStore(tmp_path / "objects")

        scene = ingest_scene(
            tif,
            scene_id="s-obj-1",
            captured_at=CAPTURED,
            sensor="Cartosat-3 PAN",
            resolution_m=0.28,
            cloud_pct=1.0,
            source="USAC",
            output_dir=tmp_path / "cogs",
            sidecar_path=sidecar,
            object_store=objects,
        )
        root = tmp_path / "objects" / "scenes" / "s-obj-1"
        assert (root / "original.tif").read_bytes() == tif.read_bytes()
        assert (root / "cog.tif").exists()
        assert (root / "sidecar.txt").read_text() == "SatID = CARTOSAT-3\n"
        # Catalog serves the durable copy, not the scratch output dir.
        assert scene.cog_path.startswith("file://")
        assert scene.stac_item["assets"]["data"]["href"] == scene.cog_path


class TestGcpApi:
    GCP = {
        "id": "GCP-HR-001",
        "lat": 29.9401,
        "lon": 78.1502,
        "accuracy_m": 0.02,
        "surveyed_on": "2026-06-11",
        "source": "SoI CORS network",
        "elevation_m": 292.4,
    }

    @pytest.fixture
    def client(self):
        return TestClient(create_app(Store.seed_demo()))

    def test_register_list_and_duplicate(self, client):
        assert (
            client.post("/gcps", json=self.GCP, headers=headers(Role.SURVEY_OFFICER)).status_code
            == 201
        )
        listed = client.get("/gcps", headers=headers(Role.DATA_ADMIN)).json()
        assert listed[0]["id"] == "GCP-HR-001"
        assert listed[0]["geometry"]["coordinates"] == [78.1502, 29.9401]
        assert (
            client.post("/gcps", json=self.GCP, headers=headers(Role.SURVEY_OFFICER)).status_code
            == 409
        )

    def test_case_officer_cannot_touch_gcps(self, client):
        assert (
            client.post("/gcps", json=self.GCP, headers=headers(Role.CASE_OFFICER)).status_code
            == 403
        )
        assert client.get("/gcps", headers=headers(Role.CASE_OFFICER)).status_code == 403


class TestOrthoRmse:
    def test_rmse_recorded_on_scene_and_audited(self):
        store = Store.seed_demo()
        store.save_scene(
            {
                "scene_id": "s1",
                "sha256": "a" * 64,
                "captured_at": "2026-07-01T05:30:00+00:00",
                "sensor": "Cartosat-3 PAN",
                "resolution_m": 0.28,
                "cloud_pct": 2.0,
                "source": "USAC",
                "href": "unused://s1.tif",
                "stac_item": {"id": "s1"},
            }
        )
        client = TestClient(create_app(store))
        resp = client.patch(
            "/scenes/s1/ortho-rmse", json={"rmse_m": 0.41}, headers=headers(Role.DATA_ADMIN)
        )
        assert resp.status_code == 200
        assert resp.json()["ortho_rmse_m"] == 0.41
        assert store.scenes["s1"]["ortho_rmse_m"] == 0.41
        assert store.audit_chain[-1].payload["action"] == "scene.ortho_rmse"

    def test_unknown_scene_is_404(self):
        client = TestClient(create_app(Store.seed_demo()))
        resp = client.patch(
            "/scenes/nope/ortho-rmse", json={"rmse_m": 0.4}, headers=headers(Role.DATA_ADMIN)
        )
        assert resp.status_code == 404


class TestOptionalPrefect:
    def test_clear_error_without_prefect_installed(self):
        from mapencroach.detection.flows import build_monthly_flow

        if importlib.util.find_spec("prefect") is not None:
            pytest.skip("prefect installed; the error path is not reachable")
        with pytest.raises(RuntimeError, match=r"mapencroach\[orchestration\]"):
            build_monthly_flow()