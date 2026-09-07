import json
from datetime import UTC, datetime

import pytest

from mapencroach.api.store import Store
from mapencroach.domain.case_engine import CaseState, transition
from mapencroach.persistence import StatePersister, hydrate_store


def test_restart_retains_operational_records_and_existing_inventory(tmp_path):
    store = Store.seed_demo()
    path = tmp_path / "state.json"
    hydrate_store(store, StatePersister(path))
    parcel_id = next(iter(store.parcels))
    store.parcels[parcel_id]["tags"] = ["reviewed"]
    record = next(iter(store.cases.values()))
    record.jurisdiction_id = store.district_b_id
    record.case.state = CaseState.TRIAGED
    record.case.events = []
    transition(
        record.case,
        CaseState.STAYED_BY_COURT,
        "officer",
        datetime.now(UTC),
        {"stay_order_ref": "order-17"},
    )
    store.persist_now()
    restored = Store.seed_demo()
    hydrate_store(restored, StatePersister(path))
    assert restored.parcels == store.parcels
    assert restored.alerts == store.alerts
    assert restored.cases == store.cases
    assert restored.authority_ids == store.authority_ids
    assert restored.jurisdiction_rows == store.jurisdiction_rows
    assert json.loads(path.read_text())["version"] == 3


def test_stale_process_cannot_overwrite_newer_operational_state(tmp_path):
    path = tmp_path / "state.json"
    first, second = Store.seed_demo(), Store.seed_demo()
    hydrate_store(first, StatePersister(path))
    hydrate_store(second, StatePersister(path))
    first.persist_now()
    before = path.read_bytes()
    with pytest.raises(RuntimeError, match="changed|stale"):
        second.persist_now()
    assert path.read_bytes() == before
    assert second.state_persister.failed


def test_existing_version_2_loads_without_inventing_operational_data(tmp_path):
    path = tmp_path / "state.json"
    path.write_text(
        json.dumps({"version": 2, "watchlist": [], "scene_records": [], "audit_chain": []})
    )
    store = Store.seed_demo()
    parcels = dict(store.parcels)
    hydrate_store(store, StatePersister(path))
    assert store.parcels == parcels
    store.persist_now()
    assert json.loads(path.read_text())["version"] == 3


def test_operational_tampering_cannot_hide_behind_valid_audit(tmp_path):
    from mapencroach.persistence import StateCorruptionError

    store = Store.seed_demo()
    path = tmp_path / "state.json"
    hydrate_store(store, StatePersister(path))
    store.persist_now()
    payload = json.loads(path.read_text())
    payload["operational"]["cases"][0]["state"] = "CLOSED"
    payload["operational"]["cases"][0]["events"] = []
    path.write_text(json.dumps(payload))
    with pytest.raises(StateCorruptionError):
        hydrate_store(Store.seed_demo(), StatePersister(path))
