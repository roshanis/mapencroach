"""Tests for the case-level imagery backfill HTTP API.

Endpoints under test: GET /cases/{case_id}/imagery,
POST /cases/{case_id}/imagery/backfill. See contract-backfill.md for the
exact response shapes.

Design note this whole suite leans on: there is ONE imagery timeline per
alert (the same `WatchEntryRecord` the watch-list endpoints use, see
test_watchlist_api.py). A case reaches its timeline through
`CaseRecord.alert_id`, so backfilling a case that already has a forward
watch must extend that same record rather than creating a second one, and
backfilling a case with no watch yet must create exactly one record.

Like test_watchlist_api.py, these tests never touch the network:
`store.imagery_provider` is always swapped for `FakeProvider`.
"""

import threading
import time
from datetime import UTC, date, datetime, timedelta

import pytest
from fastapi.testclient import TestClient

from mapencroach.api.app import create_app
from mapencroach.api.auth import Role, create_token
from mapencroach.api.store import Store
from mapencroach.audit.chain import verify_chain
from mapencroach.imagery.capture import ProviderScene
from mapencroach.imagery.schedule import weeks_from

SECRET = "test-fixture-signing-secret-not-the-dev-default"  # noqa: S105 - test fixture, not a real credential

DEFAULT_FLOOR = date(2026, 1, 1)


@pytest.fixture(autouse=True)
def _jwt_secret_env(monkeypatch):
    monkeypatch.setenv("MAPENCROACH_JWT_SECRET", SECRET)
    # Make sure no stray env var from another test/process changes the
    # floor out from under a test that assumes the documented default.
    monkeypatch.delenv("MAPENCROACH_IMAGERY_BACKFILL_FLOOR", raising=False)


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


def case_with_alert_tier(store: Store, tier: str) -> tuple[str, str]:
    """Return (case_id, alert_id) for the first seeded case whose
    originating alert has the given tier."""
    for case_id, record in store.cases.items():
        alert = store.alerts[record.alert_id]
        if alert["tier"] == tier:
            return case_id, record.alert_id
    raise AssertionError(f"no seeded case with alert tier {tier!r}")


class FakeProvider:
    """Deterministic, network-free `ImageryProvider` for tests.

    Identical to the fixture used in test_watchlist_api.py: `outcomes`
    maps a WeekRef key to "captured" (default), "none" (NO_USABLE_SCENE),
    or an Exception instance (PROVIDER_ERROR).
    """

    def __init__(self, outcomes: dict[str, str | Exception] | None = None):
        self.outcomes = outcomes or {}
        self.calls: list[str] = []

    def fetch(self, *, geometry, week):
        self.calls.append(week.key)
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
    return token_for("state-case-officer", Role.CASE_OFFICER, store.root_jurisdiction_id)


@pytest.fixture
def dist_a_officer_token(store: Store) -> str:
    return token_for("dist-a-officer", Role.CASE_OFFICER, store.district_a_id)


@pytest.fixture
def dist_b_officer_token(store: Store) -> str:
    return token_for("dist-b-officer", Role.CASE_OFFICER, store.district_b_id)


@pytest.fixture
def state_viewer_token(store: Store) -> str:
    return token_for("state-viewer", Role.VIEWER, store.root_jurisdiction_id)


# ---------------------------------------------------------------------
# GET /cases/{case_id}/imagery
# ---------------------------------------------------------------------


class TestGetCaseImagery:
    def test_red_case_without_existing_timeline(
        self, client: TestClient, store: Store, state_officer_token: str
    ):
        case_id, alert_id = case_with_alert_tier(store, "RED")
        assert alert_id not in store.watchlist
        frozen = datetime(2026, 8, 3, tzinfo=UTC)  # Monday, 2026-W32
        freeze(store, frozen)

        resp = client.get(f"/cases/{case_id}/imagery", headers=auth_headers(state_officer_token))
        assert resp.status_code == 200
        body = resp.json()
        assert body["case_id"] == case_id
        assert body["alert_id"] == alert_id
        assert body["alert_tier"] == "RED"
        assert body["watchable"] is True
        assert body["started_on"] is None
        assert body["cadence"] == "weekly"
        assert body["captures"] == []
        assert body["due_weeks"] == []
        assert body["backfill_floor"] == "2026-01-01"

        expected_remaining = len(weeks_from(DEFAULT_FLOOR, frozen.date() - timedelta(days=1)))
        assert body["remaining_backfill_weeks"] == expected_remaining
        assert expected_remaining > 0

    def test_red_case_with_existing_forward_watch(
        self, client: TestClient, store: Store, state_officer_token: str
    ):
        case_id, alert_id = case_with_alert_tier(store, "RED")
        freeze(store, datetime(2026, 8, 3, tzinfo=UTC))  # 2026-W32
        client.post(f"/alerts/{alert_id}/watch", headers=auth_headers(state_officer_token))
        store.imagery_provider = FakeProvider()
        client.post(
            f"/watchlist/{alert_id}/captures", headers=auth_headers(state_officer_token)
        )

        resp = client.get(f"/cases/{case_id}/imagery", headers=auth_headers(state_officer_token))
        assert resp.status_code == 200
        body = resp.json()
        assert body["started_on"] == "2026-08-03"
        assert body["watchable"] is True
        assert [c["week"] for c in body["captures"]] == ["2026-W32"]
        assert body["due_weeks"] == []
        # Nothing earlier than started_on has been backfilled yet.
        assert body["remaining_backfill_weeks"] > 0

    def test_non_red_case_reports_not_watchable(
        self, client: TestClient, store: Store, state_officer_token: str
    ):
        case_id, alert_id = case_with_alert_tier(store, "GREEN")
        resp = client.get(f"/cases/{case_id}/imagery", headers=auth_headers(state_officer_token))
        assert resp.status_code == 200
        body = resp.json()
        assert body["alert_id"] == alert_id
        assert body["alert_tier"] == "GREEN"
        assert body["watchable"] is False
        assert body["started_on"] is None
        assert body["captures"] == []

    def test_unknown_case_is_404(self, client: TestClient, state_officer_token: str):
        resp = client.get(
            "/cases/no-such-case/imagery", headers=auth_headers(state_officer_token)
        )
        assert resp.status_code == 404

    def test_out_of_scope_case_is_404_not_403(
        self, client: TestClient, store: Store, dist_b_officer_token: str
    ):
        case_id, _ = case_with_alert_tier(store, "RED")  # case-1 is dist-a
        assert store.cases[case_id].jurisdiction_id in store.dist_a_scope
        resp = client.get(
            f"/cases/{case_id}/imagery", headers=auth_headers(dist_b_officer_token)
        )
        assert resp.status_code == 404

    def test_viewer_can_read(
        self, client: TestClient, store: Store, state_viewer_token: str
    ):
        """GET has no role restriction beyond normal read auth."""
        case_id, _ = case_with_alert_tier(store, "RED")
        resp = client.get(f"/cases/{case_id}/imagery", headers=auth_headers(state_viewer_token))
        assert resp.status_code == 200

    def test_custom_backfill_floor_env_var_is_honored(
        self, client: TestClient, store: Store, state_officer_token: str, monkeypatch
    ):
        monkeypatch.setenv("MAPENCROACH_IMAGERY_BACKFILL_FLOOR", "2026-03-15")
        case_id, _ = case_with_alert_tier(store, "RED")
        resp = client.get(f"/cases/{case_id}/imagery", headers=auth_headers(state_officer_token))
        assert resp.status_code == 200
        assert resp.json()["backfill_floor"] == "2026-03-15"


# ---------------------------------------------------------------------
# POST /cases/{case_id}/imagery/backfill
# ---------------------------------------------------------------------


class TestBackfillCaseImagery:
    def test_happy_path_creates_timeline_and_extends_started_on(
        self, client: TestClient, store: Store, state_officer_token: str
    ):
        case_id, alert_id = case_with_alert_tier(store, "RED")
        frozen = datetime(2026, 8, 3, tzinfo=UTC)  # 2026-W32
        freeze(store, frozen)
        store.imagery_provider = FakeProvider()

        assert alert_id not in store.watchlist

        total_weeks = len(weeks_from(DEFAULT_FLOOR, frozen.date() - timedelta(days=1)))
        resp = client.post(
            f"/cases/{case_id}/imagery/backfill",
            json={"max_weeks": 52},
            headers=auth_headers(state_officer_token),
        )
        assert resp.status_code == 201
        body = resp.json()
        assert len(body["attempted"]) == total_weeks
        assert body["remaining_backfill_weeks"] == 0
        assert body["started_on"] == "2026-01-01"

        # A WatchEntryRecord now exists for the alert -- one timeline.
        assert alert_id in store.watchlist
        entry = store.watchlist[alert_id]
        assert entry.started_on == DEFAULT_FLOOR
        assert len(entry.captures) == total_weeks
        assert [c.week for c in entry.captures] == sorted(c.week for c in entry.captures)

        # Alert now shows up on the ordinary watch-list too.
        watchlist_resp = client.get("/watchlist", headers=auth_headers(state_officer_token))
        assert alert_id in {e["alert_id"] for e in watchlist_resp.json()}

    def test_chunking_across_two_calls_until_remaining_is_zero(
        self, client: TestClient, store: Store, state_officer_token: str
    ):
        case_id, alert_id = case_with_alert_tier(store, "RED")
        frozen = datetime(2026, 8, 3, tzinfo=UTC)
        freeze(store, frozen)
        store.imagery_provider = FakeProvider()

        total_weeks = len(weeks_from(DEFAULT_FLOOR, frozen.date() - timedelta(days=1)))
        assert total_weeks > 26  # otherwise this test doesn't exercise chunking

        first = client.post(
            f"/cases/{case_id}/imagery/backfill", headers=auth_headers(state_officer_token)
        )
        assert first.status_code == 201
        first_body = first.json()
        assert len(first_body["attempted"]) == 26  # default max_weeks
        assert first_body["remaining_backfill_weeks"] == total_weeks - 26

        second = client.post(
            f"/cases/{case_id}/imagery/backfill", headers=auth_headers(state_officer_token)
        )
        assert second.status_code == 201
        second_body = second.json()
        assert len(second_body["attempted"]) == total_weeks - 26
        assert second_body["remaining_backfill_weeks"] == 0
        assert second_body["started_on"] == "2026-01-01"

        entry = store.watchlist[alert_id]
        assert len(entry.captures) == total_weeks
        weeks_order = [c.week for c in entry.captures]
        assert weeks_order == sorted(weeks_order)  # ascending throughout

        get_resp = client.get(
            f"/cases/{case_id}/imagery", headers=auth_headers(state_officer_token)
        )
        assert get_resp.json()["remaining_backfill_weeks"] == 0

    def test_idempotent_rerun_after_full_backfill_attempts_nothing(
        self, client: TestClient, store: Store, state_officer_token: str
    ):
        case_id, alert_id = case_with_alert_tier(store, "RED")
        freeze(store, datetime(2026, 8, 3, tzinfo=UTC))
        store.imagery_provider = FakeProvider()

        # Drain the backfill fully first.
        remaining = 1
        while remaining:
            resp = client.post(
                f"/cases/{case_id}/imagery/backfill", headers=auth_headers(state_officer_token)
            )
            remaining = resp.json()["remaining_backfill_weeks"]

        before_captures = len(store.watchlist[alert_id].captures)
        before_audit = len(store.audit_chain)

        rerun = client.post(
            f"/cases/{case_id}/imagery/backfill", headers=auth_headers(state_officer_token)
        )
        assert rerun.status_code == 201
        rerun_body = rerun.json()
        assert rerun_body["attempted"] == []
        assert rerun_body["remaining_backfill_weeks"] == 0

        assert len(store.watchlist[alert_id].captures) == before_captures  # no duplicates
        assert len(store.audit_chain) == before_audit  # no spurious audit entry

    def test_backfill_extends_existing_forward_watch_not_duplicated(
        self, client: TestClient, store: Store, state_officer_token: str
    ):
        case_id, alert_id = case_with_alert_tier(store, "RED")
        freeze(store, datetime(2026, 8, 3, tzinfo=UTC))  # 2026-W32
        client.post(f"/alerts/{alert_id}/watch", headers=auth_headers(state_officer_token))
        store.imagery_provider = FakeProvider()
        client.post(
            f"/watchlist/{alert_id}/captures", headers=auth_headers(state_officer_token)
        )
        assert [c.week for c in store.watchlist[alert_id].captures] == ["2026-W32"]

        resp = client.post(
            f"/cases/{case_id}/imagery/backfill",
            json={"max_weeks": 52},
            headers=auth_headers(state_officer_token),
        )
        assert resp.status_code == 201
        body = resp.json()
        assert body["remaining_backfill_weeks"] == 0
        assert body["started_on"] == "2026-01-01"

        # Still exactly one WatchEntryRecord for this alert.
        assert list(store.watchlist.keys()).count(alert_id) == 1
        entry = store.watchlist[alert_id]
        weeks_order = [c.week for c in entry.captures]
        assert weeks_order == sorted(weeks_order)
        # The original forward-captured week is still on record, prepended
        # after (not replaced by) the newly backfilled earlier weeks.
        assert "2026-W32" in weeks_order
        assert weeks_order[-1] == "2026-W32"  # most-recent week sorts last
        assert weeks_order[0] != "2026-W32"  # backfilled weeks precede it
        assert entry.started_on == DEFAULT_FLOOR

    def test_partial_backfill_from_date_leaves_remainder(
        self, client: TestClient, store: Store, state_officer_token: str
    ):
        case_id, alert_id = case_with_alert_tier(store, "RED")
        freeze(store, datetime(2026, 8, 3, tzinfo=UTC))
        store.imagery_provider = FakeProvider()

        resp = client.post(
            f"/cases/{case_id}/imagery/backfill",
            json={"from": "2026-06-01", "max_weeks": 52},
            headers=auth_headers(state_officer_token),
        )
        assert resp.status_code == 201
        body = resp.json()
        assert body["started_on"] != "2026-01-01"
        # Fully satisfied *for the requested `from`* -- remaining_backfill_weeks
        # on the POST response is scoped to this call's target, not the floor.
        assert body["remaining_backfill_weeks"] == 0

        # GET (always measured against the global floor) still reports more
        # coverage is available further back than the caller asked for.
        get_after_partial = client.get(
            f"/cases/{case_id}/imagery", headers=auth_headers(state_officer_token)
        )
        assert get_after_partial.json()["remaining_backfill_weeks"] > 0

        # A follow-up call with an earlier `from` continues the same entry.
        resp2 = client.post(
            f"/cases/{case_id}/imagery/backfill",
            json={"max_weeks": 52},  # from defaults to the floor
            headers=auth_headers(state_officer_token),
        )
        assert resp2.status_code == 201
        assert resp2.json()["remaining_backfill_weeks"] == 0
        assert resp2.json()["started_on"] == "2026-01-01"
        assert alert_id in store.watchlist
        assert list(store.watchlist.keys()).count(alert_id) == 1

    def test_non_red_case_backfill_is_422(
        self, client: TestClient, store: Store, state_officer_token: str
    ):
        case_id, alert_id = case_with_alert_tier(store, "GREEN")
        resp = client.post(
            f"/cases/{case_id}/imagery/backfill", headers=auth_headers(state_officer_token)
        )
        assert resp.status_code == 422
        assert alert_id not in store.watchlist

    def test_below_floor_from_date_is_422(
        self, client: TestClient, store: Store, state_officer_token: str
    ):
        case_id, alert_id = case_with_alert_tier(store, "RED")
        resp = client.post(
            f"/cases/{case_id}/imagery/backfill",
            json={"from": "2025-12-25"},
            headers=auth_headers(state_officer_token),
        )
        assert resp.status_code == 422
        assert "2026-01-01" in resp.json()["detail"]
        assert alert_id not in store.watchlist  # nothing created on rejection

    def test_max_weeks_bounds_are_validated(
        self, client: TestClient, store: Store, state_officer_token: str
    ):
        case_id, _ = case_with_alert_tier(store, "RED")

        too_low = client.post(
            f"/cases/{case_id}/imagery/backfill",
            json={"max_weeks": 0},
            headers=auth_headers(state_officer_token),
        )
        assert too_low.status_code == 422

        too_high = client.post(
            f"/cases/{case_id}/imagery/backfill",
            json={"max_weeks": 53},
            headers=auth_headers(state_officer_token),
        )
        assert too_high.status_code == 422

    def test_max_weeks_upper_bound_of_52_is_accepted(
        self, client: TestClient, store: Store, state_officer_token: str
    ):
        case_id, _ = case_with_alert_tier(store, "RED")
        freeze(store, datetime(2026, 8, 3, tzinfo=UTC))
        store.imagery_provider = FakeProvider()
        resp = client.post(
            f"/cases/{case_id}/imagery/backfill",
            json={"max_weeks": 52},
            headers=auth_headers(state_officer_token),
        )
        assert resp.status_code == 201

    def test_unknown_case_is_404(self, client: TestClient, state_officer_token: str):
        resp = client.post(
            "/cases/no-such-case/imagery/backfill", headers=auth_headers(state_officer_token)
        )
        assert resp.status_code == 404

    def test_out_of_scope_case_is_404_not_403(
        self, client: TestClient, store: Store, dist_b_officer_token: str
    ):
        case_id, alert_id = case_with_alert_tier(store, "RED")  # case-1 is dist-a
        resp = client.post(
            f"/cases/{case_id}/imagery/backfill", headers=auth_headers(dist_b_officer_token)
        )
        assert resp.status_code == 404
        assert alert_id not in store.watchlist

    def test_viewer_forbidden(
        self, client: TestClient, store: Store, state_viewer_token: str
    ):
        case_id, _ = case_with_alert_tier(store, "RED")
        resp = client.post(
            f"/cases/{case_id}/imagery/backfill", headers=auth_headers(state_viewer_token)
        )
        assert resp.status_code == 403

    def test_idempotent_per_week_never_reattempts_captured_week(
        self, client: TestClient, store: Store, state_officer_token: str
    ):
        case_id, alert_id = case_with_alert_tier(store, "RED")
        freeze(store, datetime(2026, 8, 3, tzinfo=UTC))
        provider = FakeProvider()
        store.imagery_provider = provider

        remaining = 1
        while remaining:
            resp = client.post(
                f"/cases/{case_id}/imagery/backfill",
                json={"max_weeks": 10},
                headers=auth_headers(state_officer_token),
            )
            remaining = resp.json()["remaining_backfill_weeks"]

        # Every provider call was for a distinct week -- nothing re-fetched.
        assert len(provider.calls) == len(set(provider.calls))
        assert len(store.watchlist[alert_id].captures) == len(provider.calls)

    def test_backfill_is_audit_logged_and_chain_verifies(
        self, client: TestClient, store: Store, state_officer_token: str
    ):
        case_id, alert_id = case_with_alert_tier(store, "RED")
        freeze(store, datetime(2026, 8, 3, tzinfo=UTC))
        store.imagery_provider = FakeProvider()

        before = len(store.audit_chain)
        resp = client.post(
            f"/cases/{case_id}/imagery/backfill", headers=auth_headers(state_officer_token)
        )
        assert resp.status_code == 201
        assert len(store.audit_chain) == before + 1
        entry = store.audit_chain[-1]
        assert entry.payload["action"] == "watch.backfill"
        assert entry.payload["object_id"] == alert_id
        assert entry.payload["actor"] == "state-case-officer"
        assert verify_chain(store.audit_chain).ok

    def test_no_usable_scene_and_provider_error_weeks_still_count_as_attempted(
        self, client: TestClient, store: Store, state_officer_token: str
    ):
        case_id, alert_id = case_with_alert_tier(store, "RED")
        freeze(store, datetime(2026, 8, 3, tzinfo=UTC))
        store.imagery_provider = FakeProvider(
            outcomes={
                "2026-W31": "none",
                "2026-W30": ValueError("provider is on fire"),
            }
        )

        resp = client.post(
            f"/cases/{case_id}/imagery/backfill",
            json={"from": "2026-07-13", "max_weeks": 52},
            headers=auth_headers(state_officer_token),
        )
        assert resp.status_code == 201
        body = resp.json()
        statuses = {a["week"]: a["status"] for a in body["attempted"]}
        assert statuses["2026-W31"] == "no_usable_scene"
        assert statuses["2026-W30"] == "provider_error"
        assert body["remaining_backfill_weeks"] == 0

        entry = store.watchlist[alert_id]
        assert {c.week for c in entry.captures} >= {"2026-W31", "2026-W30"}

    def test_concurrent_backfill_and_forward_capture_do_not_double_attempt(
        self, store: Store, app, state_officer_token: str
    ):
        """A backfill running concurrently with a forward capture run for
        the same alert must not collide -- both share `entry.in_flight`."""
        case_id, alert_id = case_with_alert_tier(store, "RED")
        freeze(store, datetime(2026, 8, 3, tzinfo=UTC))  # exactly one due forward week

        setup_client = TestClient(app)
        setup_client.post(
            f"/alerts/{alert_id}/watch", headers=auth_headers(state_officer_token)
        )

        class SlowProvider(FakeProvider):
            def fetch(self, *, geometry, week):
                time.sleep(0.05)
                return super().fetch(geometry=geometry, week=week)

        slow_provider = SlowProvider()
        store.imagery_provider = slow_provider

        results: dict[str, object] = {}

        def run_forward() -> None:
            local_client = TestClient(app)
            resp = local_client.post(
                f"/watchlist/{alert_id}/captures", headers=auth_headers(state_officer_token)
            )
            results["forward"] = resp.json()

        def run_backfill() -> None:
            local_client = TestClient(app)
            resp = local_client.post(
                f"/cases/{case_id}/imagery/backfill",
                json={"max_weeks": 52},
                headers=auth_headers(state_officer_token),
            )
            results["backfill"] = resp.json()

        t1 = threading.Thread(target=run_forward)
        t2 = threading.Thread(target=run_backfill)
        t1.start()
        t2.start()
        t1.join(timeout=20)
        t2.join(timeout=20)

        entry = store.watchlist[alert_id]
        weeks_captured = [c.week for c in entry.captures]
        # No week appears twice, regardless of which endpoint claimed it.
        assert len(weeks_captured) == len(set(weeks_captured))
        assert entry.in_flight == set()
        assert weeks_captured == sorted(weeks_captured)

    def test_unwatch_during_backfill_is_not_persisted(
        self, client: TestClient, store: Store, state_officer_token: str
    ):
        """If the entry is unwatched while a backfill's provider I/O is
        still in flight, phase 3 must not resurrect it: nothing is
        persisted and no audit entry is written for the vanished watch."""
        case_id, alert_id = case_with_alert_tier(store, "RED")
        freeze(store, datetime(2026, 8, 3, tzinfo=UTC))

        class UnwatchingProvider(FakeProvider):
            def fetch(self, *, geometry, week):
                with store.lock:
                    store.watchlist.pop(alert_id, None)
                return super().fetch(geometry=geometry, week=week)

        store.imagery_provider = UnwatchingProvider()

        before = len(store.audit_chain)
        resp = client.post(
            f"/cases/{case_id}/imagery/backfill", headers=auth_headers(state_officer_token)
        )
        assert resp.status_code == 201
        assert resp.json()["attempted"] == []
        assert alert_id not in store.watchlist
        assert len(store.audit_chain) == before  # no spurious audit entry

    def test_concurrent_backfills_do_not_double_attempt(
        self, store: Store, app, state_officer_token: str
    ):
        """Two concurrent backfill calls for the same alert must not both
        claim the same week -- the in_flight reservation taken under
        store.lock (released before provider I/O) prevents the race, the
        same way it does for two concurrent forward capture runs."""
        case_id, alert_id = case_with_alert_tier(store, "RED")
        freeze(store, datetime(2026, 8, 3, tzinfo=UTC))  # 31 weeks owed to the floor

        class SlowProvider(FakeProvider):
            def fetch(self, *, geometry, week):
                time.sleep(0.05)
                return super().fetch(geometry=geometry, week=week)

        slow_provider = SlowProvider()
        store.imagery_provider = slow_provider

        results: list[dict] = [None, None]  # type: ignore[list-item]

        def call(index: int) -> None:
            local_client = TestClient(app)
            resp = local_client.post(
                f"/cases/{case_id}/imagery/backfill",
                json={"max_weeks": 20},
                headers=auth_headers(state_officer_token),
            )
            results[index] = resp.json()

        t1 = threading.Thread(target=call, args=(0,))
        t2 = threading.Thread(target=call, args=(1,))
        t1.start()
        t2.start()
        t1.join(timeout=20)
        t2.join(timeout=20)

        combined_weeks = [a["week"] for a in results[0]["attempted"]] + [
            a["week"] for a in results[1]["attempted"]
        ]
        # Together the two racing 20-week-capped calls cover all 31 owed
        # weeks exactly once each -- neither re-fetched a week the other
        # had already reserved or recorded.
        assert len(combined_weeks) == len(set(combined_weeks)) == 31

        entry = store.watchlist[alert_id]
        assert len(entry.captures) == 31
        assert entry.in_flight == set()
        assert entry.started_on == DEFAULT_FLOOR
        weeks_order = [c.week for c in entry.captures]
        assert weeks_order == sorted(weeks_order)
