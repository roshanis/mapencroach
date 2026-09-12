"""Tests for retrieving retained scene bytes over HTTP.

Endpoints under test:
    GET /watchlist/{alert_id}/weeks/{week}/image
    GET /cases/{case_id}/imagery/{week}/image

See contract-blobs.md section 3 for the exact response/behavior contract:
200 with the raw bytes, a strong ETag of the sha256, immutable
Cache-Control, 304 on a matching If-None-Match, 422 for a malformed week
key, and 404 for every other cause (out-of-scope indistinguishable from
missing; week never captured, wrong status, or bytes not retained each
distinguishable from one another).

Like test_watchlist_api.py / test_case_imagery_api.py, these tests never
touch the network -- `store.imagery_provider` is always a `FakeProvider`,
and `store.scene_registry` is rebuilt on a `MemoryBlobStore` so retained
bytes never touch disk either.
"""

import threading
from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient

from mapencroach.api.app import create_app
from mapencroach.api.auth import Role, create_token
from mapencroach.api.store import Store
from mapencroach.audit.chain import verify_chain
from mapencroach.imagery.blobstore import BlobStore, MemoryBlobStore
from mapencroach.imagery.capture import CaptureAttempt, CaptureStatus, ProviderScene
from mapencroach.imagery.registry import SceneRegistry

SECRET = "test-fixture-signing-secret-not-the-dev-default"  # noqa: S105 - test fixture, not a real credential

PNG_BYTES = b"\x89PNG\r\n\x1a\nfake-scene-image-bytes"


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


def case_with_alert_tier(store: Store, tier: str) -> tuple[str, str]:
    for case_id, record in store.cases.items():
        alert = store.alerts[record.alert_id]
        if alert["tier"] == tier:
            return case_id, record.alert_id
    raise AssertionError(f"no seeded case with alert tier {tier!r}")


class FakeProvider:
    """Deterministic, network-free `ImageryProvider`, matching the fixture
    used by test_watchlist_api.py / test_case_imagery_api.py."""

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
            data=PNG_BYTES + week.key.encode(),
            scene_id=f"fake-{week.key}",
            captured_at=datetime.combine(week.start, datetime.min.time(), tzinfo=UTC),
            sensor="fake-sensor",
            resolution_m=10.0,
            cloud_pct=5.0,
            source="fake",
            href=f"fake://{week.key}",
        )


class GatedBlobStore:
    """Wraps a `BlobStore`, parking inside `get` until released.

    Replaces an earlier sleep-based version. That one widened the window
    with `time.sleep(0.4)` and the test asserted an unrelated request
    finished in under 0.4s -- a wall-clock race the machine could lose
    under load, which made a *concurrency* test fail intermittently for
    reasons unrelated to concurrency. An intermittently red test on the
    lock discipline is worse than no test: it trains everyone to re-run
    instead of investigate.

    Gating on events makes the ordering explicit instead of probable. The
    read blocks until the test releases it, so "did the unrelated request
    get through while the blob read was still in flight?" is answered by
    whether it completed at all, not by how fast it was.
    """

    def __init__(self, inner: BlobStore) -> None:
        self._inner = inner
        self.entered = threading.Event()
        self.release = threading.Event()

    def put(self, data: bytes) -> str:
        return self._inner.put(data)

    def get(self, sha256: str) -> bytes:
        self.entered.set()
        # Bounded so a regression fails the assertions below rather than
        # hanging the suite forever.
        self.release.wait(timeout=30)
        return self._inner.get(sha256)

    def has(self, sha256: str) -> bool:
        return self._inner.has(sha256)


@pytest.fixture
def store() -> Store:
    store = Store.seed_demo()
    # Retain bytes, but in memory -- these tests must never touch disk.
    store.scene_registry = SceneRegistry(blob_store=MemoryBlobStore())
    return store


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
def dist_b_officer_token(store: Store) -> str:
    return token_for("dist-b-officer", Role.CASE_OFFICER, store.district_b_id)


@pytest.fixture
def state_viewer_token(store: Store) -> str:
    return token_for("state-viewer", Role.VIEWER, store.primary_authority_id)


def watch_and_capture(
    client: TestClient,
    store: Store,
    token: str,
    alert_id: str,
    when: datetime,
    outcomes: dict | None = None,
) -> None:
    freeze(store, when)
    store.imagery_provider = FakeProvider(outcomes=outcomes)
    resp = client.post(f"/alerts/{alert_id}/watch", headers=auth_headers(token))
    assert resp.status_code in (201, 409)
    resp = client.post(f"/watchlist/{alert_id}/captures", headers=auth_headers(token))
    assert resp.status_code == 201


# ---------------------------------------------------------------------
# GET /watchlist/{alert_id}/weeks/{week}/image
# ---------------------------------------------------------------------


class TestWatchlistSceneImage:
    def test_stopping_monitoring_keeps_existing_image_links_and_case_images(
        self, client: TestClient, store: Store, state_officer_token: str
    ):
        case_id, alert_id = case_with_alert_tier(store, "RED")
        headers = auth_headers(state_officer_token)
        watch_and_capture(
            client, store, state_officer_token, alert_id, datetime(2026, 8, 3, tzinfo=UTC)
        )
        assert client.delete(f"/alerts/{alert_id}/watch", headers=headers).status_code == 204
        assert client.get(f"/watchlist/{alert_id}", headers=headers).status_code == 404
        assert client.post(f"/watchlist/{alert_id}/captures", headers=headers).status_code == 404
        for path in (
            f"/watchlist/{alert_id}/weeks/2026-W32/image",
            f"/cases/{case_id}/imagery/2026-W32/image",
        ):
            response = client.get(path, headers=headers)
            assert response.status_code == 200
            assert response.content == PNG_BYTES + b"2026-W32"

    def test_happy_path_returns_bytes_with_headers(
        self, client: TestClient, store: Store, state_officer_token: str
    ):
        alert_id, _ = first_red_alert(store)
        watch_and_capture(
            client, store, state_officer_token, alert_id, datetime(2026, 8, 3, tzinfo=UTC)
        )

        resp = client.get(
            f"/watchlist/{alert_id}/weeks/2026-W32/image", headers=auth_headers(state_officer_token)
        )
        assert resp.status_code == 200
        assert resp.content == PNG_BYTES + b"2026-W32"
        assert resp.headers["content-type"] == "image/png"
        assert resp.headers["cache-control"] == "private, max-age=31536000, immutable"

        record = store.scene_registry.get("fake-2026-W32")
        assert resp.headers["etag"] == f'"{record.sha256}"'

    def test_if_none_match_returns_304(
        self, client: TestClient, store: Store, state_officer_token: str
    ):
        alert_id, _ = first_red_alert(store)
        watch_and_capture(
            client, store, state_officer_token, alert_id, datetime(2026, 8, 3, tzinfo=UTC)
        )
        first = client.get(
            f"/watchlist/{alert_id}/weeks/2026-W32/image", headers=auth_headers(state_officer_token)
        )
        etag = first.headers["etag"]

        second = client.get(
            f"/watchlist/{alert_id}/weeks/2026-W32/image",
            headers={**auth_headers(state_officer_token), "If-None-Match": etag},
        )
        assert second.status_code == 304
        assert second.content == b""
        assert second.headers["etag"] == etag
        assert second.headers["cache-control"] == "private, max-age=31536000, immutable"

    def test_stale_if_none_match_still_returns_200(
        self, client: TestClient, store: Store, state_officer_token: str
    ):
        alert_id, _ = first_red_alert(store)
        watch_and_capture(
            client, store, state_officer_token, alert_id, datetime(2026, 8, 3, tzinfo=UTC)
        )
        resp = client.get(
            f"/watchlist/{alert_id}/weeks/2026-W32/image",
            headers={**auth_headers(state_officer_token), "If-None-Match": '"not-the-real-hash"'},
        )
        assert resp.status_code == 200
        assert resp.content == PNG_BYTES + b"2026-W32"

    def test_malformed_week_is_422(
        self, client: TestClient, store: Store, state_officer_token: str
    ):
        alert_id, _ = first_red_alert(store)
        resp = client.get(
            f"/watchlist/{alert_id}/weeks/not-a-week/image",
            headers=auth_headers(state_officer_token),
        )
        assert resp.status_code == 422

    def test_nonexistent_iso_week_is_422(
        self, client: TestClient, store: Store, state_officer_token: str
    ):
        alert_id, _ = first_red_alert(store)
        resp = client.get(
            f"/watchlist/{alert_id}/weeks/2026-W99/image", headers=auth_headers(state_officer_token)
        )
        assert resp.status_code == 422

    def test_unknown_alert_is_404(self, client: TestClient, state_officer_token: str):
        resp = client.get(
            "/watchlist/no-such-alert/weeks/2026-W32/image",
            headers=auth_headers(state_officer_token),
        )
        assert resp.status_code == 404

    def test_out_of_scope_alert_is_404_indistinguishable_from_missing(
        self,
        client: TestClient,
        store: Store,
        state_officer_token: str,
        dist_b_officer_token: str,
    ):
        alert_id, alert = first_red_alert(store)  # dist-a
        assert store.parcels[alert["parcel_id"]]["jurisdiction_id"] in store.dist_a_scope
        watch_and_capture(
            client, store, state_officer_token, alert_id, datetime(2026, 8, 3, tzinfo=UTC)
        )

        out_of_scope = client.get(
            f"/watchlist/{alert_id}/weeks/2026-W32/image",
            headers=auth_headers(dist_b_officer_token),
        )
        missing = client.get(
            "/watchlist/no-such-alert/weeks/2026-W32/image",
            headers=auth_headers(dist_b_officer_token),
        )
        assert out_of_scope.status_code == missing.status_code == 404
        assert out_of_scope.json()["detail"] == missing.json()["detail"]

    def test_week_never_captured_is_404(
        self, client: TestClient, store: Store, state_officer_token: str
    ):
        alert_id, _ = first_red_alert(store)
        freeze(store, datetime(2026, 8, 3, tzinfo=UTC))
        client.post(f"/alerts/{alert_id}/watch", headers=auth_headers(state_officer_token))
        # No captures run at all.
        resp = client.get(
            f"/watchlist/{alert_id}/weeks/2026-W32/image", headers=auth_headers(state_officer_token)
        )
        assert resp.status_code == 404
        assert "no capture attempt" in resp.json()["detail"]

    def test_week_captured_but_not_watched_this_week_is_404(
        self, client: TestClient, store: Store, state_officer_token: str
    ):
        alert_id, _ = first_red_alert(store)
        watch_and_capture(
            client, store, state_officer_token, alert_id, datetime(2026, 8, 3, tzinfo=UTC)
        )
        resp = client.get(
            f"/watchlist/{alert_id}/weeks/2026-W20/image", headers=auth_headers(state_officer_token)
        )
        assert resp.status_code == 404
        assert "no capture attempt" in resp.json()["detail"]

    def test_no_usable_scene_week_is_404_naming_status(
        self, client: TestClient, store: Store, state_officer_token: str
    ):
        alert_id, _ = first_red_alert(store)
        watch_and_capture(
            client,
            store,
            state_officer_token,
            alert_id,
            datetime(2026, 8, 3, tzinfo=UTC),
            outcomes={"2026-W32": "none"},
        )
        resp = client.get(
            f"/watchlist/{alert_id}/weeks/2026-W32/image", headers=auth_headers(state_officer_token)
        )
        assert resp.status_code == 404
        assert "no_usable_scene" in resp.json()["detail"]

    def test_provider_error_week_is_404_naming_status(
        self, client: TestClient, store: Store, state_officer_token: str
    ):
        alert_id, _ = first_red_alert(store)
        watch_and_capture(
            client,
            store,
            state_officer_token,
            alert_id,
            datetime(2026, 8, 3, tzinfo=UTC),
            outcomes={"2026-W32": ValueError("boom")},
        )
        resp = client.get(
            f"/watchlist/{alert_id}/weeks/2026-W32/image", headers=auth_headers(state_officer_token)
        )
        assert resp.status_code == 404
        assert "provider_error" in resp.json()["detail"]

    def test_captured_but_not_retained_is_404_naming_retention(
        self, client: TestClient, store: Store, state_officer_token: str
    ):
        store.scene_registry = SceneRegistry()  # no blob store -> retained=False
        alert_id, _ = first_red_alert(store)
        watch_and_capture(
            client, store, state_officer_token, alert_id, datetime(2026, 8, 3, tzinfo=UTC)
        )
        resp = client.get(
            f"/watchlist/{alert_id}/weeks/2026-W32/image", headers=auth_headers(state_officer_token)
        )
        assert resp.status_code == 404
        assert "not retained" in resp.json()["detail"]

    def test_scene_missing_from_registry_is_404(
        self, client: TestClient, store: Store, state_officer_token: str
    ):
        """Defensive: a CaptureAttempt claims CAPTURED with a scene_id the
        registry doesn't actually hold (data-integrity edge case)."""
        alert_id, _ = first_red_alert(store)
        freeze(store, datetime(2026, 8, 3, tzinfo=UTC))
        client.post(f"/alerts/{alert_id}/watch", headers=auth_headers(state_officer_token))
        entry = store.watchlist[alert_id]
        entry.captures.append(
            CaptureAttempt(
                week="2026-W32",
                status=CaptureStatus.CAPTURED,
                attempted_at=datetime(2026, 8, 3, tzinfo=UTC),
                scene_id="ghost-scene",
                sha256="a" * 64,
            )
        )
        resp = client.get(
            f"/watchlist/{alert_id}/weeks/2026-W32/image", headers=auth_headers(state_officer_token)
        )
        assert resp.status_code == 404
        assert "not on record" in resp.json()["detail"]

    def test_viewer_can_read(
        self,
        client: TestClient,
        store: Store,
        state_officer_token: str,
        state_viewer_token: str,
    ):
        alert_id, _ = first_red_alert(store)
        watch_and_capture(
            client, store, state_officer_token, alert_id, datetime(2026, 8, 3, tzinfo=UTC)
        )
        resp = client.get(
            f"/watchlist/{alert_id}/weeks/2026-W32/image", headers=auth_headers(state_viewer_token)
        )
        assert resp.status_code == 200

    def test_read_is_audit_logged(
        self, client: TestClient, store: Store, state_officer_token: str
    ):
        alert_id, _ = first_red_alert(store)
        watch_and_capture(
            client, store, state_officer_token, alert_id, datetime(2026, 8, 3, tzinfo=UTC)
        )
        before = len(store.audit_chain)
        resp = client.get(
            f"/watchlist/{alert_id}/weeks/2026-W32/image", headers=auth_headers(state_officer_token)
        )
        assert resp.status_code == 200
        assert len(store.audit_chain) == before + 1
        entry = store.audit_chain[-1]
        assert entry.payload["action"] == "scene.read"
        assert entry.payload["object_id"] == "fake-2026-W32"
        assert entry.payload["object_type"] == "scene"
        assert entry.payload["actor"] == "state-case-officer"
        assert verify_chain(store.audit_chain).ok

    def test_304_read_is_also_audit_logged(
        self, client: TestClient, store: Store, state_officer_token: str
    ):
        alert_id, _ = first_red_alert(store)
        watch_and_capture(
            client, store, state_officer_token, alert_id, datetime(2026, 8, 3, tzinfo=UTC)
        )
        first = client.get(
            f"/watchlist/{alert_id}/weeks/2026-W32/image", headers=auth_headers(state_officer_token)
        )
        before = len(store.audit_chain)
        second = client.get(
            f"/watchlist/{alert_id}/weeks/2026-W32/image",
            headers={**auth_headers(state_officer_token), "If-None-Match": first.headers["etag"]},
        )
        assert second.status_code == 304
        assert len(store.audit_chain) == before + 1
        assert verify_chain(store.audit_chain).ok

    def test_404_is_not_audit_logged(
        self, client: TestClient, store: Store, state_officer_token: str
    ):
        alert_id, _ = first_red_alert(store)
        before = len(store.audit_chain)
        resp = client.get(
            f"/watchlist/{alert_id}/weeks/2026-W32/image", headers=auth_headers(state_officer_token)
        )
        assert resp.status_code == 404
        assert len(store.audit_chain) == before

    def test_lock_not_held_while_streaming_bytes(
        self, store: Store, app, state_officer_token: str
    ):
        """A blob read in flight must not stall an unrelated request that
        needs `store.lock` -- the whole point of releasing the lock before
        touching the blob store.

        Proved by ordering, not by a stopwatch: the read is parked inside
        the blob store and is NOT released until the unrelated request has
        already completed. If the handler held the lock across the read,
        the unrelated request could not finish, and its bounded join below
        fails. No wall-clock threshold, so load cannot turn this red.
        """
        alert_id, _ = first_red_alert(store)
        other_alert_id = next(aid for aid in all_red_alerts(store) if aid != alert_id)

        setup_client = TestClient(app)
        freeze(store, datetime(2026, 8, 3, tzinfo=UTC))
        store.imagery_provider = FakeProvider()
        setup_client.post(f"/alerts/{alert_id}/watch", headers=auth_headers(state_officer_token))
        setup_client.post(
            f"/watchlist/{alert_id}/captures", headers=auth_headers(state_officer_token)
        )

        gate = GatedBlobStore(store.scene_registry.blob_store)
        store.scene_registry.blob_store = gate

        image_status: dict[str, int] = {}
        other_status: dict[str, int] = {}

        def parked_image_request() -> None:
            resp = TestClient(app).get(
                f"/watchlist/{alert_id}/weeks/2026-W32/image",
                headers=auth_headers(state_officer_token),
            )
            image_status["code"] = resp.status_code

        def unrelated_request() -> None:
            resp = TestClient(app).post(
                f"/alerts/{other_alert_id}/watch",
                headers=auth_headers(state_officer_token),
            )
            other_status["code"] = resp.status_code

        image_thread = threading.Thread(target=parked_image_request)
        image_thread.start()
        try:
            # The read is now inside the blob store and stays there.
            assert gate.entered.wait(timeout=10), "blob read never started"

            other_thread = threading.Thread(target=unrelated_request)
            other_thread.start()
            # Runs to completion while the blob read is still parked. In a
            # thread with a bounded join so a regression fails here instead
            # of hanging the suite.
            other_thread.join(timeout=10)
            assert not other_thread.is_alive(), (
                "an unrelated store.lock request blocked behind an in-flight "
                "blob read: the lock is being held across blob I/O"
            )
            assert other_status.get("code") == 201
        finally:
            gate.release.set()
            image_thread.join(timeout=10)

        assert image_status.get("code") == 200


# ---------------------------------------------------------------------
# GET /cases/{case_id}/imagery/{week}/image
# ---------------------------------------------------------------------


class TestCaseSceneImage:
    def test_happy_path_returns_bytes_with_headers(
        self, client: TestClient, store: Store, state_officer_token: str
    ):
        case_id, alert_id = case_with_alert_tier(store, "RED")
        watch_and_capture(
            client, store, state_officer_token, alert_id, datetime(2026, 8, 3, tzinfo=UTC)
        )

        resp = client.get(
            f"/cases/{case_id}/imagery/2026-W32/image", headers=auth_headers(state_officer_token)
        )
        assert resp.status_code == 200
        assert resp.content == PNG_BYTES + b"2026-W32"
        assert resp.headers["content-type"] == "image/png"
        assert resp.headers["cache-control"] == "private, max-age=31536000, immutable"
        record = store.scene_registry.get("fake-2026-W32")
        assert resp.headers["etag"] == f'"{record.sha256}"'

    def test_if_none_match_returns_304(
        self, client: TestClient, store: Store, state_officer_token: str
    ):
        case_id, alert_id = case_with_alert_tier(store, "RED")
        watch_and_capture(
            client, store, state_officer_token, alert_id, datetime(2026, 8, 3, tzinfo=UTC)
        )
        first = client.get(
            f"/cases/{case_id}/imagery/2026-W32/image", headers=auth_headers(state_officer_token)
        )
        second = client.get(
            f"/cases/{case_id}/imagery/2026-W32/image",
            headers={**auth_headers(state_officer_token), "If-None-Match": first.headers["etag"]},
        )
        assert second.status_code == 304

    def test_malformed_week_is_422(
        self, client: TestClient, store: Store, state_officer_token: str
    ):
        case_id, _ = case_with_alert_tier(store, "RED")
        resp = client.get(
            f"/cases/{case_id}/imagery/nope/image", headers=auth_headers(state_officer_token)
        )
        assert resp.status_code == 422

    def test_unknown_case_is_404(self, client: TestClient, state_officer_token: str):
        resp = client.get(
            "/cases/no-such-case/imagery/2026-W32/image", headers=auth_headers(state_officer_token)
        )
        assert resp.status_code == 404

    def test_out_of_scope_case_is_404_indistinguishable_from_missing(
        self, client: TestClient, store: Store, dist_b_officer_token: str
    ):
        case_id, _ = case_with_alert_tier(store, "RED")  # dist-a
        out_of_scope = client.get(
            f"/cases/{case_id}/imagery/2026-W32/image", headers=auth_headers(dist_b_officer_token)
        )
        missing = client.get(
            "/cases/no-such-case/imagery/2026-W32/image", headers=auth_headers(dist_b_officer_token)
        )
        assert out_of_scope.status_code == missing.status_code == 404
        assert out_of_scope.json()["detail"] == missing.json()["detail"]

    def test_case_with_no_timeline_at_all_is_404(
        self, client: TestClient, store: Store, state_officer_token: str
    ):
        case_id, alert_id = case_with_alert_tier(store, "RED")
        assert alert_id not in store.watchlist
        resp = client.get(
            f"/cases/{case_id}/imagery/2026-W32/image", headers=auth_headers(state_officer_token)
        )
        assert resp.status_code == 404
        assert "no capture attempt" in resp.json()["detail"]

    def test_week_never_captured_is_404(
        self, client: TestClient, store: Store, state_officer_token: str
    ):
        case_id, alert_id = case_with_alert_tier(store, "RED")
        freeze(store, datetime(2026, 8, 3, tzinfo=UTC))
        client.post(f"/alerts/{alert_id}/watch", headers=auth_headers(state_officer_token))
        resp = client.get(
            f"/cases/{case_id}/imagery/2026-W32/image", headers=auth_headers(state_officer_token)
        )
        assert resp.status_code == 404
        assert "no capture attempt" in resp.json()["detail"]

    def test_not_retained_is_404_naming_retention(
        self, client: TestClient, store: Store, state_officer_token: str
    ):
        store.scene_registry = SceneRegistry()
        case_id, alert_id = case_with_alert_tier(store, "RED")
        watch_and_capture(
            client, store, state_officer_token, alert_id, datetime(2026, 8, 3, tzinfo=UTC)
        )
        resp = client.get(
            f"/cases/{case_id}/imagery/2026-W32/image", headers=auth_headers(state_officer_token)
        )
        assert resp.status_code == 404
        assert "not retained" in resp.json()["detail"]

    def test_backfilled_week_is_servable(
        self, client: TestClient, store: Store, state_officer_token: str
    ):
        case_id, alert_id = case_with_alert_tier(store, "RED")
        freeze(store, datetime(2026, 1, 15, tzinfo=UTC))  # 2026-W03
        store.imagery_provider = FakeProvider()
        resp = client.post(
            f"/cases/{case_id}/imagery/backfill",
            json={"max_weeks": 52},
            headers=auth_headers(state_officer_token),
        )
        assert resp.status_code == 201

        image_resp = client.get(
            f"/cases/{case_id}/imagery/2026-W01/image", headers=auth_headers(state_officer_token)
        )
        assert image_resp.status_code == 200
        assert image_resp.content == PNG_BYTES + b"2026-W01"

    def test_viewer_can_read(
        self, client: TestClient, store: Store, state_officer_token: str, state_viewer_token: str
    ):
        case_id, alert_id = case_with_alert_tier(store, "RED")
        watch_and_capture(
            client, store, state_officer_token, alert_id, datetime(2026, 8, 3, tzinfo=UTC)
        )
        resp = client.get(
            f"/cases/{case_id}/imagery/2026-W32/image", headers=auth_headers(state_viewer_token)
        )
        assert resp.status_code == 200

    def test_read_is_audit_logged(
        self, client: TestClient, store: Store, state_officer_token: str
    ):
        case_id, alert_id = case_with_alert_tier(store, "RED")
        watch_and_capture(
            client, store, state_officer_token, alert_id, datetime(2026, 8, 3, tzinfo=UTC)
        )
        before = len(store.audit_chain)
        resp = client.get(
            f"/cases/{case_id}/imagery/2026-W32/image", headers=auth_headers(state_officer_token)
        )
        assert resp.status_code == 200
        assert len(store.audit_chain) == before + 1
        entry = store.audit_chain[-1]
        assert entry.payload["action"] == "scene.read"
        assert entry.payload["object_type"] == "scene"
        assert verify_chain(store.audit_chain).ok


def test_capture_details_match_watch_and_case_and_exclude_assets(client, store):
    case_id, alert_id = case_with_alert_tier(store, "RED")
    freeze(store, datetime(2026, 8, 9, tzinfo=UTC))
    store.imagery_provider = FakeProvider()
    headers = auth_headers(token_for("officer", Role.CASE_OFFICER, store.primary_authority_id))
    assert client.post(f"/alerts/{alert_id}/watch", headers=headers).status_code == 201
    post = client.post(f"/watchlist/{alert_id}/captures", headers=headers)
    assert post.status_code == 201
    details = post.json()[0]["scene_details"]
    watch = client.get(f"/watchlist/{alert_id}", headers=headers).json()
    case = client.get(f"/cases/{case_id}/imagery", headers=headers).json()
    assert watch["captures"][0]["scene_details"] == details
    assert case["captures"][0]["scene_details"] == details
    assert details["captured_at"] != post.json()[0]["attempted_at"]
    assert details["metadata_status"] == "available"
    assert "stac_item" not in details
    assert "href" not in details


@pytest.mark.parametrize("hash_value", [None, "0" * 64])
def test_scene_image_refuses_missing_or_mismatched_capture_hash(client, store, hash_value):
    from dataclasses import replace

    case_id, alert_id = case_with_alert_tier(store, "RED")
    freeze(store, datetime(2026, 8, 9, tzinfo=UTC))
    store.imagery_provider = FakeProvider()
    headers = auth_headers(token_for("officer", Role.CASE_OFFICER, store.primary_authority_id))
    client.post(f"/alerts/{alert_id}/watch", headers=headers)
    client.post(f"/watchlist/{alert_id}/captures", headers=headers)
    attempt = store.watchlist[alert_id].captures[0]
    store.watchlist[alert_id].captures[0] = replace(attempt, sha256=hash_value)
    for url in [f"/watchlist/{alert_id}/weeks/{attempt.week}/image",
                f"/cases/{case_id}/imagery/{attempt.week}/image"]:
        response = client.get(url, headers=headers)
        assert response.status_code == 409
        assert response.json()["detail"] == "Scene integrity could not be verified"


def test_backfill_metadata_survives_case_transfer_without_granting_watch_access(client, store):
    case_id, alert_id = case_with_alert_tier(store, "RED")
    freeze(store, datetime(2026, 8, 9, tzinfo=UTC))
    store.imagery_provider = FakeProvider()
    all_access = auth_headers(token_for("officer", Role.CASE_OFFICER, store.primary_authority_id))
    result = client.post(f"/cases/{case_id}/imagery/backfill", headers=all_access,
                         json={"from": "2026-08-01", "max_weeks": 2})
    assert result.status_code == 201
    projected = {c["week"]: c["scene_details"] for c in result.json()["attempted"]}
    assert projected and all(d["metadata_status"] == "available" for d in projected.values())
    listing = client.get("/watchlist", headers=all_access).json()
    entry = next(e for e in listing if e["alert_id"] == alert_id)
    assert {c["week"]: c["scene_details"] for c in entry["captures"]} == projected
    origin_id = store.cases[case_id].jurisdiction_id
    transfer = client.post(f"/cases/{case_id}/transfer", headers=all_access,
                           json={"to_jurisdiction_id": store.district_b_id,
                                 "reason": "Review handover"})
    assert transfer.status_code == 200
    outgoing = auth_headers(token_for("outgoing", Role.VIEWER, origin_id))
    incoming = auth_headers(token_for("incoming", Role.VIEWER, store.district_b_id))
    assert client.get(f"/cases/{case_id}/imagery", headers=outgoing).status_code == 404
    case = client.get(f"/cases/{case_id}/imagery", headers=incoming)
    assert case.status_code == 200
    assert {c["week"]: c["scene_details"] for c in case.json()["captures"]} == projected
    assert client.get(f"/watchlist/{alert_id}", headers=incoming).status_code == 404
    assert client.get(f"/cases/{case_id}/imagery").status_code == 401
