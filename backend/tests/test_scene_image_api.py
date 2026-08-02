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
import time
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
    return [aid for aid, a in store.alerts.items() if a["tier"] == "RED"]


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


class SlowBlobStore:
    """Wraps a `BlobStore`, sleeping inside `get` -- used to widen the
    window for the "lock not held while streaming" concurrency test."""

    def __init__(self, inner: BlobStore, delay: float) -> None:
        self._inner = inner
        self._delay = delay

    def put(self, data: bytes) -> str:
        return self._inner.put(data)

    def get(self, sha256: str) -> bytes:
        time.sleep(self._delay)
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
    return token_for("state-case-officer", Role.CASE_OFFICER, store.root_jurisdiction_id)


@pytest.fixture
def dist_b_officer_token(store: Store) -> str:
    return token_for("dist-b-officer", Role.CASE_OFFICER, store.district_b_id)


@pytest.fixture
def state_viewer_token(store: Store) -> str:
    return token_for("state-viewer", Role.VIEWER, store.root_jurisdiction_id)


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
        """A slow blob read must not stall an unrelated store.lock-using
        request -- the whole point of releasing the lock before touching
        the blob store."""
        alert_id, _ = first_red_alert(store)
        other_alert_id = next(aid for aid in all_red_alerts(store) if aid != alert_id)

        setup_client = TestClient(app)
        freeze(store, datetime(2026, 8, 3, tzinfo=UTC))
        store.imagery_provider = FakeProvider()
        setup_client.post(f"/alerts/{alert_id}/watch", headers=auth_headers(state_officer_token))
        setup_client.post(
            f"/watchlist/{alert_id}/captures", headers=auth_headers(state_officer_token)
        )

        # Now make every subsequent blob read slow.
        store.scene_registry.blob_store = SlowBlobStore(
            store.scene_registry.blob_store, delay=0.4
        )

        image_status: dict[str, int] = {}

        def slow_image_request() -> None:
            local_client = TestClient(app)
            resp = local_client.get(
                f"/watchlist/{alert_id}/weeks/2026-W32/image",
                headers=auth_headers(state_officer_token),
            )
            image_status["code"] = resp.status_code

        thread = threading.Thread(target=slow_image_request)
        start = time.monotonic()
        thread.start()
        time.sleep(0.1)  # let the slow request get past its audit write

        other_client = TestClient(app)
        other_resp = other_client.post(
            f"/alerts/{other_alert_id}/watch", headers=auth_headers(state_officer_token)
        )
        unblocked_elapsed = time.monotonic() - start

        thread.join(timeout=5)
        assert image_status["code"] == 200
        assert other_resp.status_code == 201
        # The unrelated request must not have waited out the slow read.
        assert unblocked_elapsed < 0.4


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
