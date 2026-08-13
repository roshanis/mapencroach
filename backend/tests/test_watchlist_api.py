"""Tests for the weekly-snapshot watch-list HTTP API.

Endpoints under test: POST/DELETE /alerts/{id}/watch, GET /watchlist,
GET /watchlist/{id}, POST /watchlist/{id}/captures. See the HTTP API
contract for exact response shapes.

These tests never touch the network: `store.imagery_provider` is swapped
for `FakeProvider` wherever a specific capture outcome (captured /
no_usable_scene / provider_error) needs to be forced deterministically.
"""

import threading
import time
from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient

from mapencroach.api.app import create_app
from mapencroach.api.auth import Role, create_token
from mapencroach.api.store import Store
from mapencroach.audit.chain import verify_chain
from mapencroach.imagery.capture import ProviderScene

SECRET = "test-fixture-signing-secret-not-the-dev-default"  # noqa: S105 - test fixture, not a real credential


@pytest.fixture(autouse=True)
def _jwt_secret_env(monkeypatch):
    monkeypatch.setenv("MAPENCROACH_JWT_SECRET", SECRET)


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


def freeze(store: Store, when: datetime) -> None:
    """Pin `store.clock` to a fixed instant, deterministically."""
    store.clock = lambda: when


def first_red_alert(store: Store) -> tuple[str, dict]:
    alert_id = next(aid for aid, a in store.alerts.items() if a["tier"] == "RED")
    return alert_id, store.alerts[alert_id]


def all_red_alerts(store: Store) -> list[str]:
    """RED alerts inside the primary authority only.

    The seeded tree holds a second, unrelated authority (Kerala), and
    these tests drive it with an HRDA-scoped token. Returning every RED
    alert in the store would hand that token an alert it is correctly
    forbidden to see, so the 404 would read as a watch bug rather than
    scoping working as designed.
    """
    scope = store.tree.scope_ids(store.primary_authority_id)
    return [
        aid
        for aid, a in store.alerts.items()
        if a["tier"] == "RED" and store.parcels[a["parcel_id"]]["jurisdiction_id"] in scope
    ]


def first_non_red_alert(store: Store) -> str:
    return next(aid for aid, a in store.alerts.items() if a["tier"] != "RED")


class FakeProvider:
    """Deterministic, network-free `ImageryProvider` for tests.

    `outcomes` maps a WeekRef key to one of:
    - "captured": returns a usable ProviderScene (low cloud_pct)
    - "none": returns None (NO_USABLE_SCENE, no coverage)
    - an Exception instance: raised from `fetch` (PROVIDER_ERROR)
    Any week key not present in `outcomes` defaults to "captured".
    A `delay` sleeps inside `fetch`, to widen a race window in
    concurrency tests.
    """

    def __init__(self, outcomes: dict[str, str | Exception] | None = None, delay: float = 0.0):
        self.outcomes = outcomes or {}
        self.delay = delay
        self.calls: list[str] = []

    def fetch(self, *, geometry, week):
        self.calls.append(week.key)
        if self.delay:
            time.sleep(self.delay)
        outcome = self.outcomes.get(week.key, "captured")
        if outcome == "none":
            return None
        if isinstance(outcome, Exception):
            raise outcome
        return ProviderScene(
            data=f"fake-scene-bytes-{week.key}".encode(),
            scene_id=f"fake-{week.key}",
            captured_at=datetime.combine(week.start, datetime.min.time(), tzinfo=UTC),
            sensor="fake-sensor",
            resolution_m=10.0,
            cloud_pct=5.0,
            source="fake",
            href=f"fake://{week.key}",
        )


@pytest.fixture
def store() -> Store:
    return Store.seed_demo()


@pytest.fixture
def app(store: Store):
    return create_app(store)


@pytest.fixture
def client(app) -> TestClient:
    return TestClient(app)


@pytest.fixture
def state_officer_token(store: Store) -> str:
    return token_for("state-case-officer", Role.CASE_OFFICER, store.primary_authority_id)


@pytest.fixture
def dist_a_officer_token(store: Store) -> str:
    return token_for("dist-a-officer", Role.CASE_OFFICER, store.district_a_id)


@pytest.fixture
def dist_b_officer_token(store: Store) -> str:
    return token_for("dist-b-officer", Role.CASE_OFFICER, store.district_b_id)


@pytest.fixture
def state_viewer_token(store: Store) -> str:
    return token_for("state-viewer", Role.VIEWER, store.primary_authority_id)


@pytest.fixture
def state_legal_officer_token(store: Store) -> str:
    return token_for("state-legal", Role.LEGAL_OFFICER, store.primary_authority_id)


@pytest.fixture
def state_system_admin_token(store: Store) -> str:
    return token_for("state-admin", Role.SYSTEM_ADMIN, store.primary_authority_id)


# ---------------------------------------------------------------------
# POST /alerts/{id}/watch
# ---------------------------------------------------------------------


class TestCreateWatch:
    def test_happy_path_returns_watch_entry(
        self, client: TestClient, store: Store, state_officer_token: str
    ):
        alert_id, alert = first_red_alert(store)
        frozen = datetime(2026, 8, 3, 9, 0, tzinfo=UTC)  # a Monday, ISO week 2026-W32
        freeze(store, frozen)

        resp = client.post(
            f"/alerts/{alert_id}/watch", headers=auth_headers(state_officer_token)
        )
        assert resp.status_code == 201
        body = resp.json()
        assert body["alert_id"] == alert_id
        assert body["parcel_id"] == alert["parcel_id"]
        assert body["started_on"] == "2026-08-03"
        assert body["cadence"] == "weekly"
        assert body["watched_by"] == "state-case-officer"
        assert body["captures"] == []
        assert body["due_weeks"] == ["2026-W32"]

    def test_started_on_is_the_week_the_watch_begins(
        self, client: TestClient, store: Store, state_officer_token: str
    ):
        alert_id, _ = first_red_alert(store)
        # Thursday inside 2026-W32 - started_on should still be the Monday
        # of that ISO week per WeekRef, but the field itself is a plain
        # calendar date: the capture date of the request.
        frozen = datetime(2026, 8, 6, 15, 30, tzinfo=UTC)
        freeze(store, frozen)
        resp = client.post(
            f"/alerts/{alert_id}/watch", headers=auth_headers(state_officer_token)
        )
        assert resp.status_code == 201
        assert resp.json()["started_on"] == "2026-08-06"
        assert resp.json()["due_weeks"] == ["2026-W32"]

    def test_legal_officer_and_system_admin_can_also_watch(
        self,
        client: TestClient,
        store: Store,
        state_legal_officer_token: str,
        state_system_admin_token: str,
    ):
        red_ids = all_red_alerts(store)
        resp1 = client.post(
            f"/alerts/{red_ids[0]}/watch", headers=auth_headers(state_legal_officer_token)
        )
        assert resp1.status_code == 201
        resp2 = client.post(
            f"/alerts/{red_ids[1]}/watch", headers=auth_headers(state_system_admin_token)
        )
        assert resp2.status_code == 201

    def test_viewer_forbidden(self, client: TestClient, store: Store, state_viewer_token: str):
        alert_id, _ = first_red_alert(store)
        resp = client.post(f"/alerts/{alert_id}/watch", headers=auth_headers(state_viewer_token))
        assert resp.status_code == 403

    def test_non_red_alert_is_422(
        self, client: TestClient, store: Store, state_officer_token: str
    ):
        alert_id = first_non_red_alert(store)
        resp = client.post(f"/alerts/{alert_id}/watch", headers=auth_headers(state_officer_token))
        assert resp.status_code == 422
        assert alert_id not in store.watchlist

    def test_double_watch_is_409(
        self, client: TestClient, store: Store, state_officer_token: str
    ):
        alert_id, _ = first_red_alert(store)
        first = client.post(f"/alerts/{alert_id}/watch", headers=auth_headers(state_officer_token))
        assert first.status_code == 201
        second = client.post(
            f"/alerts/{alert_id}/watch", headers=auth_headers(state_officer_token)
        )
        assert second.status_code == 409

    def test_unknown_alert_is_404(self, client: TestClient, state_officer_token: str):
        resp = client.post(
            "/alerts/no-such-alert/watch", headers=auth_headers(state_officer_token)
        )
        assert resp.status_code == 404

    def test_out_of_scope_alert_is_404_not_403(
        self, client: TestClient, store: Store, dist_b_officer_token: str
    ):
        # alert-1 belongs to parcel-1, dist-a - out of scope for a dist-b token.
        alert_id, alert = first_red_alert(store)
        assert store.parcels[alert["parcel_id"]]["jurisdiction_id"] in store.dist_a_scope
        resp = client.post(f"/alerts/{alert_id}/watch", headers=auth_headers(dist_b_officer_token))
        assert resp.status_code == 404

    def test_watch_is_audit_logged(
        self, client: TestClient, store: Store, state_officer_token: str
    ):
        alert_id, _ = first_red_alert(store)
        before = len(store.audit_chain)
        resp = client.post(f"/alerts/{alert_id}/watch", headers=auth_headers(state_officer_token))
        assert resp.status_code == 201
        assert len(store.audit_chain) == before + 1
        entry = store.audit_chain[-1]
        assert entry.payload["action"] == "watch.create"
        assert entry.payload["object_id"] == alert_id
        assert entry.payload["actor"] == "state-case-officer"
        assert verify_chain(store.audit_chain).ok


# ---------------------------------------------------------------------
# DELETE /alerts/{id}/watch
# ---------------------------------------------------------------------


class TestDeleteWatch:
    def test_happy_path(self, client: TestClient, store: Store, state_officer_token: str):
        alert_id, _ = first_red_alert(store)
        client.post(f"/alerts/{alert_id}/watch", headers=auth_headers(state_officer_token))
        resp = client.delete(f"/alerts/{alert_id}/watch", headers=auth_headers(state_officer_token))
        assert resp.status_code == 204
        assert alert_id not in store.watchlist

    def test_unwatch_then_rewatch_succeeds(
        self, client: TestClient, store: Store, state_officer_token: str
    ):
        alert_id, _ = first_red_alert(store)
        client.post(f"/alerts/{alert_id}/watch", headers=auth_headers(state_officer_token))
        client.delete(f"/alerts/{alert_id}/watch", headers=auth_headers(state_officer_token))
        resp = client.post(f"/alerts/{alert_id}/watch", headers=auth_headers(state_officer_token))
        assert resp.status_code == 201

    def test_not_watched_is_404(self, client: TestClient, store: Store, state_officer_token: str):
        alert_id, _ = first_red_alert(store)
        resp = client.delete(f"/alerts/{alert_id}/watch", headers=auth_headers(state_officer_token))
        assert resp.status_code == 404

    def test_out_of_scope_is_404(
        self, client: TestClient, store: Store, state_officer_token: str, dist_b_officer_token: str
    ):
        alert_id, _ = first_red_alert(store)  # dist-a
        client.post(f"/alerts/{alert_id}/watch", headers=auth_headers(state_officer_token))
        resp = client.delete(
            f"/alerts/{alert_id}/watch", headers=auth_headers(dist_b_officer_token)
        )
        assert resp.status_code == 404
        assert alert_id in store.watchlist  # not actually deleted

    def test_viewer_forbidden(
        self, client: TestClient, store: Store, state_officer_token: str, state_viewer_token: str
    ):
        alert_id, _ = first_red_alert(store)
        client.post(f"/alerts/{alert_id}/watch", headers=auth_headers(state_officer_token))
        resp = client.delete(f"/alerts/{alert_id}/watch", headers=auth_headers(state_viewer_token))
        assert resp.status_code == 403

    def test_unwatch_is_audit_logged(
        self, client: TestClient, store: Store, state_officer_token: str
    ):
        alert_id, _ = first_red_alert(store)
        client.post(f"/alerts/{alert_id}/watch", headers=auth_headers(state_officer_token))
        before = len(store.audit_chain)
        resp = client.delete(f"/alerts/{alert_id}/watch", headers=auth_headers(state_officer_token))
        assert resp.status_code == 204
        assert len(store.audit_chain) == before + 1
        entry = store.audit_chain[-1]
        assert entry.payload["action"] == "watch.delete"
        assert entry.payload["object_id"] == alert_id
        assert verify_chain(store.audit_chain).ok


# ---------------------------------------------------------------------
# GET /watchlist, GET /watchlist/{id}
# ---------------------------------------------------------------------


class TestListAndGetWatchlist:
    def test_list_is_scoped_to_jurisdiction(
        self,
        client: TestClient,
        store: Store,
        state_officer_token: str,
        dist_a_officer_token: str,
        dist_b_officer_token: str,
    ):
        red_ids = all_red_alerts(store)
        for aid in red_ids:
            resp = client.post(f"/alerts/{aid}/watch", headers=auth_headers(state_officer_token))
            assert resp.status_code == 201

        state_resp = client.get("/watchlist", headers=auth_headers(state_officer_token))
        assert state_resp.status_code == 200
        assert len(state_resp.json()) == len(red_ids)
        assert state_resp.headers["X-Total-Count"] == str(len(red_ids))

        dist_a_resp = client.get("/watchlist", headers=auth_headers(dist_a_officer_token))
        dist_a_ids = {e["alert_id"] for e in dist_a_resp.json()}
        dist_b_parcel_ids = {
            p["id"] for p in store.parcels.values() if p["jurisdiction_id"] in store.dist_b_scope
        }
        assert all(
            store.watchlist[aid].parcel_id not in dist_b_parcel_ids for aid in dist_a_ids
        )

    def test_pagination_and_total_count(
        self, client: TestClient, store: Store, state_officer_token: str
    ):
        red_ids = all_red_alerts(store)
        assert len(red_ids) >= 3
        for aid in red_ids:
            client.post(f"/alerts/{aid}/watch", headers=auth_headers(state_officer_token))

        resp = client.get(
            "/watchlist",
            params={"limit": 1, "offset": 1},
            headers=auth_headers(state_officer_token),
        )
        assert resp.status_code == 200
        assert isinstance(resp.json(), list)
        assert len(resp.json()) == 1
        assert resp.headers["X-Total-Count"] == str(len(red_ids))

    def test_limit_above_max_is_422(self, client: TestClient, state_officer_token: str):
        resp = client.get(
            "/watchlist", params={"limit": 1001}, headers=auth_headers(state_officer_token)
        )
        assert resp.status_code == 422

    def test_negative_offset_is_422(self, client: TestClient, state_officer_token: str):
        resp = client.get(
            "/watchlist", params={"offset": -1}, headers=auth_headers(state_officer_token)
        )
        assert resp.status_code == 422

    def test_get_single_entry(self, client: TestClient, store: Store, state_officer_token: str):
        alert_id, alert = first_red_alert(store)
        client.post(f"/alerts/{alert_id}/watch", headers=auth_headers(state_officer_token))
        resp = client.get(f"/watchlist/{alert_id}", headers=auth_headers(state_officer_token))
        assert resp.status_code == 200
        body = resp.json()
        assert body["alert_id"] == alert_id
        assert body["parcel_id"] == alert["parcel_id"]

    def test_get_not_watched_is_404(
        self, client: TestClient, store: Store, state_officer_token: str
    ):
        alert_id, _ = first_red_alert(store)
        resp = client.get(f"/watchlist/{alert_id}", headers=auth_headers(state_officer_token))
        assert resp.status_code == 404

    def test_get_out_of_scope_is_404(
        self, client: TestClient, store: Store, state_officer_token: str, dist_b_officer_token: str
    ):
        alert_id, _ = first_red_alert(store)  # dist-a
        client.post(f"/alerts/{alert_id}/watch", headers=auth_headers(state_officer_token))
        resp = client.get(f"/watchlist/{alert_id}", headers=auth_headers(dist_b_officer_token))
        assert resp.status_code == 404

    def test_reads_do_not_require_case_officer(
        self, client: TestClient, store: Store, state_officer_token: str, state_viewer_token: str
    ):
        alert_id, _ = first_red_alert(store)
        client.post(f"/alerts/{alert_id}/watch", headers=auth_headers(state_officer_token))
        resp = client.get("/watchlist", headers=auth_headers(state_viewer_token))
        assert resp.status_code == 200
        resp2 = client.get(f"/watchlist/{alert_id}", headers=auth_headers(state_viewer_token))
        assert resp2.status_code == 200


# ---------------------------------------------------------------------
# POST /watchlist/{id}/captures
# ---------------------------------------------------------------------


class TestRunCaptures:
    def test_viewer_forbidden(
        self, client: TestClient, store: Store, state_officer_token: str, state_viewer_token: str
    ):
        alert_id, _ = first_red_alert(store)
        client.post(f"/alerts/{alert_id}/watch", headers=auth_headers(state_officer_token))
        resp = client.post(
            f"/watchlist/{alert_id}/captures", headers=auth_headers(state_viewer_token)
        )
        assert resp.status_code == 403

    def test_not_watched_is_404(self, client: TestClient, store: Store, state_officer_token: str):
        alert_id, _ = first_red_alert(store)
        resp = client.post(
            f"/watchlist/{alert_id}/captures", headers=auth_headers(state_officer_token)
        )
        assert resp.status_code == 404

    def test_out_of_scope_is_404(
        self, client: TestClient, store: Store, state_officer_token: str, dist_b_officer_token: str
    ):
        alert_id, _ = first_red_alert(store)  # dist-a
        client.post(f"/alerts/{alert_id}/watch", headers=auth_headers(state_officer_token))
        resp = client.post(
            f"/watchlist/{alert_id}/captures", headers=auth_headers(dist_b_officer_token)
        )
        assert resp.status_code == 404

    def test_captured_week_records_scene_and_hash(
        self, client: TestClient, store: Store, state_officer_token: str
    ):
        alert_id, _ = first_red_alert(store)
        frozen = datetime(2026, 8, 3, tzinfo=UTC)
        freeze(store, frozen)
        client.post(f"/alerts/{alert_id}/watch", headers=auth_headers(state_officer_token))

        store.imagery_provider = FakeProvider()  # everything "captured"
        resp = client.post(
            f"/watchlist/{alert_id}/captures", headers=auth_headers(state_officer_token)
        )
        assert resp.status_code == 201
        body = resp.json()
        assert len(body) == 1
        attempt = body[0]
        assert attempt["week"] == "2026-W32"
        assert attempt["status"] == "captured"
        assert attempt["scene_id"] == "fake-2026-W32"
        assert attempt["sha256"] is not None
        assert attempt["reason"] is None

        entry_resp = client.get(f"/watchlist/{alert_id}", headers=auth_headers(state_officer_token))
        entry = entry_resp.json()
        assert len(entry["captures"]) == 1
        assert entry["due_weeks"] == []

        # Hash-on-ingest evidence anchor: the scene is in the shared registry.
        record = store.scene_registry.get("fake-2026-W32")
        assert record.sha256 == attempt["sha256"]

    def test_idempotent_rerun_is_empty(
        self, client: TestClient, store: Store, state_officer_token: str
    ):
        alert_id, _ = first_red_alert(store)
        freeze(store, datetime(2026, 8, 3, tzinfo=UTC))
        client.post(f"/alerts/{alert_id}/watch", headers=auth_headers(state_officer_token))
        store.imagery_provider = FakeProvider()

        first = client.post(
            f"/watchlist/{alert_id}/captures", headers=auth_headers(state_officer_token)
        )
        assert len(first.json()) == 1

        second = client.post(
            f"/watchlist/{alert_id}/captures", headers=auth_headers(state_officer_token)
        )
        assert second.status_code == 201
        assert second.json() == []

        entry = client.get(
            f"/watchlist/{alert_id}", headers=auth_headers(state_officer_token)
        ).json()
        assert len(entry["captures"]) == 1  # no duplicate attempt recorded

    def test_no_usable_scene_and_provider_error_weeks(
        self, client: TestClient, store: Store, state_officer_token: str
    ):
        alert_id, _ = first_red_alert(store)
        # Watch starts a week before "today" so two weeks are due at once.
        freeze(store, datetime(2026, 7, 27, tzinfo=UTC))  # 2026-W31
        client.post(f"/alerts/{alert_id}/watch", headers=auth_headers(state_officer_token))
        freeze(store, datetime(2026, 8, 3, tzinfo=UTC))  # 2026-W32

        store.imagery_provider = FakeProvider(
            outcomes={
                "2026-W31": "none",
                "2026-W32": ValueError("provider is on fire"),
            }
        )
        resp = client.post(
            f"/watchlist/{alert_id}/captures", headers=auth_headers(state_officer_token)
        )
        assert resp.status_code == 201
        body = resp.json()
        assert [a["week"] for a in body] == ["2026-W31", "2026-W32"]  # ascending

        no_scene, error = body
        assert no_scene["status"] == "no_usable_scene"
        assert no_scene["scene_id"] is None
        assert "no scene" in no_scene["reason"]

        assert error["status"] == "provider_error"
        assert error["scene_id"] is None
        assert "provider is on fire" in error["reason"]

        # Both are recorded (as facts, not silently dropped) and neither
        # remains due.
        entry = client.get(
            f"/watchlist/{alert_id}", headers=auth_headers(state_officer_token)
        ).json()
        assert len(entry["captures"]) == 2
        assert entry["due_weeks"] == []

    def test_capture_run_is_audit_logged(
        self, client: TestClient, store: Store, state_officer_token: str
    ):
        alert_id, _ = first_red_alert(store)
        freeze(store, datetime(2026, 8, 3, tzinfo=UTC))
        client.post(f"/alerts/{alert_id}/watch", headers=auth_headers(state_officer_token))
        store.imagery_provider = FakeProvider()

        before = len(store.audit_chain)
        resp = client.post(
            f"/watchlist/{alert_id}/captures", headers=auth_headers(state_officer_token)
        )
        assert resp.status_code == 201
        assert len(store.audit_chain) == before + 1
        entry = store.audit_chain[-1]
        assert entry.payload["action"] == "watch.capture_run"
        assert entry.payload["object_id"] == alert_id
        assert verify_chain(store.audit_chain).ok

        # A rerun with nothing due does not add a spurious audit entry.
        before2 = len(store.audit_chain)
        empty = client.post(
            f"/watchlist/{alert_id}/captures", headers=auth_headers(state_officer_token)
        )
        assert empty.json() == []
        assert len(store.audit_chain) == before2

    def test_unwatch_during_capture_run_is_not_persisted(
        self, client: TestClient, store: Store, state_officer_token: str
    ):
        """If the entry is unwatched while a capture run's provider I/O is
        still in flight, phase 3 must not resurrect it: nothing is
        persisted and no audit entry is written for the vanished watch."""
        alert_id, _ = first_red_alert(store)
        freeze(store, datetime(2026, 8, 3, tzinfo=UTC))
        client.post(f"/alerts/{alert_id}/watch", headers=auth_headers(state_officer_token))

        class UnwatchingProvider(FakeProvider):
            def fetch(self, *, geometry, week):
                with store.lock:
                    store.watchlist.pop(alert_id, None)
                return super().fetch(geometry=geometry, week=week)

        store.imagery_provider = UnwatchingProvider()

        before = len(store.audit_chain)
        resp = client.post(
            f"/watchlist/{alert_id}/captures", headers=auth_headers(state_officer_token)
        )
        assert resp.status_code == 201
        assert resp.json() == []
        assert alert_id not in store.watchlist
        assert len(store.audit_chain) == before  # no spurious audit entry

    def test_default_provider_wiring_uses_build_provider(
        self, client: TestClient, store: Store, state_officer_token: str
    ):
        """No provider override: the store's default (built via
        `providers.build_provider()`, demo mode with no credentials in the
        test environment) must work end to end."""
        from mapencroach.imagery.providers import DemoImageryProvider

        assert isinstance(store.imagery_provider, DemoImageryProvider)

        alert_id, _ = first_red_alert(store)
        freeze(store, datetime(2026, 8, 3, tzinfo=UTC))
        client.post(f"/alerts/{alert_id}/watch", headers=auth_headers(state_officer_token))

        resp = client.post(
            f"/watchlist/{alert_id}/captures", headers=auth_headers(state_officer_token)
        )
        assert resp.status_code == 201
        body = resp.json()
        assert len(body) == 1
        assert body[0]["status"] in ("captured", "no_usable_scene")

        rerun = client.post(
            f"/watchlist/{alert_id}/captures", headers=auth_headers(state_officer_token)
        )
        assert rerun.json() == []

    def test_week_boundary_is_deterministic_via_clock_injection(
        self, client: TestClient, store: Store, state_officer_token: str
    ):
        alert_id, _ = first_red_alert(store)
        freeze(store, datetime(2026, 7, 27, tzinfo=UTC))  # 2026-W31, Monday
        client.post(f"/alerts/{alert_id}/watch", headers=auth_headers(state_officer_token))
        store.imagery_provider = FakeProvider()

        # Same week as start: exactly one due week.
        first = client.post(
            f"/watchlist/{alert_id}/captures", headers=auth_headers(state_officer_token)
        )
        assert [a["week"] for a in first.json()] == ["2026-W31"]

        # Cross into the next ISO week.
        freeze(store, datetime(2026, 8, 3, tzinfo=UTC))  # 2026-W32
        second = client.post(
            f"/watchlist/{alert_id}/captures", headers=auth_headers(state_officer_token)
        )
        assert [a["week"] for a in second.json()] == ["2026-W32"]

        entry = client.get(
            f"/watchlist/{alert_id}", headers=auth_headers(state_officer_token)
        ).json()
        assert [c["week"] for c in entry["captures"]] == ["2026-W31", "2026-W32"]
        assert entry["due_weeks"] == []

    def test_concurrent_capture_runs_do_not_double_attempt(
        self, store: Store, app, state_officer_token: str
    ):
        """Two concurrent capture triggers for the same alert/week must not
        both attempt it - the in_flight reservation taken under store.lock
        (released before provider I/O) prevents the race."""
        alert_id, _ = first_red_alert(store)
        freeze(store, datetime(2026, 8, 3, tzinfo=UTC))  # exactly one due week

        setup_client = TestClient(app)
        setup_client.post(f"/alerts/{alert_id}/watch", headers=auth_headers(state_officer_token))

        slow_provider = FakeProvider(delay=0.1)
        store.imagery_provider = slow_provider

        results: list[list] = [None, None]  # type: ignore[list-item]

        def call(index: int) -> None:
            local_client = TestClient(app)
            resp = local_client.post(
                f"/watchlist/{alert_id}/captures", headers=auth_headers(state_officer_token)
            )
            results[index] = resp.json()

        t1 = threading.Thread(target=call, args=(0,))
        t2 = threading.Thread(target=call, args=(1,))
        t1.start()
        t2.start()
        t1.join(timeout=10)
        t2.join(timeout=10)

        combined = results[0] + results[1]
        assert len(combined) == 1
        assert combined[0]["week"] == "2026-W32"

        # The provider itself was only ever asked for this week once.
        assert slow_provider.calls == ["2026-W32"]

        entry = store.watchlist[alert_id]
        assert len(entry.captures) == 1
        assert entry.in_flight == set()
