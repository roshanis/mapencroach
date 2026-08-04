import base64
import hashlib
from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient

from conftest import TEST_JWT_SECRET
from mapencroach.api.app import AlertCreate, create_app
from mapencroach.api.auth import Role, create_token
from mapencroach.api.store import JURISDICTION_NAMES, Store
from mapencroach.audit.chain import verify_chain
from mapencroach.domain.alerts import AlertTier

# A real, non-default secret: create_app fails closed outside demo mode if
# MAPENCROACH_JWT_SECRET is unset or equal to auth.py's dev default, so
# tests need a signing secret that would actually pass that check. The
# env var itself is supplied for every test by conftest's autouse
# `_default_jwt_secret` fixture; demo-mode tests delenv it before creating
# their app, since MAPENCROACH_DEMO=1 refuses to start alongside a custom
# secret.
SECRET = TEST_JWT_SECRET


def token_for(sub: str, role: Role, jurisdiction_id: str, secret: str = SECRET) -> str:
    return create_token(
        sub=sub,
        role=role,
        jurisdiction_id=jurisdiction_id,
        secret=secret,
        expires_at=datetime.now(UTC) + timedelta(hours=1),
    )


def auth_headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def store() -> Store:
    return Store.seed_demo()


@pytest.fixture
def client(store: Store) -> TestClient:
    app = create_app(store)
    return TestClient(app)


@pytest.fixture
def state_token(store: Store) -> str:
    return token_for("state-user", Role.DATA_ADMIN, store.root_jurisdiction_id)


@pytest.fixture
def dist_a_token(store: Store) -> str:
    return token_for("dist-a-officer", Role.CASE_OFFICER, store.district_a_id)


@pytest.fixture
def dist_b_token(store: Store) -> str:
    return token_for("dist-b-officer", Role.CASE_OFFICER, store.district_b_id)


@pytest.fixture
def survey_officer_dist_a_token(store: Store) -> str:
    return token_for("dist-a-surveyor", Role.SURVEY_OFFICER, store.district_a_id)


@pytest.fixture
def viewer_token(store: Store) -> str:
    return token_for("state-viewer", Role.VIEWER, store.root_jurisdiction_id)


@pytest.fixture
def inspector_dist_a_token(store: Store) -> str:
    return token_for("dist-a-inspector", Role.INSPECTOR, store.district_a_id)


class TestAuth:
    def test_no_token_is_401(self, client: TestClient):
        resp = client.get("/parcels")
        assert resp.status_code == 401

    def test_garbage_token_is_401(self, client: TestClient):
        resp = client.get("/parcels", headers=auth_headers("not-a-real-jwt"))
        assert resp.status_code == 401

    def test_expired_token_is_401(self, client: TestClient, store: Store):
        expired = create_token(
            sub="x",
            role=Role.VIEWER,
            jurisdiction_id=store.root_jurisdiction_id,
            secret=SECRET,
            expires_at=datetime.now(UTC) - timedelta(hours=1),
        )
        resp = client.get("/parcels", headers=auth_headers(expired))
        assert resp.status_code == 401

    def test_wrong_secret_token_is_401(self, client: TestClient, store: Store):
        bad = token_for(
            "x", Role.VIEWER, store.root_jurisdiction_id, secret="wrong-secret"  # noqa: S106
        )
        resp = client.get("/parcels", headers=auth_headers(bad))
        assert resp.status_code == 401

    def test_valid_token_is_accepted(self, client: TestClient, state_token: str):
        resp = client.get("/parcels", headers=auth_headers(state_token))
        assert resp.status_code == 200

    def test_token_with_unknown_role_is_401(self, client: TestClient, store: Store):
        import jwt as pyjwt

        payload = {
            "sub": "x",
            "role": "not-a-real-role",
            "jurisdiction_id": store.root_jurisdiction_id,
            "exp": datetime.now(UTC) + timedelta(hours=1),
        }
        bad = pyjwt.encode(payload, SECRET, algorithm="HS256")
        resp = client.get("/parcels", headers=auth_headers(bad))
        assert resp.status_code == 401

    def test_token_missing_claim_is_401(self, client: TestClient):
        import jwt as pyjwt

        payload = {"sub": "x", "exp": datetime.now(UTC) + timedelta(hours=1)}
        bad = pyjwt.encode(payload, SECRET, algorithm="HS256")
        resp = client.get("/parcels", headers=auth_headers(bad))
        assert resp.status_code == 401


class TestSecretGuard:
    """create_app must fail closed outside demo mode when the JWT secret
    is still the well-known development default -- otherwise anyone who
    has read the public repo can mint a valid data_admin token."""

    def test_raises_when_secret_unset_and_not_demo(self, store: Store, monkeypatch):
        monkeypatch.delenv("MAPENCROACH_JWT_SECRET", raising=False)
        monkeypatch.delenv("MAPENCROACH_DEMO", raising=False)
        with pytest.raises(RuntimeError, match="MAPENCROACH_JWT_SECRET"):
            create_app(store)

    def test_raises_when_secret_is_empty_string(self, store: Store, monkeypatch):
        # An operator's deploy config that sets MAPENCROACH_JWT_SECRET="" must
        # be treated the same as unset -- otherwise the app boots signing
        # tokens with an empty secret instead of failing closed.
        monkeypatch.setenv("MAPENCROACH_JWT_SECRET", "")
        monkeypatch.delenv("MAPENCROACH_DEMO", raising=False)
        with pytest.raises(RuntimeError, match="MAPENCROACH_JWT_SECRET"):
            create_app(store)

    def test_raises_when_secret_is_whitespace_only(self, store: Store, monkeypatch):
        monkeypatch.setenv("MAPENCROACH_JWT_SECRET", "   ")
        monkeypatch.delenv("MAPENCROACH_DEMO", raising=False)
        with pytest.raises(RuntimeError, match="MAPENCROACH_JWT_SECRET"):
            create_app(store)

    def test_does_not_raise_in_demo_mode_with_default_secret(
        self, store: Store, monkeypatch
    ):
        monkeypatch.delenv("MAPENCROACH_JWT_SECRET", raising=False)
        monkeypatch.setenv("MAPENCROACH_DEMO", "1")
        create_app(store)  # must not raise

    def test_does_not_raise_with_explicit_secret_outside_demo(
        self, store: Store, monkeypatch
    ):
        monkeypatch.setenv("MAPENCROACH_JWT_SECRET", "a-real-production-secret")  # noqa: S105
        monkeypatch.delenv("MAPENCROACH_DEMO", raising=False)
        create_app(store)  # must not raise


class TestParcelsScoping:
    def test_state_user_sees_all_parcels(self, client: TestClient, state_token: str, store: Store):
        resp = client.get("/parcels", headers=auth_headers(state_token))
        assert resp.status_code == 200
        body = resp.json()
        assert body["type"] == "FeatureCollection"
        assert len(body["features"]) == len(store.parcels)

    def test_district_officer_does_not_see_other_district_parcels(
        self, client: TestClient, dist_a_token: str, store: Store
    ):
        resp = client.get("/parcels", headers=auth_headers(dist_a_token))
        assert resp.status_code == 200
        ids = {f["properties"]["id"] for f in resp.json()["features"]}
        dist_b_parcel_ids = {
            p["id"] for p in store.parcels.values() if p["jurisdiction_id"] in store.dist_b_scope
        }
        assert ids.isdisjoint(dist_b_parcel_ids)
        assert len(ids) > 0

    def test_feature_properties_shape(self, client: TestClient, state_token: str):
        resp = client.get("/parcels", headers=auth_headers(state_token))
        feature = resp.json()["features"][0]
        assert feature["type"] == "Feature"
        props = feature["properties"]
        for key in (
            "id",
            "survey_no",
            "ulpin",
            "owning_department",
            "land_category",
            "boundary_grade",
            "jurisdiction_id",
        ):
            assert key in props
        assert "geometry" in feature


class TestParcelDetail:
    def test_get_known_parcel_in_scope(self, client: TestClient, state_token: str, store: Store):
        parcel_id = next(iter(store.parcels))
        resp = client.get(f"/parcels/{parcel_id}", headers=auth_headers(state_token))
        assert resp.status_code == 200
        assert resp.json()["properties"]["id"] == parcel_id

    def test_unknown_parcel_is_404(self, client: TestClient, state_token: str):
        resp = client.get("/parcels/does-not-exist", headers=auth_headers(state_token))
        assert resp.status_code == 404

    def test_out_of_scope_parcel_is_404_not_403(
        self, client: TestClient, dist_a_token: str, store: Store
    ):
        out_of_scope_id = next(
            pid
            for pid, p in store.parcels.items()
            if p["jurisdiction_id"] in store.dist_b_scope
        )
        resp = client.get(f"/parcels/{out_of_scope_id}", headers=auth_headers(dist_a_token))
        assert resp.status_code == 404


class TestParcelContext:
    def test_context_exposes_identity_lineage_sources_and_context_only_signals(
        self, client: TestClient, state_token: str
    ):
        resp = client.get("/parcels/parcel-1/context", headers=auth_headers(state_token))

        assert resp.status_code == 200
        body = resp.json()
        assert body["canonical_id"] == "parcel-1"
        assert {alias["scheme"] for alias in body["aliases"]} >= {"ULPIN", "survey_no"}
        assert body["classification"] == "context_only"
        assert "not enforcement evidence" in body["disclaimer"].lower()
        assert body["geographic_links"][0]["scheme"] == "SHRUG_SHRID2"
        assert body["observations"]
        assert all(item["context_only"] is True for item in body["observations"])
        assert body["sources"][0]["is_demo"] is True
        assert body["sources"][0]["limitations"]

    def test_context_for_unmatched_parcel_is_an_honest_empty_bundle(
        self, client: TestClient, state_token: str
    ):
        resp = client.get("/parcels/parcel-2/context", headers=auth_headers(state_token))

        assert resp.status_code == 200
        body = resp.json()
        assert body["canonical_id"] == "parcel-2"
        assert body["observations"] == []
        assert body["geographic_links"] == []

    def test_context_for_unknown_parcel_is_404(self, client: TestClient, state_token: str):
        resp = client.get("/parcels/does-not-exist/context", headers=auth_headers(state_token))

        assert resp.status_code == 404

    def test_context_for_out_of_scope_parcel_is_404_not_403(
        self, client: TestClient, dist_a_token: str, store: Store
    ):
        out_of_scope_id = next(
            pid
            for pid, parcel in store.parcels.items()
            if parcel["jurisdiction_id"] in store.dist_b_scope
        )

        resp = client.get(
            f"/parcels/{out_of_scope_id}/context", headers=auth_headers(dist_a_token)
        )

        assert resp.status_code == 404

class TestBoundaryGradePatch:
    def test_survey_officer_can_patch(
        self, client: TestClient, survey_officer_dist_a_token: str, store: Store
    ):
        parcel_id = next(
            pid for pid, p in store.parcels.items() if p["jurisdiction_id"] in store.dist_a_scope
        )
        resp = client.patch(
            f"/parcels/{parcel_id}/boundary-grade",
            headers=auth_headers(survey_officer_dist_a_token),
            json={"grade": "A", "survey_reference": "SR-2026-001"},
        )
        assert resp.status_code == 200
        assert resp.json()["properties"]["boundary_grade"] == "A"

    def test_data_admin_can_patch(self, client: TestClient, state_token: str, store: Store):
        parcel_id = next(iter(store.parcels))
        resp = client.patch(
            f"/parcels/{parcel_id}/boundary-grade",
            headers=auth_headers(state_token),
            json={"grade": "B", "survey_reference": "SR-2026-002"},
        )
        assert resp.status_code == 200

    def test_case_officer_is_403(self, client: TestClient, dist_a_token: str, store: Store):
        parcel_id = next(
            pid for pid, p in store.parcels.items() if p["jurisdiction_id"] in store.dist_a_scope
        )
        resp = client.patch(
            f"/parcels/{parcel_id}/boundary-grade",
            headers=auth_headers(dist_a_token),
            json={"grade": "A", "survey_reference": "SR-2026-003"},
        )
        assert resp.status_code == 403

    def test_invalid_grade_is_422(
        self, client: TestClient, survey_officer_dist_a_token: str, store: Store
    ):
        parcel_id = next(iter(store.parcels))
        resp = client.patch(
            f"/parcels/{parcel_id}/boundary-grade",
            headers=auth_headers(survey_officer_dist_a_token),
            json={"grade": "Z", "survey_reference": "SR-2026-004"},
        )
        assert resp.status_code == 422

    def test_blank_survey_reference_is_422(
        self, client: TestClient, survey_officer_dist_a_token: str, store: Store
    ):
        # The boundary-grade audit trail must record a real survey reference
        # -- a whitespace-only value is functionally missing evidence and
        # must not validate.
        parcel_id = next(iter(store.parcels))
        resp = client.patch(
            f"/parcels/{parcel_id}/boundary-grade",
            headers=auth_headers(survey_officer_dist_a_token),
            json={"grade": "A", "survey_reference": "   "},
        )
        assert resp.status_code == 422

    def test_unknown_parcel_is_404(
        self, client: TestClient, survey_officer_dist_a_token: str
    ):
        resp = client.patch(
            "/parcels/does-not-exist/boundary-grade",
            headers=auth_headers(survey_officer_dist_a_token),
            json={"grade": "A", "survey_reference": "SR-2026-006"},
        )
        assert resp.status_code == 404

    def test_out_of_scope_parcel_is_404(
        self, client: TestClient, survey_officer_dist_a_token: str, store: Store
    ):
        out_of_scope_id = next(
            pid
            for pid, p in store.parcels.items()
            if p["jurisdiction_id"] in store.dist_b_scope
        )
        resp = client.patch(
            f"/parcels/{out_of_scope_id}/boundary-grade",
            headers=auth_headers(survey_officer_dist_a_token),
            json={"grade": "A", "survey_reference": "SR-2026-007"},
        )
        assert resp.status_code == 404

    def test_patch_appends_audit_entry(
        self, client: TestClient, state_token: str, store: Store
    ):
        parcel_id = next(iter(store.parcels))
        grade_before = store.parcels[parcel_id]["boundary_grade"]
        before = len(store.audit_chain)
        resp = client.patch(
            f"/parcels/{parcel_id}/boundary-grade",
            headers=auth_headers(state_token),
            json={"grade": "C", "survey_reference": "SR-2026-005"},
        )
        assert resp.status_code == 200
        assert len(store.audit_chain) == before + 1
        entry = store.audit_chain[-1]
        assert entry.payload["object_id"] == parcel_id
        assert entry.payload["actor"] == "state-user"
        # The DGPS survey reference justifying the grade change must not be
        # dropped on the floor -- it's the legally significant part.
        assert entry.payload["survey_reference"] == "SR-2026-005"
        assert entry.payload["from_grade"] == grade_before
        assert entry.payload["to_grade"] == "C"
        # The audit payload must cover "when", not just "who"/"what".
        assert "at" in entry.payload
        datetime.fromisoformat(entry.payload["at"])
        assert verify_chain(store.audit_chain).ok


class TestAlerts:
    def test_list_alerts(self, client: TestClient, state_token: str, store: Store):
        resp = client.get("/alerts", headers=auth_headers(state_token))
        assert resp.status_code == 200
        body = resp.json()
        assert len(body) == len(store.alerts)
        for item in body:
            for key in (
                "id",
                "parcel_id",
                "tier",
                "severity_score",
                "area_m2",
                "status",
                "detected_at",
            ):
                assert key in item

    def test_filter_by_tier(self, client: TestClient, state_token: str):
        resp = client.get("/alerts", headers=auth_headers(state_token), params={"tier": "RED"})
        assert resp.status_code == 200
        body = resp.json()
        assert len(body) > 0
        assert all(a["tier"] == "RED" for a in body)

    def test_filter_by_status(self, client: TestClient, state_token: str):
        resp = client.get("/alerts", headers=auth_headers(state_token))
        statuses = {a["status"] for a in resp.json()}
        target = next(iter(statuses))
        resp2 = client.get("/alerts", headers=auth_headers(state_token), params={"status": target})
        assert all(a["status"] == target for a in resp2.json())

    def test_alerts_are_scoped_to_jurisdiction(
        self, client: TestClient, dist_a_token: str, store: Store
    ):
        resp = client.get("/alerts", headers=auth_headers(dist_a_token))
        assert resp.status_code == 200
        visible_parcel_ids = {a["parcel_id"] for a in resp.json()}
        dist_b_parcel_ids = {
            p["id"] for p in store.parcels.values() if p["jurisdiction_id"] in store.dist_b_scope
        }
        assert visible_parcel_ids.isdisjoint(dist_b_parcel_ids)

    def test_create_alert_computes_severity(
        self, client: TestClient, state_token: str, store: Store
    ):
        parcel_id = next(
            pid for pid, p in store.parcels.items() if p["land_category"] == "waterbody"
        )
        parcel = store.parcels[parcel_id]
        resp = client.post(
            "/alerts",
            headers=auth_headers(state_token),
            json={
                "parcel_id": parcel_id,
                "tier": "RED",
                "area_m2": 5000,
                "detected_at": datetime.now(UTC).isoformat(),
            },
        )
        assert resp.status_code == 201
        body = resp.json()

        from mapencroach.domain.alerts import severity_score

        expected = severity_score(
            5000, parcel["land_category"], parcel["boundary_grade"], False
        )
        assert body["severity_score"] == expected

    def test_create_alert_forbidden_for_viewer(
        self, client: TestClient, viewer_token: str, store: Store
    ):
        parcel_id = next(iter(store.parcels))
        resp = client.post(
            "/alerts",
            headers=auth_headers(viewer_token),
            json={
                "parcel_id": parcel_id,
                "tier": "AMBER",
                "area_m2": 1000,
                "detected_at": datetime.now(UTC).isoformat(),
            },
        )
        assert resp.status_code == 403

    def test_create_alert_unknown_parcel_is_404(self, client: TestClient, state_token: str):
        resp = client.post(
            "/alerts",
            headers=auth_headers(state_token),
            json={
                "parcel_id": "no-such-parcel",
                "tier": "AMBER",
                "area_m2": 1000,
                "detected_at": datetime.now(UTC).isoformat(),
            },
        )
        assert resp.status_code == 404

    def test_create_alert_out_of_scope_parcel_is_404(
        self, client: TestClient, dist_a_token: str, store: Store
    ):
        out_of_scope_id = next(
            pid
            for pid, p in store.parcels.items()
            if p["jurisdiction_id"] in store.dist_b_scope
        )
        resp = client.post(
            "/alerts",
            headers=auth_headers(dist_a_token),
            json={
                "parcel_id": out_of_scope_id,
                "tier": "AMBER",
                "area_m2": 1000,
                "detected_at": datetime.now(UTC).isoformat(),
            },
        )
        assert resp.status_code == 404


class TestAlertTierValidation:
    """tier is a closed enum (AlertTier), not an arbitrary string -- POST
    with an unknown tier must 422 rather than silently persisting data no
    consumer understands."""

    def test_invalid_tier_is_422(self, client: TestClient, state_token: str, store: Store):
        parcel_id = next(iter(store.parcels))
        resp = client.post(
            "/alerts",
            headers=auth_headers(state_token),
            json={
                "parcel_id": parcel_id,
                "tier": "SUPER_URGENT",
                "area_m2": 1000,
                "detected_at": datetime.now(UTC).isoformat(),
            },
        )
        assert resp.status_code == 422

    @pytest.mark.parametrize("tier", ["GREEN", "AMBER", "RED", "LEGACY"])
    def test_valid_tiers_round_trip_and_filter(
        self, client: TestClient, state_token: str, store: Store, tier: str
    ):
        parcel_id = next(iter(store.parcels))
        resp = client.post(
            "/alerts",
            headers=auth_headers(state_token),
            json={
                "parcel_id": parcel_id,
                "tier": tier,
                "area_m2": 1000,
                "detected_at": datetime.now(UTC).isoformat(),
            },
        )
        assert resp.status_code == 201
        created = resp.json()
        assert created["tier"] == tier

        listed = client.get(
            "/alerts", headers=auth_headers(state_token), params={"tier": tier}
        )
        assert listed.status_code == 200
        assert any(a["id"] == created["id"] for a in listed.json())

    def test_negative_area_is_422(self, client: TestClient, state_token: str, store: Store):
        parcel_id = next(iter(store.parcels))
        resp = client.post(
            "/alerts",
            headers=auth_headers(state_token),
            json={
                "parcel_id": parcel_id,
                "tier": "RED",
                "area_m2": -5000,
                "detected_at": datetime.now(UTC).isoformat(),
            },
        )
        assert resp.status_code == 422

    def test_infinite_area_is_422(self, client: TestClient, state_token: str, store: Store):
        # `Field(ge=0)` alone lets Infinity through (inf >= 0 is True); it then
        # JSON-serializes as null downstream, poisoning the store. httpx's
        # json= encoder rejects non-finite floats outright, so the raw body
        # is sent via content= to exercise pydantic's own JSON parsing.
        parcel_id = next(iter(store.parcels))
        headers = auth_headers(state_token)
        headers["Content-Type"] = "application/json"
        detected_at = datetime.now(UTC).isoformat()
        body = (
            f'{{"parcel_id": "{parcel_id}", "tier": "RED", "area_m2": Infinity, '
            f'"detected_at": "{detected_at}"}}'
        )
        resp = client.post("/alerts", headers=headers, content=body)
        assert resp.status_code == 422

    def test_nan_area_is_422(self, client: TestClient, state_token: str, store: Store):
        parcel_id = next(iter(store.parcels))
        headers = auth_headers(state_token)
        headers["Content-Type"] = "application/json"
        detected_at = datetime.now(UTC).isoformat()
        body = (
            f'{{"parcel_id": "{parcel_id}", "tier": "RED", "area_m2": NaN, '
            f'"detected_at": "{detected_at}"}}'
        )
        resp = client.post("/alerts", headers=headers, content=body)
        assert resp.status_code == 422

    def test_normal_area_still_succeeds(
        self, client: TestClient, state_token: str, store: Store
    ):
        parcel_id = next(iter(store.parcels))
        resp = client.post(
            "/alerts",
            headers=auth_headers(state_token),
            json={
                "parcel_id": parcel_id,
                "tier": "RED",
                "area_m2": 4321.5,
                "detected_at": datetime.now(UTC).isoformat(),
            },
        )
        assert resp.status_code == 201
        assert resp.json()["area_m2"] == 4321.5


class TestCases:
    def test_list_cases(self, client: TestClient, state_token: str, store: Store):
        resp = client.get("/cases", headers=auth_headers(state_token))
        assert resp.status_code == 200
        body = resp.json()
        assert len(body) == len(store.cases)
        for item in body:
            for key in ("id", "alert_id", "parcel_id", "state"):
                assert key in item

    def test_cases_are_scoped_to_jurisdiction(
        self, client: TestClient, dist_a_token: str, store: Store
    ):
        resp = client.get("/cases", headers=auth_headers(dist_a_token))
        assert resp.status_code == 200
        visible_ids = {c["id"] for c in resp.json()}
        dist_b_case_ids = {
            cid for cid, c in store.cases.items() if c.jurisdiction_id in store.dist_b_scope
        }
        assert visible_ids.isdisjoint(dist_b_case_ids)

    def test_case_detail_shows_events_and_allowed_transitions(
        self, client: TestClient, state_token: str, store: Store
    ):
        case_id = next(
            cid for cid, c in store.cases.items() if c.case.state.value == "SHOW_CAUSE_ISSUED"
        )
        resp = client.get(f"/cases/{case_id}", headers=auth_headers(state_token))
        assert resp.status_code == 200
        body = resp.json()
        assert body["id"] == case_id
        assert len(body["events"]) > 0
        for event in body["events"]:
            for key in ("from_state", "to_state", "actor", "occurred_at", "artifacts", "note"):
                assert key in event
        assert "RESPONSE_WINDOW" in body["allowed_transitions"]
        # The transfer UI needs to know the case's CURRENT jurisdiction,
        # which can differ from the parcel's after a transfer.
        assert body["jurisdiction_id"] == store.cases[case_id].jurisdiction_id

    def test_case_detail_unknown_is_404(self, client: TestClient, state_token: str):
        resp = client.get("/cases/no-such-case", headers=auth_headers(state_token))
        assert resp.status_code == 404


class TestCaseTransitions:
    def test_case_officer_can_advance_legal_transition(
        self, client: TestClient, store: Store
    ):
        case_id = next(
            cid for cid, c in store.cases.items() if c.case.state.value == "SHOW_CAUSE_ISSUED"
        )
        case = store.cases[case_id]
        officer_token = token_for(
            "case-officer-1", Role.CASE_OFFICER, case.jurisdiction_id
        )
        resp = client.post(
            f"/cases/{case_id}/transitions",
            headers=auth_headers(officer_token),
            json={"to_state": "RESPONSE_WINDOW"},
        )
        assert resp.status_code in (200, 201)
        body = resp.json()
        assert body["to_state"] == "RESPONSE_WINDOW"
        assert body["actor"] == "case-officer-1"

    def test_unknown_case_is_404(self, client: TestClient, store: Store):
        officer_token = token_for(
            "case-officer-unknown", Role.CASE_OFFICER, store.root_jurisdiction_id
        )
        resp = client.post(
            "/cases/no-such-case/transitions",
            headers=auth_headers(officer_token),
            json={"to_state": "RESPONSE_WINDOW"},
        )
        assert resp.status_code == 404

    def test_out_of_scope_case_is_404(self, client: TestClient, store: Store):
        case_id = next(
            cid for cid, c in store.cases.items() if c.jurisdiction_id in store.dist_a_scope
        )
        officer_token = token_for(
            "case-officer-scope", Role.CASE_OFFICER, store.district_b_id
        )
        resp = client.post(
            f"/cases/{case_id}/transitions",
            headers=auth_headers(officer_token),
            json={"to_state": "RESPONSE_WINDOW"},
        )
        assert resp.status_code == 404

    def test_unknown_to_state_is_422(self, client: TestClient, store: Store):
        case_id = next(
            cid for cid, c in store.cases.items() if c.case.state.value == "SHOW_CAUSE_ISSUED"
        )
        case = store.cases[case_id]
        officer_token = token_for(
            "case-officer-badstate", Role.CASE_OFFICER, case.jurisdiction_id
        )
        resp = client.post(
            f"/cases/{case_id}/transitions",
            headers=auth_headers(officer_token),
            json={"to_state": "NOT_A_REAL_STATE"},
        )
        assert resp.status_code == 422

    def test_illegal_transition_is_409_with_message(
        self, client: TestClient, store: Store
    ):
        case_id = next(
            cid for cid, c in store.cases.items() if c.case.state.value == "SHOW_CAUSE_ISSUED"
        )
        case = store.cases[case_id]
        # CLOSED is a legally-gated target (see TestCaseTransitionLegalGating),
        # so this needs a legal_officer token - the point here is the 409
        # from an illegal transition, not the role gate.
        officer_token = token_for(
            "legal-officer-2", Role.LEGAL_OFFICER, case.jurisdiction_id
        )
        resp = client.post(
            f"/cases/{case_id}/transitions",
            headers=auth_headers(officer_token),
            json={"to_state": "CLOSED"},
        )
        assert resp.status_code == 409
        assert "cannot transition" in resp.json()["detail"]

    def test_missing_artifact_is_409_naming_artifact(
        self, client: TestClient, store: Store
    ):
        case_id = next(
            cid for cid, c in store.cases.items() if c.case.state.value == "SHOW_CAUSE_ISSUED"
        )
        case = store.cases[case_id]
        officer_token = token_for(
            "case-officer-3", Role.CASE_OFFICER, case.jurisdiction_id
        )
        # RESPONSE_WINDOW -> HEARING_SCHEDULED requires hearing_date artifact
        resp1 = client.post(
            f"/cases/{case_id}/transitions",
            headers=auth_headers(officer_token),
            json={"to_state": "RESPONSE_WINDOW"},
        )
        assert resp1.status_code in (200, 201)
        resp2 = client.post(
            f"/cases/{case_id}/transitions",
            headers=auth_headers(officer_token),
            json={"to_state": "HEARING_SCHEDULED"},
        )
        assert resp2.status_code == 409
        assert "hearing_date" in resp2.json()["detail"]

    def test_transitions_forbidden_for_inspector(
        self, client: TestClient, store: Store
    ):
        case_id = next(
            cid for cid, c in store.cases.items() if c.case.state.value == "SHOW_CAUSE_ISSUED"
        )
        case = store.cases[case_id]
        inspector_token = token_for(
            "inspector-1", Role.INSPECTOR, case.jurisdiction_id
        )
        resp = client.post(
            f"/cases/{case_id}/transitions",
            headers=auth_headers(inspector_token),
            json={"to_state": "RESPONSE_WINDOW"},
        )
        assert resp.status_code == 403


class TestAuditChainIntegrity:
    def test_audit_chain_stays_valid_after_mutations(
        self, client: TestClient, state_token: str, store: Store
    ):
        parcel_id = next(iter(store.parcels))
        client.patch(
            f"/parcels/{parcel_id}/boundary-grade",
            headers=auth_headers(state_token),
            json={"grade": "A", "survey_reference": "SR-INTEGRITY-1"},
        )

        alert_parcel_id = next(
            pid for pid, p in store.parcels.items() if p["land_category"] == "forest"
        )
        create_resp = client.post(
            "/alerts",
            headers=auth_headers(state_token),
            json={
                "parcel_id": alert_parcel_id,
                "tier": "AMBER",
                "area_m2": 2000,
                "detected_at": datetime.now(UTC).isoformat(),
            },
        )
        assert create_resp.status_code == 201

        case_id = next(
            cid for cid, c in store.cases.items() if c.case.state.value == "SHOW_CAUSE_ISSUED"
        )
        case = store.cases[case_id]
        officer_token = token_for("integrity-officer", Role.CASE_OFFICER, case.jurisdiction_id)
        client.post(
            f"/cases/{case_id}/transitions",
            headers=auth_headers(officer_token),
            json={"to_state": "RESPONSE_WINDOW"},
        )

        result = verify_chain(store.audit_chain)
        assert result.ok


class TestRequireRoles:
    def test_multiple_allowed_roles(self, client: TestClient, store: Store):
        # data_admin is allowed on boundary-grade patch alongside survey_officer
        parcel_id = next(iter(store.parcels))
        admin_token = token_for("admin-x", Role.DATA_ADMIN, store.root_jurisdiction_id)
        resp = client.patch(
            f"/parcels/{parcel_id}/boundary-grade",
            headers=auth_headers(admin_token),
            json={"grade": "B", "survey_reference": "SR-MULTI-ROLE"},
        )
        assert resp.status_code == 200


class TestCorsConfiguration:
    """Allowed origins come from MAPENCROACH_CORS_ORIGINS (comma-separated),
    defaulting to the local dev console, so a hosted frontend (e.g. Vercel)
    can be whitelisted without a code change."""

    def _preflight(self, app_client: TestClient, origin: str):
        return app_client.options(
            "/parcels",
            headers={
                "Origin": origin,
                "Access-Control-Request-Method": "GET",
                "Access-Control-Request-Headers": "authorization",
            },
        )

    def test_default_allows_localhost_3000(self, store: Store):
        app_client = TestClient(create_app(store))
        resp = self._preflight(app_client, "http://localhost:3000")
        assert resp.status_code == 200
        assert resp.headers["access-control-allow-origin"] == "http://localhost:3000"

    def test_env_var_overrides_allowed_origins(self, store: Store, monkeypatch):
        monkeypatch.setenv(
            "MAPENCROACH_CORS_ORIGINS",
            "https://mapencroach.vercel.app, http://localhost:3000",
        )
        app_client = TestClient(create_app(store))

        resp = self._preflight(app_client, "https://mapencroach.vercel.app")
        assert resp.status_code == 200
        assert (
            resp.headers["access-control-allow-origin"] == "https://mapencroach.vercel.app"
        )
        # Whitespace around commas is tolerated.
        resp = self._preflight(app_client, "http://localhost:3000")
        assert resp.headers["access-control-allow-origin"] == "http://localhost:3000"

    def test_env_var_replaces_default_rather_than_extending_it(
        self, store: Store, monkeypatch
    ):
        monkeypatch.setenv("MAPENCROACH_CORS_ORIGINS", "https://console.example.gov")
        app_client = TestClient(create_app(store))
        resp = self._preflight(app_client, "http://localhost:3000")
        assert "access-control-allow-origin" not in resp.headers


class TestRequiredArtifactsInCaseDetail:
    """GET /cases/{id} maps every allowed transition to the evidence it
    needs, so a UI can render the right form fields without duplicating
    domain knowledge."""

    def test_case_detail_includes_required_artifacts(
        self, client: TestClient, state_token: str
    ):
        resp = client.get("/cases/case-1", headers=auth_headers(state_token))
        assert resp.status_code == 200
        body = resp.json()
        assert set(body["required_artifacts"].keys()) == set(body["allowed_transitions"])
        assert body["required_artifacts"]["RESPONSE_WINDOW"] == []
        assert body["required_artifacts"]["DISMISSED_FALSE_POSITIVE"] == ["dismissal_reason"]

    def test_transition_response_includes_required_artifacts(
        self, client: TestClient, store: Store
    ):
        officer_token = token_for(
            "case-officer-req", Role.CASE_OFFICER, store.root_jurisdiction_id
        )
        resp = client.post(
            "/cases/case-1/transitions",
            headers=auth_headers(officer_token),
            json={"to_state": "RESPONSE_WINDOW"},
        )
        assert resp.status_code == 201
        body = resp.json()
        assert set(body["required_artifacts"].keys()) == set(body["allowed_transitions"])
        assert body["required_artifacts"]["HEARING_SCHEDULED"] == ["hearing_date"]


class TestParcelTags:
    """Tags are officer-curated labels on parcels: validated, deduplicated,
    jurisdiction-scoped, and audited like every other mutation."""

    def test_feature_properties_include_seeded_tags(
        self, client: TestClient, state_token: str
    ):
        resp = client.get("/parcels/parcel-1", headers=auth_headers(state_token))
        assert resp.status_code == 200
        assert resp.json()["properties"]["tags"] == ["court-monitored"]

    def test_case_officer_adds_tag(self, client: TestClient, state_token: str):
        resp = client.post(
            "/parcels/parcel-2/tags",
            headers=auth_headers(state_token),
            json={"tag": "eviction-planned"},
        )
        assert resp.status_code == 201
        assert "eviction-planned" in resp.json()["properties"]["tags"]
        # Persisted, not just echoed.
        again = client.get("/parcels/parcel-2", headers=auth_headers(state_token))
        assert "eviction-planned" in again.json()["properties"]["tags"]

    def test_add_is_idempotent_and_normalizes_case(
        self, client: TestClient, state_token: str
    ):
        for raw in ["High-Priority", "  high-priority  ", "high-priority"]:
            resp = client.post(
                "/parcels/parcel-2/tags",
                headers=auth_headers(state_token),
                json={"tag": raw},
            )
            assert resp.status_code in (200, 201)
        tags = resp.json()["properties"]["tags"]
        assert tags.count("high-priority") == 1

    def test_invalid_tag_is_422(self, client: TestClient, state_token: str):
        for bad in ["", "Not Valid!!", "-leading-hyphen", "x" * 60]:
            resp = client.post(
                "/parcels/parcel-2/tags",
                headers=auth_headers(state_token),
                json={"tag": bad},
            )
            assert resp.status_code == 422, bad

    def test_viewer_cannot_tag(self, client: TestClient, store: Store):
        viewer = token_for("viewer-1", Role.VIEWER, store.root_jurisdiction_id)
        resp = client.post(
            "/parcels/parcel-2/tags",
            headers=auth_headers(viewer),
            json={"tag": "sneaky"},
        )
        assert resp.status_code == 403

    def test_out_of_scope_parcel_is_404(self, client: TestClient, store: Store):
        # parcel-1 is in dist-a; a dist-b officer must not learn it exists.
        officer_b = token_for("officer-b", Role.CASE_OFFICER, store.district_b_id)
        resp = client.post(
            "/parcels/parcel-1/tags",
            headers=auth_headers(officer_b),
            json={"tag": "anything"},
        )
        assert resp.status_code == 404

    def test_delete_tag(self, client: TestClient, state_token: str):
        resp = client.delete(
            "/parcels/parcel-1/tags/court-monitored", headers=auth_headers(state_token)
        )
        assert resp.status_code == 200
        assert "court-monitored" not in resp.json()["properties"]["tags"]

    def test_delete_absent_tag_is_404(self, client: TestClient, state_token: str):
        resp = client.delete(
            "/parcels/parcel-2/tags/never-was", headers=auth_headers(state_token)
        )
        assert resp.status_code == 404

    def test_tag_mutations_are_audited(self, client: TestClient, store: Store, state_token: str):
        before = len(store.audit_chain)
        client.post(
            "/parcels/parcel-2/tags",
            headers=auth_headers(state_token),
            json={"tag": "audited-tag"},
        )
        client.delete(
            "/parcels/parcel-2/tags/audited-tag", headers=auth_headers(state_token)
        )
        assert len(store.audit_chain) == before + 2
        assert verify_chain(store.audit_chain).ok


class TestDemoPersonas:
    """Demo persona endpoints exist only when MAPENCROACH_DEMO=1, so
    production deployments never expose a token-minting surface."""

    def test_endpoints_absent_outside_demo_mode(self, store: Store, monkeypatch):
        monkeypatch.delenv("MAPENCROACH_DEMO", raising=False)
        app_client = TestClient(create_app(store))
        assert app_client.get("/demo/personas").status_code == 404
        assert (
            app_client.post("/demo/login", json={"persona_id": "vc-hrda"}).status_code
            == 404
        )

    def _demo_client(self, store: Store, monkeypatch) -> TestClient:
        # Demo mode always signs with the dev default secret and refuses to
        # start next to a custom one, so drop the autouse test secret here.
        monkeypatch.delenv("MAPENCROACH_JWT_SECRET", raising=False)
        monkeypatch.setenv("MAPENCROACH_DEMO", "1")
        return TestClient(create_app(store))

    def test_personas_listed_without_secrets(self, store: Store, monkeypatch):
        app_client = self._demo_client(store, monkeypatch)
        resp = app_client.get("/demo/personas")
        assert resp.status_code == 200
        personas = resp.json()
        assert len(personas) >= 4
        for p in personas:
            assert {"id", "name", "role", "jurisdiction_id", "description"} <= set(p)
            assert "token" not in p and "secret" not in p

    def test_login_returns_working_scoped_token(self, store: Store, monkeypatch):
        app_client = self._demo_client(store, monkeypatch)
        resp = app_client.post("/demo/login", json={"persona_id": "eo-haridwar"})
        assert resp.status_code == 200
        body = resp.json()
        token = body["token"]
        assert body["persona"]["id"] == "eo-haridwar"
        parcels = app_client.get("/parcels", headers=auth_headers(token))
        assert parcels.status_code == 200
        features = parcels.json()["features"]
        # dist-a scope: exactly the Haridwar-side parcels are visible.
        expected = sum(
            1 for p in store.parcels.values() if p["jurisdiction_id"] in store.dist_a_scope
        )
        assert len(features) == expected
        assert 0 < expected < len(store.parcels)

    def test_viewer_persona_reads_but_cannot_mutate(self, store: Store, monkeypatch):
        app_client = self._demo_client(store, monkeypatch)
        token = app_client.post(
            "/demo/login", json={"persona_id": "vc-hrda"}
        ).json()["token"]
        assert (
            len(app_client.get("/parcels", headers=auth_headers(token)).json()["features"])
            == len(store.parcels)
        )
        resp = app_client.post(
            "/parcels/parcel-1/tags",
            headers=auth_headers(token),
            json={"tag": "nope"},
        )
        assert resp.status_code == 403

    def test_unknown_persona_is_404(self, store: Store, monkeypatch):
        app_client = self._demo_client(store, monkeypatch)
        resp = app_client.post("/demo/login", json={"persona_id": "ghost"})
        assert resp.status_code == 404


class TestExpandedSeed:
    """The demo seed is rich enough to make scoping and the case rail
    interesting: 6 named taluks, 30 parcels, alerts across every tier and
    status, cases including paused states — with the original protagonist
    parcels/cases byte-identical so the demo script stays true."""

    def test_thirty_parcels_five_per_taluk(self, store: Store):
        assert len(store.parcels) == 30
        by_taluk: dict[str, int] = {}
        for p in store.parcels.values():
            by_taluk[p["jurisdiction_id"]] = by_taluk.get(p["jurisdiction_id"], 0) + 1
        assert set(by_taluk) == {
            "taluk-a1", "taluk-a2", "taluk-a3", "taluk-b1", "taluk-b2", "taluk-b3"
        }
        assert all(count == 5 for count in by_taluk.values()), by_taluk

    def test_all_parcels_inside_corridor_bbox(self, store: Store):
        for p in store.parcels.values():
            ring = p["geometry"]["coordinates"][0]
            lon = sum(pt[0] for pt in ring[:-1]) / 4
            lat = sum(pt[1] for pt in ring[:-1]) / 4
            assert 77.80 <= lon <= 78.30 and 29.80 <= lat <= 30.02, (p["id"], lon, lat)

    def test_protagonist_parcels_unchanged(self, store: Store):
        p1 = store.parcels["parcel-1"]
        assert p1["land_category"] == "waterbody"
        assert p1["boundary_grade"] == "A"
        assert p1["tags"] == ["court-monitored"]
        assert p1["jurisdiction_id"] == "taluk-a1"
        assert p1["owning_department"] == "Irrigation Department, Uttarakhand"
        p7 = store.parcels["parcel-7"]
        assert p7["tags"] == ["legacy-review"]

    def test_alert_variety(self, store: Store):
        assert len(store.alerts) >= 10
        tiers = {a["tier"] for a in store.alerts.values()}
        assert tiers == {"RED", "AMBER", "GREEN", "LEGACY"}
        statuses = {a["status"] for a in store.alerts.values()}
        assert {"OPEN", "UNDER_REVIEW", "ESCALATED"} <= statuses
        # Original red alert untouched.
        assert store.alerts["alert-1"]["parcel_id"] == "parcel-1"
        assert store.alerts["alert-1"]["severity_score"] == 60.0

    def test_case_variety_including_paused_states(self, store: Store):
        assert len(store.cases) == 5
        states = {r.case.state.value for r in store.cases.values()}
        assert {"SHOW_CAUSE_ISSUED", "CLOSED", "STAYED_BY_COURT",
                "SURVEY_REQUESTED", "RESPONSE_WINDOW"} <= states
        assert store.cases["case-1"].case.state.value == "SHOW_CAUSE_ISSUED"
        assert store.cases["case-2"].case.state.value == "CLOSED"
        # Paused cases remember where to resume.
        paused = [r for r in store.cases.values()
                  if r.case.state.value in ("STAYED_BY_COURT", "SURVEY_REQUESTED")]
        assert len(paused) == 2
        assert all(r.case.paused_state is not None for r in paused)


class TestJurisdictionNames:
    def test_parcel_properties_include_jurisdiction_name(
        self, client: TestClient, state_token: str
    ):
        resp = client.get("/parcels/parcel-1", headers=auth_headers(state_token))
        assert resp.json()["properties"]["jurisdiction_name"] == "Haridwar City"

    def test_all_seed_jurisdictions_have_names(self, store: Store):
        from mapencroach.api.store import JURISDICTION_NAMES

        for jid, _parent in store.jurisdiction_rows:
            assert jid in JURISDICTION_NAMES, jid
        assert JURISDICTION_NAMES["state"].startswith("Haridwar")


class TestPersonaEnrichment:
    def _demo_client(self, store: Store, monkeypatch) -> TestClient:
        # Demo mode always signs with the dev default secret and refuses to
        # start next to a custom one, so drop the autouse test secret here.
        monkeypatch.delenv("MAPENCROACH_JWT_SECRET", raising=False)
        monkeypatch.setenv("MAPENCROACH_DEMO", "1")
        return TestClient(create_app(store))

    def test_personas_carry_live_visibility_and_capabilities(
        self, store: Store, monkeypatch
    ):
        app_client = self._demo_client(store, monkeypatch)
        personas = app_client.get("/demo/personas").json()
        assert len(personas) >= 5
        for p in personas:
            scope = store.tree.scope_ids(p["jurisdiction_id"])
            expected = sum(
                1 for parcel in store.parcels.values() if parcel["jurisdiction_id"] in scope
            )
            assert p["visible_parcels"] == expected, p["id"]
            assert p["jurisdiction_name"]
            assert isinstance(p["capabilities"], list) and p["capabilities"]

    def test_taluk_persona_sees_exactly_its_taluk(self, store: Store, monkeypatch):
        app_client = self._demo_client(store, monkeypatch)
        token = app_client.post(
            "/demo/login", json={"persona_id": "co-roorkee-city"}
        ).json()["token"]
        features = app_client.get(
            "/parcels", headers=auth_headers(token)
        ).json()["features"]
        assert len(features) == 5
        assert all(f["properties"]["jurisdiction_id"] == "taluk-b1" for f in features)


class TestCasesListStateSince:
    def test_state_since_matches_last_event(self, client: TestClient, state_token: str):
        cases = client.get("/cases", headers=auth_headers(state_token)).json()
        assert len(cases) == 5
        for summary in cases:
            detail = client.get(
                f"/cases/{summary['id']}", headers=auth_headers(state_token)
            ).json()
            assert summary["state_since"] == detail["events"][-1]["occurred_at"]


class TestSecretFailsClosed:
    """create_app refuses to start rather than silently sign tokens with a
    secret nobody chose - see mapencroach.api.auth.validate_secret_config."""

    def test_missing_secret_outside_demo_mode_refuses_to_start(
        self, store: Store, monkeypatch
    ):
        monkeypatch.delenv("MAPENCROACH_JWT_SECRET", raising=False)
        monkeypatch.delenv("MAPENCROACH_DEMO", raising=False)
        with pytest.raises(RuntimeError, match="MAPENCROACH_JWT_SECRET"):
            create_app(store)

    def test_dev_default_secret_outside_demo_mode_refuses_to_start(
        self, store: Store, monkeypatch
    ):
        monkeypatch.setenv("MAPENCROACH_JWT_SECRET", "dev-secret-do-not-deploy")
        monkeypatch.delenv("MAPENCROACH_DEMO", raising=False)
        with pytest.raises(RuntimeError, match="MAPENCROACH_JWT_SECRET"):
            create_app(store)

    def test_empty_secret_outside_demo_mode_refuses_to_start(
        self, store: Store, monkeypatch
    ):
        monkeypatch.setenv("MAPENCROACH_JWT_SECRET", "")
        monkeypatch.delenv("MAPENCROACH_DEMO", raising=False)
        with pytest.raises(RuntimeError, match="MAPENCROACH_JWT_SECRET"):
            create_app(store)

    def test_custom_secret_outside_demo_mode_starts_cleanly(
        self, store: Store, monkeypatch
    ):
        monkeypatch.setenv("MAPENCROACH_JWT_SECRET", "a-real-nondefault-secret")
        monkeypatch.delenv("MAPENCROACH_DEMO", raising=False)
        app = create_app(store)
        assert app is not None

    def test_demo_mode_with_custom_secret_refuses_to_start(
        self, store: Store, monkeypatch
    ):
        monkeypatch.setenv("MAPENCROACH_JWT_SECRET", "a-real-production-secret")
        monkeypatch.setenv("MAPENCROACH_DEMO", "1")
        with pytest.raises(RuntimeError, match="cannot be combined"):
            create_app(store)

    def test_demo_mode_without_custom_secret_warns_loudly_and_starts(
        self, store: Store, monkeypatch
    ):
        monkeypatch.delenv("MAPENCROACH_JWT_SECRET", raising=False)
        monkeypatch.setenv("MAPENCROACH_DEMO", "1")
        with pytest.warns(UserWarning, match="demo"):
            app = create_app(store)
        assert app is not None


class TestTokenClaimsHardened:
    """Tokens must carry an exp claim (so a forged token can't be a
    non-expiring credential) and jurisdiction_id must name a jurisdiction
    the tree actually knows about."""

    def test_token_without_exp_is_401(self, client: TestClient, store: Store):
        import jwt as pyjwt

        from mapencroach.api import auth as auth_module

        payload = {
            "sub": "no-exp-user",
            "role": "viewer",
            "jurisdiction_id": store.root_jurisdiction_id,
            "iss": auth_module._ISSUER,
            "aud": auth_module._AUDIENCE,
        }
        forever_token = pyjwt.encode(payload, SECRET, algorithm="HS256")
        resp = client.get("/parcels", headers=auth_headers(forever_token))
        assert resp.status_code == 401

    def test_unknown_jurisdiction_claim_is_401_not_500(
        self, client: TestClient, store: Store
    ):
        import jwt as pyjwt

        from mapencroach.api import auth as auth_module

        payload = {
            "sub": "ghost-user",
            "role": "viewer",
            "jurisdiction_id": "not-a-real-jurisdiction",
            "exp": datetime.now(UTC) + timedelta(hours=1),
            "iss": auth_module._ISSUER,
            "aud": auth_module._AUDIENCE,
        }
        bad = pyjwt.encode(payload, SECRET, algorithm="HS256")
        resp = client.get("/parcels", headers=auth_headers(bad))
        assert resp.status_code == 401

    def test_non_string_jurisdiction_claim_is_401(self, client: TestClient):
        import jwt as pyjwt

        from mapencroach.api import auth as auth_module

        payload = {
            "sub": "weird-claim-user",
            "role": "viewer",
            "jurisdiction_id": 12345,
            "exp": datetime.now(UTC) + timedelta(hours=1),
            "iss": auth_module._ISSUER,
            "aud": auth_module._AUDIENCE,
        }
        bad = pyjwt.encode(payload, SECRET, algorithm="HS256")
        resp = client.get("/parcels", headers=auth_headers(bad))
        assert resp.status_code == 401


class TestHealthEndpoint:
    def test_health_is_unauthenticated_and_ok(self, client: TestClient):
        resp = client.get("/health")
        assert resp.status_code == 200
        assert resp.json() == {"status": "ok"}


class TestListPagination:
    """/parcels, /alerts and /cases stay plain JSON arrays (or, for
    /parcels, a GeoJSON FeatureCollection) - pagination is limit/offset
    query params plus an X-Total-Count header, never a response envelope."""

    def test_parcels_default_page_covers_whole_seed_and_reports_total(
        self, client: TestClient, state_token: str, store: Store
    ):
        resp = client.get("/parcels", headers=auth_headers(state_token))
        assert resp.status_code == 200
        assert resp.headers["X-Total-Count"] == str(len(store.parcels))
        assert isinstance(resp.json()["features"], list)
        assert len(resp.json()["features"]) == len(store.parcels)

    def test_parcels_limit_and_offset_slice_in_stable_order(
        self, client: TestClient, state_token: str, store: Store
    ):
        full = client.get("/parcels", headers=auth_headers(state_token)).json()["features"]
        resp = client.get(
            "/parcels", params={"limit": 5, "offset": 10}, headers=auth_headers(state_token)
        )
        assert resp.status_code == 200
        assert resp.headers["X-Total-Count"] == str(len(store.parcels))
        page = resp.json()["features"]
        assert len(page) == 5
        assert [f["properties"]["id"] for f in page] == [
            f["properties"]["id"] for f in full[10:15]
        ]

    def test_parcels_limit_above_hard_max_is_422(self, client: TestClient, state_token: str):
        resp = client.get(
            "/parcels", params={"limit": 1001}, headers=auth_headers(state_token)
        )
        assert resp.status_code == 422

    def test_parcels_limit_zero_is_422(self, client: TestClient, state_token: str):
        resp = client.get("/parcels", params={"limit": 0}, headers=auth_headers(state_token))
        assert resp.status_code == 422

    def test_parcels_negative_offset_is_422(self, client: TestClient, state_token: str):
        resp = client.get(
            "/parcels", params={"offset": -1}, headers=auth_headers(state_token)
        )
        assert resp.status_code == 422

    def test_alerts_stay_a_plain_array_and_paginate(
        self, client: TestClient, state_token: str, store: Store
    ):
        resp = client.get(
            "/alerts", params={"limit": 3, "offset": 2}, headers=auth_headers(state_token)
        )
        assert resp.status_code == 200
        assert isinstance(resp.json(), list)
        assert resp.headers["X-Total-Count"] == str(len(store.alerts))
        assert len(resp.json()) == 3

    def test_alerts_total_count_reflects_the_filtered_set(
        self, client: TestClient, state_token: str, store: Store
    ):
        red_count = sum(1 for a in store.alerts.values() if a["tier"] == "RED")
        resp = client.get("/alerts", params={"tier": "RED"}, headers=auth_headers(state_token))
        assert resp.status_code == 200
        assert resp.headers["X-Total-Count"] == str(red_count)
        assert len(resp.json()) == red_count

    def test_cases_stay_a_plain_array_and_paginate(
        self, client: TestClient, state_token: str, store: Store
    ):
        resp = client.get("/cases", params={"limit": 2}, headers=auth_headers(state_token))
        assert resp.status_code == 200
        assert isinstance(resp.json(), list)
        assert resp.headers["X-Total-Count"] == str(len(store.cases))
        assert len(resp.json()) == 2


class TestCaseTransitionLegalGating:
    """Transitions into a legally-significant state (a hearing actually
    held, an order issued, or the case ending) require Role.LEGAL_OFFICER
    or Role.SYSTEM_ADMIN; ordinary triage/survey/notice transitions stay
    with Role.CASE_OFFICER."""

    def _advance_to_hearing_scheduled(self, client: TestClient, store: Store):
        case_id = next(
            cid for cid, c in store.cases.items() if c.case.state.value == "SHOW_CAUSE_ISSUED"
        )
        case = store.cases[case_id]
        officer = token_for("gating-officer", Role.CASE_OFFICER, case.jurisdiction_id)
        resp1 = client.post(
            f"/cases/{case_id}/transitions",
            headers=auth_headers(officer),
            json={"to_state": "RESPONSE_WINDOW"},
        )
        assert resp1.status_code == 201
        resp2 = client.post(
            f"/cases/{case_id}/transitions",
            headers=auth_headers(officer),
            json={"to_state": "HEARING_SCHEDULED", "artifacts": {"hearing_date": "2026-08-01"}},
        )
        assert resp2.status_code == 201
        return case_id, case

    def test_case_officer_cannot_record_a_hearing_as_held(
        self, client: TestClient, store: Store
    ):
        case_id, case = self._advance_to_hearing_scheduled(client, store)
        officer = token_for("gating-officer-2", Role.CASE_OFFICER, case.jurisdiction_id)
        resp = client.post(
            f"/cases/{case_id}/transitions",
            headers=auth_headers(officer),
            json={"to_state": "HEARING_HELD", "artifacts": {"hearing_record": "hr.pdf"}},
        )
        assert resp.status_code == 403
        assert "legal authority" in resp.json()["detail"]

    def test_legal_officer_can_record_a_hearing_as_held(
        self, client: TestClient, store: Store
    ):
        case_id, case = self._advance_to_hearing_scheduled(client, store)
        legal_officer = token_for("legal-gating-1", Role.LEGAL_OFFICER, case.jurisdiction_id)
        resp = client.post(
            f"/cases/{case_id}/transitions",
            headers=auth_headers(legal_officer),
            json={"to_state": "HEARING_HELD", "artifacts": {"hearing_record": "hr.pdf"}},
        )
        assert resp.status_code == 201
        assert resp.json()["to_state"] == "HEARING_HELD"

    def test_system_admin_can_record_a_hearing_as_held(
        self, client: TestClient, store: Store
    ):
        case_id, case = self._advance_to_hearing_scheduled(client, store)
        admin = token_for("admin-gating-1", Role.SYSTEM_ADMIN, case.jurisdiction_id)
        resp = client.post(
            f"/cases/{case_id}/transitions",
            headers=auth_headers(admin),
            json={"to_state": "HEARING_HELD", "artifacts": {"hearing_record": "hr.pdf"}},
        )
        assert resp.status_code == 201

    def test_case_officer_cannot_unilaterally_close_a_case(
        self, client: TestClient, store: Store
    ):
        case_id = next(
            cid for cid, c in store.cases.items() if c.case.state.value == "SHOW_CAUSE_ISSUED"
        )
        case = store.cases[case_id]
        officer = token_for("gating-officer-3", Role.CASE_OFFICER, case.jurisdiction_id)
        resp = client.post(
            f"/cases/{case_id}/transitions",
            headers=auth_headers(officer),
            json={"to_state": "CLOSED"},
        )
        assert resp.status_code == 403


class TestAlertCreateValidation:
    """AlertCreate validates tier against the AlertTier enum and requires a
    finite, non-negative area_m2, instead of accepting any string/float."""

    def test_invalid_tier_is_422(self, client: TestClient, state_token: str, store: Store):
        parcel_id = next(iter(store.parcels))
        resp = client.post(
            "/alerts",
            headers=auth_headers(state_token),
            json={
                "parcel_id": parcel_id,
                "tier": "ORANGE",
                "area_m2": 100,
                "detected_at": datetime.now(UTC).isoformat(),
            },
        )
        assert resp.status_code == 422

    def test_negative_area_is_422(self, client: TestClient, state_token: str, store: Store):
        parcel_id = next(iter(store.parcels))
        resp = client.post(
            "/alerts",
            headers=auth_headers(state_token),
            json={
                "parcel_id": parcel_id,
                "tier": "AMBER",
                "area_m2": -5,
                "detected_at": datetime.now(UTC).isoformat(),
            },
        )
        assert resp.status_code == 422

    def test_non_finite_area_is_rejected_by_the_model(self):
        # Exercised at the model level rather than over HTTP: a literal
        # "Infinity" body makes FastAPI's own 422 error response try (and
        # fail) to re-embed the offending inf value as JSON, which is a
        # framework-level footgun unrelated to this validator. The
        # allow_inf_nan=False constraint itself is what finding 8 asks for,
        # and this is what actually exercises it.
        from pydantic import ValidationError

        with pytest.raises(ValidationError):
            AlertCreate(
                parcel_id="parcel-1",
                tier=AlertTier.AMBER,
                area_m2=float("inf"),
                detected_at=datetime.now(UTC),
            )

    def test_valid_tier_and_area_still_create_an_alert(
        self, client: TestClient, state_token: str, store: Store
    ):
        parcel_id = next(iter(store.parcels))
        resp = client.post(
            "/alerts",
            headers=auth_headers(state_token),
            json={
                "parcel_id": parcel_id,
                "tier": "RED",
                "area_m2": 1234.5,
                "detected_at": datetime.now(UTC).isoformat(),
            },
        )
        assert resp.status_code == 201
        assert resp.json()["tier"] == "RED"


class TestCorsWildcardRejected:
    def test_wildcard_origin_with_credentials_refuses_to_start(
        self, store: Store, monkeypatch
    ):
        monkeypatch.setenv("MAPENCROACH_CORS_ORIGINS", "*")
        with pytest.raises(RuntimeError, match="CORS_ORIGINS"):
            create_app(store)

    def test_wildcard_among_multiple_origins_also_refuses(
        self, store: Store, monkeypatch
    ):
        monkeypatch.setenv("MAPENCROACH_CORS_ORIGINS", "https://example.gov, *")
        with pytest.raises(RuntimeError, match="CORS_ORIGINS"):
            create_app(store)


class TestStoreConcurrencySafety:
    """Sync endpoints run in FastAPI's threadpool, so concurrent requests
    against one Store must not fork the audit hash chain or collide on
    allocated ids."""

    def test_concurrent_alert_creation_has_unique_ids_and_a_valid_chain(
        self, client: TestClient, state_token: str, store: Store
    ):
        import concurrent.futures

        parcel_id = next(iter(store.parcels))

        def _create(_i: int):
            return client.post(
                "/alerts",
                headers=auth_headers(state_token),
                json={
                    "parcel_id": parcel_id,
                    "tier": "GREEN",
                    "area_m2": 10,
                    "detected_at": datetime.now(UTC).isoformat(),
                },
            )

        with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
            responses = list(pool.map(_create, range(40)))

        assert all(r.status_code == 201 for r in responses)
        ids = [r.json()["id"] for r in responses]
        assert len(ids) == len(set(ids))
        assert verify_chain(store.audit_chain).ok


class TestCaseTransfer:
    """POST /cases/{id}/transfer hands a case to a different jurisdiction --
    the handover use case (e.g. dist-a officer -> dist-b officer). Transfers
    out of the caller's own scope are allowed by design; the caller simply
    loses visibility afterwards, same as any other out-of-scope resource."""

    def test_transfer_within_scope_updates_jurisdiction(
        self, client: TestClient, dist_a_token: str, store: Store
    ):
        case_id = next(
            cid for cid, c in store.cases.items() if c.jurisdiction_id == "taluk-a1"
        )
        resp = client.post(
            f"/cases/{case_id}/transfer",
            headers=auth_headers(dist_a_token),
            json={"to_jurisdiction_id": "taluk-a2", "reason": "workload rebalance"},
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["id"] == case_id
        assert body["jurisdiction_id"] == "taluk-a2"
        assert store.cases[case_id].jurisdiction_id == "taluk-a2"

        # Still visible: taluk-a2 is inside the caller's dist-a scope.
        follow_up = client.get(f"/cases/{case_id}", headers=auth_headers(dist_a_token))
        assert follow_up.status_code == 200

    def test_cross_district_handover_then_caller_404s(
        self, client: TestClient, dist_a_token: str, store: Store
    ):
        case_id = next(
            cid for cid, c in store.cases.items() if c.jurisdiction_id == "taluk-a1"
        )
        resp = client.post(
            f"/cases/{case_id}/transfer",
            headers=auth_headers(dist_a_token),
            json={"to_jurisdiction_id": "taluk-b1", "reason": "handover to Roorkee"},
        )
        assert resp.status_code == 200
        assert store.cases[case_id].jurisdiction_id == "taluk-b1"

        follow_up = client.get(f"/cases/{case_id}", headers=auth_headers(dist_a_token))
        assert follow_up.status_code == 404

    def test_out_of_scope_case_is_404(self, client: TestClient, store: Store):
        case_id = next(
            cid for cid, c in store.cases.items() if c.jurisdiction_id in store.dist_a_scope
        )
        officer_b = token_for("officer-b-transfer", Role.CASE_OFFICER, store.district_b_id)
        resp = client.post(
            f"/cases/{case_id}/transfer",
            headers=auth_headers(officer_b),
            json={"to_jurisdiction_id": store.district_b_id, "reason": "trying to grab"},
        )
        assert resp.status_code == 404

    def test_unknown_case_is_404(self, client: TestClient, dist_a_token: str):
        resp = client.post(
            "/cases/no-such-case/transfer",
            headers=auth_headers(dist_a_token),
            json={"to_jurisdiction_id": "taluk-a2", "reason": "n/a"},
        )
        assert resp.status_code == 404

    def test_unknown_target_jurisdiction_is_400(
        self, client: TestClient, dist_a_token: str, store: Store
    ):
        case_id = next(
            cid for cid, c in store.cases.items() if c.jurisdiction_id in store.dist_a_scope
        )
        resp = client.post(
            f"/cases/{case_id}/transfer",
            headers=auth_headers(dist_a_token),
            json={"to_jurisdiction_id": "not-a-real-place", "reason": "typo target"},
        )
        assert resp.status_code == 400

    def test_same_target_jurisdiction_is_400(
        self, client: TestClient, dist_a_token: str, store: Store
    ):
        case_id = next(
            cid for cid, c in store.cases.items() if c.jurisdiction_id == "taluk-a1"
        )
        resp = client.post(
            f"/cases/{case_id}/transfer",
            headers=auth_headers(dist_a_token),
            json={"to_jurisdiction_id": "taluk-a1", "reason": "no-op"},
        )
        assert resp.status_code == 400

    def test_viewer_cannot_transfer(self, client: TestClient, viewer_token: str, store: Store):
        case_id = next(iter(store.cases))
        resp = client.post(
            f"/cases/{case_id}/transfer",
            headers=auth_headers(viewer_token),
            json={"to_jurisdiction_id": store.district_b_id, "reason": "nope"},
        )
        assert resp.status_code == 403

    def test_survey_officer_cannot_transfer(
        self, client: TestClient, survey_officer_dist_a_token: str, store: Store
    ):
        case_id = next(
            cid for cid, c in store.cases.items() if c.jurisdiction_id in store.dist_a_scope
        )
        resp = client.post(
            f"/cases/{case_id}/transfer",
            headers=auth_headers(survey_officer_dist_a_token),
            json={"to_jurisdiction_id": store.district_b_id, "reason": "nope"},
        )
        assert resp.status_code == 403

    def test_blank_reason_is_422(self, client: TestClient, dist_a_token: str, store: Store):
        case_id = next(
            cid for cid, c in store.cases.items() if c.jurisdiction_id in store.dist_a_scope
        )
        resp = client.post(
            f"/cases/{case_id}/transfer",
            headers=auth_headers(dist_a_token),
            json={"to_jurisdiction_id": "taluk-a2", "reason": "   "},
        )
        assert resp.status_code == 422

    def test_transfer_is_audited_and_chain_verifies(
        self, client: TestClient, dist_a_token: str, store: Store
    ):
        case_id = next(
            cid for cid, c in store.cases.items() if c.jurisdiction_id == "taluk-a1"
        )
        before = len(store.audit_chain)
        resp = client.post(
            f"/cases/{case_id}/transfer",
            headers=auth_headers(dist_a_token),
            json={"to_jurisdiction_id": "taluk-a2", "reason": "workload rebalance"},
        )
        assert resp.status_code == 200
        assert len(store.audit_chain) == before + 1
        entry = store.audit_chain[-1]
        assert entry.payload["action"] == "case.transfer"
        assert entry.payload["object_type"] == "case"
        assert entry.payload["object_id"] == case_id
        assert entry.payload["from_jurisdiction_id"] == "taluk-a1"
        assert entry.payload["to_jurisdiction_id"] == "taluk-a2"
        assert entry.payload["reason"] == "workload rebalance"
        assert verify_chain(store.audit_chain).ok


class TestJurisdictions:
    """GET /jurisdictions is administrative reference data (the full tree,
    not scoped to the caller) used to populate handover-target pickers --
    any authenticated role may read it, since choosing a transfer target
    requires seeing jurisdictions outside one's own scope."""

    def test_returns_full_tree_in_stored_row_order(
        self, client: TestClient, dist_a_token: str, store: Store
    ):
        resp = client.get("/jurisdictions", headers=auth_headers(dist_a_token))
        assert resp.status_code == 200
        body = resp.json()
        assert len(body) == len(store.jurisdiction_rows)
        assert [(row["id"], row["parent_id"]) for row in body] == list(
            store.jurisdiction_rows
        )
        for row in body:
            assert set(row) == {"id", "name", "parent_id"}

    def test_names_come_from_jurisdiction_names_map(
        self, client: TestClient, state_token: str
    ):
        resp = client.get("/jurisdictions", headers=auth_headers(state_token))
        assert resp.status_code == 200
        by_id = {row["id"]: row for row in resp.json()}
        assert by_id["dist-a"]["name"] == JURISDICTION_NAMES["dist-a"]
        assert by_id["state"]["parent_id"] is None
        assert by_id["dist-a"]["parent_id"] == "state"

    def test_unknown_id_falls_back_to_the_raw_id(self, client: TestClient, state_token: str):
        store = Store(
            jurisdiction_rows=[("state", None), ("mystery-node", "state")],
            root_jurisdiction_id="state",
        )
        app = create_app(store)
        local_client = TestClient(app)
        token = token_for("state-user", Role.DATA_ADMIN, "state")
        resp = local_client.get("/jurisdictions", headers=auth_headers(token))
        assert resp.status_code == 200
        by_id = {row["id"]: row for row in resp.json()}
        assert by_id["mystery-node"]["name"] == "mystery-node"

    def test_unauthenticated_is_401(self, client: TestClient):
        resp = client.get("/jurisdictions")
        assert resp.status_code == 401


class TestImageryScenes:
    """POST /imagery/scenes wires the dormant SceneRegistry: hash-on-ingest
    evidence intake. Scenes are jurisdiction-agnostic evidence objects, so
    GET is open to any authenticated role -- no scoping applies."""

    def _payload(self, **overrides: object) -> dict[str, object]:
        payload: dict[str, object] = {
            "scene_id": "scene-alpha",
            "captured_at": datetime(2026, 1, 1, tzinfo=UTC).isoformat(),
            "sensor": "sentinel-2",
            "resolution_m": 10.0,
            "cloud_pct": 5.0,
            "source": "copernicus",
            "href": "https://example.com/scene-alpha.tif",
            "data_base64": base64.b64encode(b"fake-scene-bytes").decode(),
        }
        payload.update(overrides)
        return payload

    def test_ingest_and_fetch_round_trip(self, client: TestClient, state_token: str):
        raw = b"fake-scene-bytes"
        resp = client.post(
            "/imagery/scenes",
            headers=auth_headers(state_token),
            json=self._payload(data_base64=base64.b64encode(raw).decode()),
        )
        assert resp.status_code == 201
        body = resp.json()
        assert body["scene_id"] == "scene-alpha"
        assert body["sha256"] == hashlib.sha256(raw).hexdigest()
        assert body["sensor"] == "sentinel-2"
        assert body["resolution_m"] == 10.0
        assert body["cloud_pct"] == 5.0
        assert body["source"] == "copernicus"
        assert "stac_item" in body
        assert "data_base64" not in body
        assert "data" not in body

        get_resp = client.get(
            "/imagery/scenes/scene-alpha", headers=auth_headers(state_token)
        )
        assert get_resp.status_code == 200
        assert get_resp.json() == body

    def test_duplicate_scene_is_409(self, client: TestClient, state_token: str):
        first = client.post(
            "/imagery/scenes", headers=auth_headers(state_token), json=self._payload()
        )
        assert first.status_code == 201
        resp = client.post(
            "/imagery/scenes", headers=auth_headers(state_token), json=self._payload()
        )
        assert resp.status_code == 409
        assert resp.json()["detail"]

    def test_invalid_base64_is_422(self, client: TestClient, state_token: str):
        resp = client.post(
            "/imagery/scenes",
            headers=auth_headers(state_token),
            json=self._payload(data_base64="not-valid-base64!!!"),
        )
        assert resp.status_code == 422

    def test_empty_base64_is_422(self, client: TestClient, state_token: str):
        resp = client.post(
            "/imagery/scenes",
            headers=auth_headers(state_token),
            json=self._payload(data_base64=""),
        )
        assert resp.status_code == 422

    def test_viewer_cannot_post_but_can_get(
        self, client: TestClient, state_token: str, viewer_token: str
    ):
        seed = client.post(
            "/imagery/scenes", headers=auth_headers(state_token), json=self._payload()
        )
        assert seed.status_code == 201

        post_resp = client.post(
            "/imagery/scenes",
            headers=auth_headers(viewer_token),
            json=self._payload(scene_id="scene-viewer-blocked"),
        )
        assert post_resp.status_code == 403

        get_resp = client.get(
            "/imagery/scenes/scene-alpha", headers=auth_headers(viewer_token)
        )
        assert get_resp.status_code == 200

    def test_unknown_scene_is_404(self, client: TestClient, state_token: str):
        resp = client.get(
            "/imagery/scenes/no-such-scene", headers=auth_headers(state_token)
        )
        assert resp.status_code == 404

    def test_ingest_is_audited_and_chain_verifies(
        self, client: TestClient, state_token: str, store: Store
    ):
        before = len(store.audit_chain)
        resp = client.post(
            "/imagery/scenes", headers=auth_headers(state_token), json=self._payload()
        )
        assert resp.status_code == 201
        assert len(store.audit_chain) == before + 1
        entry = store.audit_chain[-1]
        assert entry.payload["action"] == "imagery.scene.ingest"
        assert entry.payload["scene_id"] == "scene-alpha"
        assert entry.payload["sha256"] == resp.json()["sha256"]
        assert verify_chain(store.audit_chain).ok

    def test_unauthenticated_post_is_401(self, client: TestClient):
        resp = client.post("/imagery/scenes", json=self._payload())
        assert resp.status_code == 401

    def test_unauthenticated_get_is_401(self, client: TestClient, state_token: str):
        seed = client.post(
            "/imagery/scenes", headers=auth_headers(state_token), json=self._payload()
        )
        assert seed.status_code == 201
        resp = client.get("/imagery/scenes/scene-alpha")
        assert resp.status_code == 401
