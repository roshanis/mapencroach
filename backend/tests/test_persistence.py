"""Tests for `mapencroach.persistence` -- crash-safe, on-disk persistence
of the evidence-bearing parts of `Store` (watchlist, scene-registry index,
audit chain).

Covers: save/load round trip for all three state kinds, exact datetime/
enum fidelity on `CaptureAttempt`, the audit chain verifying after a
reload, a tampered-on-disk chain being detected (not silently trusted),
a corrupt/truncated file failing loudly at load, crash-safety of the
write path, env-driven path resolution, and that a plain `Store()` /
`Store.seed_demo()` never touches disk unless something explicitly wires
persistence in (`build_store`). Never touches the network.
"""

import json
import os
from datetime import UTC, date, datetime
from pathlib import Path

import pytest

from mapencroach.api.store import Store, WatchEntryRecord
from mapencroach.audit.chain import AuditEntry, verify_chain
from mapencroach.imagery.capture import CaptureAttempt, CaptureStatus
from mapencroach.imagery.registry import SceneRecord
from mapencroach.persistence import (
    StateCorruptionError,
    StatePersister,
    build_state_persister,
    build_store,
    default_state_path,
    hydrate_store,
)

CAPTURED_AT = datetime(2026, 1, 5, 12, 30, 45, tzinfo=UTC)
ATTEMPTED_AT = datetime(2026, 1, 6, 8, 0, 0, tzinfo=UTC)


def make_watch_entry(alert_id: str = "alert-1") -> WatchEntryRecord:
    return WatchEntryRecord(
        alert_id=alert_id,
        parcel_id="parcel-1",
        started_on=date(2026, 1, 1),
        watched_by="officer-1",
        captures=[
            CaptureAttempt(
                week="2026-W01",
                status=CaptureStatus.CAPTURED,
                attempted_at=ATTEMPTED_AT,
                scene_id="scene-1",
                sha256="a" * 64,
                cloud_pct=12.5,
            ),
            CaptureAttempt(
                week="2026-W02",
                status=CaptureStatus.NO_USABLE_SCENE,
                attempted_at=ATTEMPTED_AT,
                cloud_pct=88.0,
                reason="cloud cover 88.0% exceeds max 40.0%",
            ),
            CaptureAttempt(
                week="2026-W03",
                status=CaptureStatus.PROVIDER_ERROR,
                attempted_at=ATTEMPTED_AT,
                reason="provider error: upstream is on fire",
            ),
        ],
    )


def make_scene_record(scene_id: str = "scene-1", sha256: str = "a" * 64) -> SceneRecord:
    return SceneRecord(
        scene_id=scene_id,
        sha256=sha256,
        captured_at=CAPTURED_AT,
        sensor="fake-sensor",
        resolution_m=10.0,
        cloud_pct=12.5,
        source="fake",
        # Deliberately no list-valued fields here: after a save/load round
        # trip, `stac_item` comes back frozen (MappingProxyType/tuple, see
        # `persistence._freeze`) to match what `SceneRegistry.register`
        # actually produces -- a plain `dict` with a nested `list` would
        # compare unequal to its frozen `tuple` counterpart even though
        # the content is identical, which is a quirk of this test fixture
        # bypassing `register()`, not a real round-trip bug.
        stac_item={
            "id": scene_id,
            "properties": {"datetime": CAPTURED_AT.isoformat(), "eo:cloud_cover": 12.5},
            "assets": {"data": {"href": f"fake://{scene_id}"}},
        },
        media_type="image/png",
        retained=True,
    )


def make_audit_chain() -> list[AuditEntry]:
    chain: list[AuditEntry] = []
    from mapencroach.audit.chain import append_entry

    append_entry(
        chain,
        {
            "actor": "system",
            "action": "watch.create",
            "object_type": "watch",
            "object_id": "alert-1",
        },
    )
    append_entry(
        chain,
        {
            "actor": "officer-1",
            "action": "watch.capture_run",
            "object_type": "watch",
            "object_id": "alert-1",
        },
    )
    return chain


def populate_store(store: Store) -> None:
    entry = make_watch_entry()
    store.watchlist[entry.alert_id] = entry
    record = make_scene_record()
    store.scene_registry._by_id[record.scene_id] = record  # noqa: SLF001
    store.scene_registry._by_hash[record.sha256] = record  # noqa: SLF001
    store.audit_chain.extend(make_audit_chain())


# ---------------------------------------------------------------------
# Save/load round trip
# ---------------------------------------------------------------------


class TestRoundTrip:
    def test_watchlist_round_trips_exactly(self, tmp_path):
        store = Store()
        populate_store(store)
        persister = StatePersister(tmp_path / "state.json")

        persister.save(store)
        loaded = persister.load()

        assert loaded is not None
        assert set(loaded.watchlist) == {"alert-1"}
        loaded_entry = loaded.watchlist["alert-1"]
        original_entry = store.watchlist["alert-1"]
        assert loaded_entry.alert_id == original_entry.alert_id
        assert loaded_entry.parcel_id == original_entry.parcel_id
        assert loaded_entry.started_on == original_entry.started_on
        assert loaded_entry.watched_by == original_entry.watched_by
        assert loaded_entry.captures == original_entry.captures
        # in_flight is process-local bookkeeping, never persisted.
        assert loaded_entry.in_flight == set()

    def test_scene_registry_round_trips_exactly(self, tmp_path):
        store = Store()
        populate_store(store)
        persister = StatePersister(tmp_path / "state.json")

        persister.save(store)
        loaded = persister.load()

        assert loaded is not None
        assert len(loaded.scene_records) == 1
        loaded_record = loaded.scene_records[0]
        original_record = store.scene_registry.get("scene-1")
        assert loaded_record == original_record

    def test_audit_chain_round_trips_exactly(self, tmp_path):
        store = Store()
        populate_store(store)
        persister = StatePersister(tmp_path / "state.json")

        persister.save(store)
        loaded = persister.load()

        assert loaded is not None
        assert loaded.audit_chain == store.audit_chain

    def test_empty_store_round_trips_to_empty_state(self, tmp_path):
        store = Store()
        persister = StatePersister(tmp_path / "state.json")

        persister.save(store)
        loaded = persister.load()

        assert loaded is not None
        assert loaded.watchlist == {}
        assert loaded.scene_records == []
        assert loaded.audit_chain == []

    def test_load_of_nonexistent_file_returns_none(self, tmp_path):
        persister = StatePersister(tmp_path / "does-not-exist.json")
        assert persister.load() is None

    def test_scene_record_with_list_valued_stac_item_fields_round_trips_content(self, tmp_path):
        """`stac_item` can contain list-valued fields (e.g. a registered
        scene's provenance array) -- these come back frozen as tuples
        (matching what `SceneRegistry.register` actually produces), so
        assert on *content* via `_unfreeze` rather than raw equality."""
        from mapencroach.persistence import _unfreeze

        store = Store()
        record = make_scene_record()
        record = SceneRecord(
            scene_id=record.scene_id,
            sha256=record.sha256,
            captured_at=record.captured_at,
            sensor=record.sensor,
            resolution_m=record.resolution_m,
            cloud_pct=record.cloud_pct,
            source=record.source,
            stac_item={**record.stac_item, "provenance": ["ingest", "hash", "retain"]},
            media_type=record.media_type,
            retained=record.retained,
        )
        store.scene_registry._by_id[record.scene_id] = record  # noqa: SLF001
        store.scene_registry._by_hash[record.sha256] = record  # noqa: SLF001
        persister = StatePersister(tmp_path / "state.json")

        persister.save(store)
        loaded = persister.load()

        loaded_record = loaded.scene_records[0]
        assert _unfreeze(loaded_record.stac_item) == _unfreeze(record.stac_item)
        assert loaded_record.stac_item["provenance"] == ("ingest", "hash", "retain")

    def test_multiple_watch_entries_round_trip(self, tmp_path):
        store = Store()
        store.watchlist["alert-1"] = make_watch_entry("alert-1")
        store.watchlist["alert-2"] = make_watch_entry("alert-2")
        persister = StatePersister(tmp_path / "state.json")

        persister.save(store)
        loaded = persister.load()

        assert loaded is not None
        assert set(loaded.watchlist) == {"alert-1", "alert-2"}


# ---------------------------------------------------------------------
# Exact datetime / enum fidelity
# ---------------------------------------------------------------------


class TestDatetimeAndEnumFidelity:
    def test_attempted_at_round_trips_as_aware_datetime(self, tmp_path):
        store = Store()
        populate_store(store)
        persister = StatePersister(tmp_path / "state.json")
        persister.save(store)
        loaded = persister.load()

        attempt = loaded.watchlist["alert-1"].captures[0]
        assert isinstance(attempt.attempted_at, datetime)
        assert attempt.attempted_at == ATTEMPTED_AT
        assert attempt.attempted_at.tzinfo is not None
        assert attempt.attempted_at.utcoffset().total_seconds() == 0

    def test_status_round_trips_as_capture_status_enum_not_string(self, tmp_path):
        store = Store()
        populate_store(store)
        persister = StatePersister(tmp_path / "state.json")
        persister.save(store)
        loaded = persister.load()

        captures = loaded.watchlist["alert-1"].captures
        for attempt in captures:
            assert isinstance(attempt.status, CaptureStatus)
            assert not isinstance(attempt.status, str) or isinstance(attempt.status, CaptureStatus)
        assert captures[0].status is CaptureStatus.CAPTURED
        assert captures[1].status is CaptureStatus.NO_USABLE_SCENE
        assert captures[2].status is CaptureStatus.PROVIDER_ERROR

    def test_scene_record_captured_at_round_trips_as_aware_datetime(self, tmp_path):
        store = Store()
        populate_store(store)
        persister = StatePersister(tmp_path / "state.json")
        persister.save(store)
        loaded = persister.load()

        record = loaded.scene_records[0]
        assert isinstance(record.captured_at, datetime)
        assert record.captured_at == CAPTURED_AT

    def test_started_on_round_trips_as_date_not_string(self, tmp_path):
        store = Store()
        populate_store(store)
        persister = StatePersister(tmp_path / "state.json")
        persister.save(store)
        loaded = persister.load()

        assert isinstance(loaded.watchlist["alert-1"].started_on, date)
        assert loaded.watchlist["alert-1"].started_on == date(2026, 1, 1)


# ---------------------------------------------------------------------
# Audit chain verification on reload
# ---------------------------------------------------------------------


class TestAuditChainVerification:
    def test_verify_chain_ok_after_save_and_load(self, tmp_path):
        store = Store()
        populate_store(store)
        persister = StatePersister(tmp_path / "state.json")
        persister.save(store)
        loaded = persister.load()

        verification = verify_chain(loaded.audit_chain)
        assert verification.ok is True

    def test_tampered_payload_is_detected_on_load(self, tmp_path):
        store = Store()
        populate_store(store)
        path = tmp_path / "state.json"
        persister = StatePersister(path)
        persister.save(store)

        payload = json.loads(path.read_text())
        payload["audit_chain"][0]["payload"]["actor"] = "attacker"
        path.write_text(json.dumps(payload))

        with pytest.raises(StateCorruptionError, match="tampered|verification"):
            persister.load()

    def test_tampered_row_hash_is_detected_on_load(self, tmp_path):
        store = Store()
        populate_store(store)
        path = tmp_path / "state.json"
        persister = StatePersister(path)
        persister.save(store)

        payload = json.loads(path.read_text())
        payload["audit_chain"][0]["row_hash"] = "0" * 64
        path.write_text(json.dumps(payload))

        with pytest.raises(StateCorruptionError):
            persister.load()

    def test_deleted_interior_entry_is_detected_on_load(self, tmp_path):
        store = Store()
        populate_store(store)
        path = tmp_path / "state.json"
        persister = StatePersister(path)
        persister.save(store)

        payload = json.loads(path.read_text())
        assert len(payload["audit_chain"]) == 2
        del payload["audit_chain"][0]
        path.write_text(json.dumps(payload))

        with pytest.raises(StateCorruptionError):
            persister.load()

    def test_reordered_entries_are_detected_on_load(self, tmp_path):
        store = Store()
        populate_store(store)
        path = tmp_path / "state.json"
        persister = StatePersister(path)
        persister.save(store)

        payload = json.loads(path.read_text())
        payload["audit_chain"] = list(reversed(payload["audit_chain"]))
        path.write_text(json.dumps(payload))

        with pytest.raises(StateCorruptionError):
            persister.load()


# ---------------------------------------------------------------------
# Corrupt / truncated file must fail loudly, never silently
# ---------------------------------------------------------------------


class TestCorruptFileFailsLoudly:
    def test_malformed_json_raises(self, tmp_path):
        path = tmp_path / "state.json"
        path.write_text("{not valid json")
        persister = StatePersister(path)

        with pytest.raises(StateCorruptionError):
            persister.load()

    def test_empty_file_raises(self, tmp_path):
        path = tmp_path / "state.json"
        path.write_text("")
        persister = StatePersister(path)

        with pytest.raises(StateCorruptionError):
            persister.load()

    def test_truncated_json_raises(self, tmp_path):
        store = Store()
        populate_store(store)
        path = tmp_path / "state.json"
        persister = StatePersister(path)
        persister.save(store)

        full_text = path.read_text()
        path.write_text(full_text[: len(full_text) // 2])

        with pytest.raises(StateCorruptionError):
            persister.load()

    def test_missing_required_key_raises(self, tmp_path):
        path = tmp_path / "state.json"
        path.write_text(json.dumps({"version": 1, "watchlist": []}))  # no scene_records/audit_chain
        persister = StatePersister(path)

        with pytest.raises(StateCorruptionError):
            persister.load()

    def test_wrong_shape_raises(self, tmp_path):
        path = tmp_path / "state.json"
        path.write_text(
            json.dumps(
                {"version": 1, "watchlist": "not-a-list", "scene_records": [], "audit_chain": []}
            )
        )
        persister = StatePersister(path)

        with pytest.raises(StateCorruptionError):
            persister.load()

    def test_bad_status_value_raises(self, tmp_path):
        path = tmp_path / "state.json"
        path.write_text(
            json.dumps(
                {
                    "version": 1,
                    "watchlist": [
                        {
                            "alert_id": "alert-1",
                            "parcel_id": "parcel-1",
                            "started_on": "2026-01-01",
                            "watched_by": "officer-1",
                            "captures": [
                                {
                                    "week": "2026-W01",
                                    "status": "not-a-real-status",
                                    "attempted_at": ATTEMPTED_AT.isoformat(),
                                    "scene_id": None,
                                    "sha256": None,
                                    "cloud_pct": None,
                                    "reason": "x",
                                }
                            ],
                        }
                    ],
                    "scene_records": [],
                    "audit_chain": [],
                }
            )
        )
        persister = StatePersister(path)

        with pytest.raises(StateCorruptionError):
            persister.load()

    def test_corrupt_file_never_loads_as_empty_timeline(self, tmp_path):
        """The failure mode under test: a corrupt file must raise, never
        silently resolve to `None`/empty (which would look identical to
        "nothing has ever been captured")."""
        path = tmp_path / "state.json"
        path.write_text("totally garbage, not json at all")
        persister = StatePersister(path)

        with pytest.raises(StateCorruptionError):
            result = persister.load()
            assert result is None  # pragma: no cover - must never get here


# ---------------------------------------------------------------------
# Crash-safety of the write path
# ---------------------------------------------------------------------


class TestWriteCrashSafety:
    def test_failure_during_write_leaves_no_target_file(self, tmp_path, monkeypatch):
        store = Store()
        populate_store(store)
        path = tmp_path / "state.json"
        persister = StatePersister(path)

        def boom(*args, **kwargs):
            raise OSError("disk full")

        monkeypatch.setattr(os, "fsync", boom)

        with pytest.raises(OSError, match="disk full"):
            persister.save(store)

        assert not path.exists()

    def test_failure_during_write_cleans_up_temp_file(self, tmp_path, monkeypatch):
        store = Store()
        populate_store(store)
        path = tmp_path / "state.json"
        persister = StatePersister(path)

        def boom(*args, **kwargs):
            raise OSError("disk full")

        monkeypatch.setattr(os, "fsync", boom)

        with pytest.raises(OSError):
            persister.save(store)

        leftovers = [p for p in tmp_path.iterdir() if p.name != "state.json"]
        assert leftovers == []

    def test_failure_during_rename_leaves_previous_file_intact(self, tmp_path, monkeypatch):
        store = Store()
        populate_store(store)
        path = tmp_path / "state.json"
        persister = StatePersister(path)
        persister.save(store)  # a good version exists first
        original_bytes = path.read_bytes()

        def boom(*args, **kwargs):
            raise OSError("rename failed")

        monkeypatch.setattr(os, "replace", boom)

        store.watchlist["alert-2"] = make_watch_entry("alert-2")
        with pytest.raises(OSError, match="rename failed"):
            persister.save(store)

        # The previous, valid file must still be exactly what it was --
        # never a partially-written replacement.
        assert path.read_bytes() == original_bytes
        loaded = persister.load()
        assert set(loaded.watchlist) == {"alert-1"}

    def test_successful_save_after_a_failed_one_still_works(self, tmp_path, monkeypatch):
        store = Store()
        populate_store(store)
        path = tmp_path / "state.json"
        persister = StatePersister(path)

        real_fsync = os.fsync
        calls = {"n": 0}

        def flaky_fsync(fd):
            calls["n"] += 1
            if calls["n"] == 1:
                raise OSError("transient disk error")
            return real_fsync(fd)

        monkeypatch.setattr(os, "fsync", flaky_fsync)

        with pytest.raises(OSError):
            persister.save(store)
        assert not path.exists()

        persister.save(store)  # retried, this time fsync succeeds
        assert path.exists()
        loaded = persister.load()
        assert set(loaded.watchlist) == {"alert-1"}

    def test_write_verification_failure_does_not_publish_partial_file(self, tmp_path, monkeypatch):
        store = Store()
        populate_store(store)
        path = tmp_path / "state.json"
        persister = StatePersister(path)

        real_read_text = Path.read_text

        def tampering_read_text(self, *args, **kwargs):
            return real_read_text(self, *args, **kwargs) + "\ncorruption not valid json"

        monkeypatch.setattr(Path, "read_text", tampering_read_text)

        with pytest.raises(json.JSONDecodeError):
            persister.save(store)

        assert not path.exists()


# ---------------------------------------------------------------------
# Env-driven path resolution (mirrors build_blob_store's convention)
# ---------------------------------------------------------------------


class TestPathResolution:
    def test_defaults_to_data_state_json(self, monkeypatch):
        monkeypatch.delenv("MAPENCROACH_STATE_PATH", raising=False)
        assert default_state_path() == Path("data/state.json")

    def test_honors_state_path_env_var(self, tmp_path, monkeypatch):
        custom = tmp_path / "custom-state.json"
        monkeypatch.setenv("MAPENCROACH_STATE_PATH", str(custom))
        assert default_state_path() == custom

    def test_build_state_persister_uses_default_state_path(self, tmp_path, monkeypatch):
        custom = tmp_path / "custom-state.json"
        monkeypatch.setenv("MAPENCROACH_STATE_PATH", str(custom))
        persister = build_state_persister()
        assert persister.path == custom


# ---------------------------------------------------------------------
# hydrate_store
# ---------------------------------------------------------------------


class TestHydrateStore:
    def test_hydrate_applies_persisted_state_onto_a_fresh_store(self, tmp_path):
        source_store = Store()
        populate_store(source_store)
        persister = StatePersister(tmp_path / "state.json")
        persister.save(source_store)

        fresh_store = Store()
        hydrate_store(fresh_store, persister)

        assert set(fresh_store.watchlist) == {"alert-1"}
        assert fresh_store.scene_registry.get("scene-1").sha256 == "a" * 64
        assert len(fresh_store.audit_chain) == 2
        assert fresh_store.state_persister is persister

    def test_hydrate_with_no_prior_file_still_wires_persister(self, tmp_path):
        persister = StatePersister(tmp_path / "does-not-exist.json")
        store = Store()

        hydrate_store(store, persister)

        assert store.watchlist == {}
        assert store.state_persister is persister

    def test_hydrate_lets_state_corruption_error_propagate(self, tmp_path):
        path = tmp_path / "state.json"
        path.write_text("not json")
        persister = StatePersister(path)
        store = Store()

        with pytest.raises(StateCorruptionError):
            hydrate_store(store, persister)

    def test_hydrated_scene_bytes_load_through_the_wired_blob_store(self, tmp_path, monkeypatch):
        monkeypatch.setenv("MAPENCROACH_BLOB_ROOT", str(tmp_path / "blobs"))
        source_store = Store()
        data = b"fake-scene-bytes"
        sha256 = source_store.scene_registry.blob_store.put(data)
        record = make_scene_record(scene_id="scene-1", sha256=sha256)
        source_store.scene_registry._by_id[record.scene_id] = record  # noqa: SLF001
        source_store.scene_registry._by_hash[record.sha256] = record  # noqa: SLF001
        persister = StatePersister(tmp_path / "state.json")
        persister.save(source_store)

        fresh_store = Store()  # same MAPENCROACH_BLOB_ROOT -> same blobs on disk
        hydrate_store(fresh_store, persister)

        assert fresh_store.scene_registry.load("scene-1") == data


# ---------------------------------------------------------------------
# build_store: the real-deployment bootstrap
# ---------------------------------------------------------------------


class TestBuildStore:
    def test_non_demo_store_starts_with_no_parcels_alerts_cases(self, tmp_path, monkeypatch):
        monkeypatch.setenv("MAPENCROACH_STATE_PATH", str(tmp_path / "state.json"))
        store = build_store(demo=False)
        assert store.parcels == {}
        assert store.alerts == {}
        assert store.cases == {}
        assert store.state_persister is not None

    def test_demo_store_reseeds_deterministically_and_is_not_persisted(self, tmp_path, monkeypatch):
        monkeypatch.setenv("MAPENCROACH_STATE_PATH", str(tmp_path / "state.json"))
        store_a = build_store(demo=True)
        store_a.persist_now()
        store_b = build_store(demo=True)

        assert set(store_a.parcels) == set(store_b.parcels)
        assert store_a.parcels["parcel-1"] == store_b.parcels["parcel-1"]
        assert set(store_a.alerts) == set(store_b.alerts)
        assert set(store_a.cases) == set(store_b.cases)

    def test_watchlist_survives_across_build_store_calls(self, tmp_path, monkeypatch):
        monkeypatch.setenv("MAPENCROACH_STATE_PATH", str(tmp_path / "state.json"))
        store_a = build_store(demo=True)
        entry = make_watch_entry("alert-1")
        store_a.watchlist["alert-1"] = entry
        store_a.record_audit(
            actor="officer-1", action="watch.create", object_type="watch", object_id="alert-1"
        )
        store_a.persist_now()

        store_b = build_store(demo=True)

        assert "alert-1" in store_b.watchlist
        assert store_b.watchlist["alert-1"].captures == entry.captures
        # `store_b`'s in-memory chain is entirely replaced by whatever was
        # persisted (including the demo-seed entries `store_a` recorded
        # before its own `watch.create` -- `seed_demo` audits its own
        # bootstrap, and that ran before anything was persisted the first
        # time through `build_store`), not merged with a freshly-seeded
        # chain of its own.
        assert store_b.audit_chain == store_a.audit_chain
        assert any(
            e.payload.get("action") == "watch.create" and e.payload.get("object_id") == "alert-1"
            for e in store_b.audit_chain
        )
        assert verify_chain(store_b.audit_chain).ok is True

    def test_mutating_the_second_store_persists_via_persist_now(self, tmp_path, monkeypatch):
        monkeypatch.setenv("MAPENCROACH_STATE_PATH", str(tmp_path / "state.json"))
        store_a = build_store(demo=False)
        store_a.watchlist["alert-1"] = make_watch_entry("alert-1")
        store_a.persist_now()

        store_b = build_store(demo=False)
        store_b.watchlist["alert-2"] = make_watch_entry("alert-2")
        store_b.persist_now()

        store_c = build_store(demo=False)
        assert set(store_c.watchlist) == {"alert-1", "alert-2"}

    def test_corrupt_state_file_aborts_build_store(self, tmp_path, monkeypatch):
        state_path = tmp_path / "state.json"
        state_path.write_text("garbage")
        monkeypatch.setenv("MAPENCROACH_STATE_PATH", str(state_path))

        with pytest.raises(StateCorruptionError):
            build_store(demo=False)


# ---------------------------------------------------------------------
# Persistence is opt-in: plain Store() must never touch disk on its own.
# ---------------------------------------------------------------------


class TestCreateAppWiresPersistenceOnTheNoStorePath:
    """`create_app()` called with no explicit `store` is the one
    real-deployment path that opts into persistence (see
    `create_app`'s docstring in `api/app.py`); every other test in this
    suite (and the rest of the test suite generally) always passes an
    explicit `store` and never exercises this branch."""

    def test_create_app_with_no_store_builds_a_persistent_store(self, tmp_path, monkeypatch):
        monkeypatch.setenv("MAPENCROACH_STATE_PATH", str(tmp_path / "state.json"))
        monkeypatch.setenv("MAPENCROACH_BLOB_ROOT", str(tmp_path / "blobs"))
        monkeypatch.setenv("MAPENCROACH_JWT_SECRET", "test-fixture-signing-secret-not-the-default")
        monkeypatch.delenv("MAPENCROACH_DEMO", raising=False)

        from mapencroach.api.app import create_app

        app = create_app()

        assert app.state.store.state_persister is not None
        assert app.state.store.parcels == {}  # non-demo: starts empty

    def test_create_app_with_no_store_hydrates_prior_state(self, tmp_path, monkeypatch):
        state_path = tmp_path / "state.json"
        monkeypatch.setenv("MAPENCROACH_STATE_PATH", str(state_path))
        monkeypatch.setenv("MAPENCROACH_BLOB_ROOT", str(tmp_path / "blobs"))
        monkeypatch.setenv("MAPENCROACH_JWT_SECRET", "test-fixture-signing-secret-not-the-default")
        monkeypatch.delenv("MAPENCROACH_DEMO", raising=False)

        prior_store = Store()
        prior_store.watchlist["alert-1"] = make_watch_entry("alert-1")
        StatePersister(state_path).save(prior_store)

        from mapencroach.api.app import create_app

        app = create_app()

        assert "alert-1" in app.state.store.watchlist


class TestPersistenceIsOptIn:
    def test_bare_store_has_no_state_persister(self):
        assert Store().state_persister is None
        assert Store.seed_demo().state_persister is None

    def test_persist_now_is_a_no_op_without_a_persister(self, tmp_path, monkeypatch):
        monkeypatch.setenv("MAPENCROACH_STATE_PATH", str(tmp_path / "state.json"))
        store = Store()
        store.watchlist["alert-1"] = make_watch_entry("alert-1")

        store.persist_now()

        assert not (tmp_path / "state.json").exists()

    def test_seed_demo_never_writes_a_state_file(self, tmp_path, monkeypatch):
        monkeypatch.setenv("MAPENCROACH_STATE_PATH", str(tmp_path / "state.json"))
        Store.seed_demo()
        assert not (tmp_path / "state.json").exists()
