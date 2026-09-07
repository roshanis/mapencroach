from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient

from conftest import TEST_JWT_SECRET
from mapencroach.api.app import create_app
from mapencroach.api.auth import Role, create_token
from mapencroach.api.store import Store
from mapencroach.domain.case_engine import CaseState, MissingArtifact, _check_artifacts


@pytest.mark.parametrize("value", ["", "   ", None, 17])
def test_required_artifact_rejects_empty_or_nontext(value):
    with pytest.raises(MissingArtifact):
        _check_artifacts(CaseState.TRIAGED, {"triage_note": value}, ("triage_note",))


@pytest.mark.parametrize("value", ["tomorrow", "2026-02-30", "20260907"])
def test_hearing_requires_real_iso_date(value):
    with pytest.raises(ValueError, match="hearing_date"):
        _check_artifacts(CaseState.HEARING_SCHEDULED, {"hearing_date": value}, ("hearing_date",))


def headers(store):
    token = create_token(
        sub="review-fixture",
        role=Role.CASE_OFFICER,
        jurisdiction_id=store.primary_authority_id,
        secret=TEST_JWT_SECRET,
        expires_at=datetime.now(UTC) + timedelta(hours=1),
    )
    return {"Authorization": f"Bearer {token}"}


def test_case_summary_includes_next_steps_without_detail_fanout():
    store = Store.seed_demo()
    client = TestClient(create_app(store))
    rows = client.get("/cases", headers=headers(store)).json()
    assert rows
    for row in rows:
        detail = client.get(f"/cases/{row['id']}", headers=headers(store)).json()
        assert row["allowed_transitions"] == detail["allowed_transitions"]


def test_retry_failed_week_is_explicit_and_preserves_attempts():
    store = Store.seed_demo()
    store.clock = lambda: datetime(2026, 9, 7, tzinfo=UTC)
    alert = next(
        a
        for a in store.alerts.values()
        if a["tier"] == "RED"
        and store.parcels[a["parcel_id"]]["jurisdiction_id"]
        in store.tree.scope_ids(store.primary_authority_id)
    )

    class Unavailable:
        calls = 0

        def fetch(self, **kwargs):
            self.calls += 1
            raise RuntimeError("temporary fixture failure")

    provider = Unavailable()
    store.imagery_provider = provider
    client = TestClient(create_app(store))
    auth = headers(store)
    client.post(f"/alerts/{alert['id']}/watch", headers=auth)
    url = f"/watchlist/{alert['id']}/captures"
    assert client.post(url, headers=auth).json()[0]["status"] == "provider_error"
    assert client.post(url, headers=auth).json() == []
    retry = client.post(url + "?retry_errors=true", headers=auth)
    assert len(retry.json()) == 1
    assert provider.calls == 2
    assert len(store.watchlist[alert["id"]].captures) == 2

    from mapencroach.imagery.capture import ProviderScene

    class Available:
        def fetch(self, *, geometry, week):
            return ProviderScene(
                data=b"retry-test-image",
                scene_id="retry-scene",
                captured_at=store.clock(),
                sensor="test",
                resolution_m=10,
                cloud_pct=0,
                source="test",
                href="https://example.test/image",
            )

    store.imagery_provider = Available()
    success = client.post(url + "?retry_errors=true", headers=auth)
    assert success.json()[0]["status"] == "captured"
    assert (
        client.get(f"/watchlist/{alert['id']}/weeks/2026-W37/image", headers=auth).status_code
        == 200
    )
    assert client.post(url + "?retry_errors=true", headers=auth).json() == []


def test_failed_publication_blocks_reads_and_readiness(tmp_path):
    from mapencroach.persistence import StatePersister, hydrate_store

    store = Store.seed_demo()
    path = tmp_path / "state.json"
    hydrate_store(store, StatePersister(path))
    store.persist_now()
    # A competing writer changes the file; the stale app must not serve its mutations.
    path.write_text(path.read_text() + "\n")
    client = TestClient(create_app(store), raise_server_exceptions=False)
    parcel = next(iter(store.parcels))
    result = client.post(
        f"/parcels/{parcel}/tags", headers=headers(store), json={"tag": "reviewed"}
    )
    assert result.status_code == 500
    assert client.get("/cases", headers=headers(store)).status_code == 503
    assert client.get("/health").status_code == 503


def test_transition_persists_full_event_and_restarts_without_reset(tmp_path):
    from mapencroach.persistence import StatePersister, hydrate_store

    store = Store.seed_demo()
    path = tmp_path / "state.json"
    hydrate_store(store, StatePersister(path))
    record = next(
        r
        for r in store.cases.values()
        if r.jurisdiction_id in store.tree.scope_ids(store.primary_authority_id)
    )
    record.case.state = CaseState.NEW
    record.case.events = []
    client = TestClient(create_app(store))
    result = client.post(
        f"/cases/{record.case.case_id}/transitions",
        headers=headers(store),
        json={
            "to_state": "TRIAGED",
            "artifacts": {"triage_note": "field review"},
            "note": "reviewed",
        },
    )
    assert result.status_code == 201
    restored = Store.seed_demo()
    hydrate_store(restored, StatePersister(path))
    assert restored.cases[record.case.case_id].case.state == CaseState.TRIAGED
    event = restored.audit_chain[-1].payload
    assert event["artifacts"] == {"triage_note": "field review"}
    assert event["from_state"] == "NEW"
    assert event["to_state"] == "TRIAGED"
