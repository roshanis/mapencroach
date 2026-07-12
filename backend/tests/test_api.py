from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient

from mapencroach.api.app import create_app
from mapencroach.api.auth import Role, create_token
from mapencroach.api.store import Store
from mapencroach.audit.chain import verify_chain

SECRET = "dev-secret-do-not-deploy"  # noqa: S105 - test fixture default, matches auth.py default


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
        officer_token = token_for(
            "case-officer-2", Role.CASE_OFFICER, case.jurisdiction_id
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
