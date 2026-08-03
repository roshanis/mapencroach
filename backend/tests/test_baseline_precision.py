"""Baseline declarations (the legal anchor), shadow-alert dispositions, precision gate,
and the RoR-import endpoint that persists khasra aliases onto parcels."""

from datetime import UTC, date, datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.pool import StaticPool

from mapencroach.api.app import create_app
from mapencroach.api.auth import Role, create_token
from mapencroach.api.store import Store
from mapencroach.db.store import DatabaseStore, init_db, seed_demo_database
from mapencroach.detection.precision import (
    DispositionError,
    precision_report,
    record_shadow_disposition,
)
from mapencroach.detection.run import run_detection
from mapencroach.imagery.baseline import (
    BaselineError,
    declare_baseline,
    resolve_baseline_scene,
)
from test_detection import CHANGE_BLOCK, register, write_scene

SECRET = "dev-secret-do-not-deploy"  # noqa: S105 - matches auth.py dev default
NOW = datetime(2026, 8, 1, tzinfo=UTC)


def headers(role: Role, jurisdiction: str = "state") -> dict[str, str]:
    token = create_token(
        sub=f"{role.value}-1",
        role=role,
        jurisdiction_id=jurisdiction,
        secret=SECRET,
        expires_at=datetime.now(UTC) + timedelta(hours=1),
    )
    return {"Authorization": f"Bearer {token}"}


def scene_dict(scene_id: str, captured: datetime, bbox=None) -> dict:
    return {
        "scene_id": scene_id,
        "sha256": scene_id.ljust(64, "0"),
        "captured_at": captured.isoformat(),
        "sensor": "Cartosat-3 MX",
        "resolution_m": 5.0,
        "cloud_pct": 1.0,
        "source": "test",
        "href": f"unused://{scene_id}.tif",
        "stac_item": {"id": scene_id, "bbox": bbox or [78.0, 29.8, 78.3, 30.0]},
        "sidecar_sha256": None,
        "sidecar_raw": None,
    }


class TestBaselineDeclaration:
    def test_declaration_pins_hashes_and_audits(self):
        store = Store.seed_demo()
        store.save_scene(scene_dict("b1", datetime(2026, 1, 5, tzinfo=UTC)))
        declaration = declare_baseline(
            store,
            aoi_jurisdiction_id="taluk-a1",
            baseline_date=date(2026, 1, 31),
            scene_ids=["b1"],
            declared_by="admin-1",
            declared_at=NOW,
        )
        assert declaration["scene_hashes"] == ["b1".ljust(64, "0")]
        assert store.active_baseline("taluk-a1")["scene_ids"] == ["b1"]
        assert store.audit_chain[-1].payload["action"] == "baseline.declare"

    def test_unregistered_scene_is_refused(self):
        store = Store.seed_demo()
        with pytest.raises(BaselineError, match="unregistered"):
            declare_baseline(
                store,
                aoi_jurisdiction_id="taluk-a1",
                baseline_date=date(2026, 1, 31),
                scene_ids=["ghost"],
                declared_by="admin-1",
                declared_at=NOW,
            )

    def test_scene_captured_after_baseline_date_is_refused(self):
        store = Store.seed_demo()
        store.save_scene(scene_dict("late", datetime(2026, 3, 1, tzinfo=UTC)))
        with pytest.raises(BaselineError, match="after the baseline date"):
            declare_baseline(
                store,
                aoi_jurisdiction_id="taluk-a1",
                baseline_date=date(2026, 1, 31),
                scene_ids=["late"],
                declared_by="admin-1",
                declared_at=NOW,
            )

    def test_new_declaration_supersedes(self):
        store = Store.seed_demo()
        store.save_scene(scene_dict("b1", datetime(2026, 1, 5, tzinfo=UTC)))
        store.save_scene(scene_dict("b2", datetime(2026, 1, 20, tzinfo=UTC)))
        for scene_id, day in (("b1", 31), ("b2", 31)):
            declare_baseline(
                store,
                aoi_jurisdiction_id="taluk-a1",
                baseline_date=date(2026, 1, day),
                scene_ids=[scene_id],
                declared_by="admin-1",
                declared_at=NOW,
            )
        assert store.active_baseline("taluk-a1")["scene_ids"] == ["b2"]

    def test_hash_mismatch_blocks_resolution(self):
        store = Store.seed_demo()
        store.save_scene(scene_dict("b1", datetime(2026, 1, 5, tzinfo=UTC)))
        declare_baseline(
            store,
            aoi_jurisdiction_id="taluk-a1",
            baseline_date=date(2026, 1, 31),
            scene_ids=["b1"],
            declared_by="admin-1",
            declared_at=NOW,
        )
        store.scenes["b1"]["sha256"] = "f" * 64  # registry no longer matches pin
        current = scene_dict(
            "cur", datetime(2026, 6, 1, tzinfo=UTC), bbox=[78.1, 29.9, 78.2, 29.95]
        )
        with pytest.raises(BaselineError, match="hash mismatch"):
            resolve_baseline_scene(store, "taluk-a1", current)

    def test_run_detection_uses_declared_baseline(self, tmp_path):
        engine = create_engine(
            "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
        )
        init_db(engine)
        seed_demo_database(engine)
        store = DatabaseStore(engine)
        register(
            store, "base", write_scene(tmp_path / "b.tif"), datetime(2026, 1, 5, tzinfo=UTC)
        )
        register(
            store,
            "cur",
            write_scene(tmp_path / "c.tif", built_block=CHANGE_BLOCK),
            datetime(2026, 6, 5, tzinfo=UTC),
        )
        declare_baseline(
            store,
            aoi_jurisdiction_id="taluk-a1",
            baseline_date=date(2026, 1, 31),
            scene_ids=["base"],
            declared_by="admin-1",
            declared_at=NOW,
        )
        summary = run_detection(
            store, current_scene_id="cur", aoi_jurisdiction_id="taluk-a1"
        )
        assert summary.candidates == 1  # resolved baseline, screened, candidate found

    def test_no_declaration_is_a_clear_error(self):
        store = Store.seed_demo()
        current = scene_dict("cur", datetime(2026, 6, 1, tzinfo=UTC))
        with pytest.raises(BaselineError, match="no baseline declared"):
            resolve_baseline_scene(store, "taluk-a1", current)


def _shadow_alert(store, alert_id: str, parcel_id: str, run_id: int) -> None:
    store.save_alert(
        {
            "id": alert_id,
            "parcel_id": parcel_id,
            "tier": "AMBER",
            "severity_score": 10.0,
            "area_m2": 500.0,
            "status": "OPEN",
            "detected_at": datetime(2026, 6, 5, tzinfo=UTC).isoformat(),
            "shadow": True,
            "detection_run_id": run_id,
        }
    )


class TestPrecision:
    def test_disposition_only_applies_to_shadow_alerts(self):
        store = Store.seed_demo()
        with pytest.raises(DispositionError, match="shadow"):
            record_shadow_disposition(
                store, "alert-1", field_verified_real=True, actor="a", verified_at=NOW
            )

    def test_double_disposition_is_refused(self):
        store = Store.seed_demo()
        _shadow_alert(store, "sh-1", "parcel-1", 1)
        record_shadow_disposition(
            store, "sh-1", field_verified_real=True, actor="a", verified_at=NOW
        )
        with pytest.raises(DispositionError, match="already"):
            record_shadow_disposition(
                store, "sh-1", field_verified_real=False, actor="a", verified_at=NOW
            )

    def test_report_math_and_go_live_gate(self):
        store = Store.seed_demo()
        for i, real in enumerate([True, True, False, None, None]):
            _shadow_alert(store, f"sh-{i}", "parcel-1", run_id=1 + i % 2)
            if real is not None:
                record_shadow_disposition(
                    store, f"sh-{i}", field_verified_real=real, actor="a", verified_at=NOW
                )
        report = precision_report(list(store.alerts.values()))
        assert report["shadow_alerts"] == 5
        assert report["disposed"] == 3
        assert report["field_verified_real"] == 2
        assert report["precision"] == pytest.approx(0.667, abs=0.001)
        assert report["go_live_ready"] is True  # 0.667 >= 0.6
        assert set(report["runs"]) == {"1", "2"}

    def test_no_dispositions_never_clears_the_gate(self):
        store = Store.seed_demo()
        _shadow_alert(store, "sh-0", "parcel-1", 1)
        report = precision_report(list(store.alerts.values()))
        assert report["precision"] is None
        assert report["go_live_ready"] is False


class TestPrecisionApi:
    @pytest.fixture
    def client_store(self):
        store = Store.seed_demo()
        _shadow_alert(store, "sh-1", "parcel-1", 1)
        return TestClient(create_app(store)), store

    def test_disposition_endpoint_records_and_report_reflects(self, client_store):
        client, store = client_store
        resp = client.post(
            "/alerts/sh-1/disposition",
            json={"field_verified_real": True, "note": "field check 12/8"},
            headers=headers(Role.DATA_ADMIN),
        )
        assert resp.status_code == 201
        assert resp.json()["disposition"]["field_verified_real"] is True

        report = client.get(
            "/analytics/detection-precision", headers=headers(Role.DATA_ADMIN)
        ).json()
        assert report["disposed"] == 1
        assert report["precision"] == 1.0

    def test_case_officer_cannot_disposition(self, client_store):
        client, _ = client_store
        resp = client.post(
            "/alerts/sh-1/disposition",
            json={"field_verified_real": True},
            headers=headers(Role.CASE_OFFICER),
        )
        assert resp.status_code == 403

    def test_double_disposition_is_409(self, client_store):
        client, _ = client_store
        body = {"field_verified_real": True}
        assert (
            client.post(
                "/alerts/sh-1/disposition", json=body, headers=headers(Role.DATA_ADMIN)
            ).status_code
            == 201
        )
        assert (
            client.post(
                "/alerts/sh-1/disposition", json=body, headers=headers(Role.DATA_ADMIN)
            ).status_code
            == 409
        )


ROR_CSV = """khasra_no,village_code,area_sq_m,occupant_names
101,taluk-a1,4500,Ram Singh;Shyam Singh
999,taluk-a1,1200,
"""


def _database_store():
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    init_db(engine)
    seed_demo_database(engine)
    return DatabaseStore(engine)


class TestRorImportApi:
    @pytest.fixture(params=["memory", "database"])
    def store(self, request):
        return Store.seed_demo() if request.param == "memory" else _database_store()

    @pytest.fixture
    def client(self, store):
        return TestClient(create_app(store))

    def test_import_links_khasra_and_persists_alias(self, client, store):
        resp = client.post(
            "/parcels/ror-import",
            json={"csv": ROR_CSV, "source": "Bhulekh UK 2026-07"},
            headers=headers(Role.DATA_ADMIN),
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["linked"] == 1  # khasra 101 -> parcel-1 (SN-101, taluk-a1)
        assert body["unmatched"] == 1  # khasra 999 matches nothing

        context = client.get(
            "/parcels/parcel-1/context", headers=headers(Role.DATA_ADMIN)
        ).json()
        khasra = [a for a in context["aliases"] if a["scheme"] == "khasra"]
        assert len(khasra) == 1
        assert khasra[0]["value"] == "101"
        assert khasra[0]["confidence"] == 0.95
        assert khasra[0]["source"] == "Bhulekh UK 2026-07"
        # DPDP: no occupant name anywhere in the response.
        assert "Ram Singh" not in resp.text + str(context)

    def test_rejected_csv_is_422_with_errors(self, client):
        resp = client.post(
            "/parcels/ror-import",
            json={"csv": "not,a,ror\n1,2,3\n", "source": "x"},
            headers=headers(Role.DATA_ADMIN),
        )
        assert resp.status_code == 422
        assert resp.json()["detail"]["errors"]

    def test_requires_data_admin(self, client):
        resp = client.post(
            "/parcels/ror-import",
            json={"csv": ROR_CSV, "source": "x"},
            headers=headers(Role.CASE_OFFICER),
        )
        assert resp.status_code == 403


class TestBaselineApi:
    def test_declare_and_fetch(self):
        store = Store.seed_demo()
        store.save_scene(scene_dict("b1", datetime(2026, 1, 5, tzinfo=UTC)))
        client = TestClient(create_app(store))
        resp = client.post(
            "/baselines",
            json={
                "aoi_jurisdiction_id": "taluk-a1",
                "baseline_date": "2026-01-31",
                "scene_ids": ["b1"],
                "note": "pilot baseline",
            },
            headers=headers(Role.DATA_ADMIN),
        )
        assert resp.status_code == 201
        fetched = client.get("/baselines/taluk-a1", headers=headers(Role.VIEWER)).json()
        assert fetched["scene_ids"] == ["b1"]
        assert fetched["note"] == "pilot baseline"

    def test_bad_declaration_is_422(self):
        store = Store.seed_demo()
        client = TestClient(create_app(store))
        resp = client.post(
            "/baselines",
            json={
                "aoi_jurisdiction_id": "taluk-a1",
                "baseline_date": "2026-01-31",
                "scene_ids": ["ghost"],
            },
            headers=headers(Role.DATA_ADMIN),
        )
        assert resp.status_code == 422

    def test_undeclared_aoi_is_404(self):
        client = TestClient(create_app(Store.seed_demo()))
        assert (
            client.get("/baselines/taluk-a1", headers=headers(Role.VIEWER)).status_code == 404
        )