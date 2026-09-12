"""Crash-safe, on-disk persistence for the evidence-bearing parts of `Store`.

What survives a restart
-----------------------
Version 3 saves watch history, the scene index, audit chain, parcels, alerts,
cases with full events/paused state, jurisdiction scope, authority membership,
and ID counters. Blob bytes remain in the content-addressed blob store.
Complete snapshots are hashed against the saved audit head. This detects
in-place edits; protection against a writer recomputing all hashes still needs
an externally pinned head, just like the audit chain itself.

Versions 1 and 2 are verified before migration. Their operational records were
never saved, so these older files retain the boot seed until the first v3 save.
Loading does not rewrite files. Back up an older state file before upgrading:
a v3 file cannot be read by an older backend.

Opt-in, but on by default for a real deployment
------------------------------------------------
`Store.state_persister` defaults to `None`: constructing a `Store()` or
`Store.seed_demo()` directly -- what every existing test and the
in-process demo bootstrap does -- touches no disk at all, exactly as
before this module existed. Persistence is wired in by `build_store()`
below, which is what `create_app()` calls on its "no store was supplied"
path (i.e. real deployment via `uvicorn "mapencroach.api.app:create_app"
--factory`, not any test, which always passes an explicit `Store`). That
makes persistence opt-in at the `Store` level, but on by default the
moment the app boots for real -- the same shape `build_blob_store()`
already uses for scene bytes (env-driven location, sane default, no
separate on/off switch to forget).

Location: `MAPENCROACH_STATE_PATH`, defaulting to `./data/state.json`
(relative to the process's working directory) -- alongside
`MAPENCROACH_BLOB_ROOT`'s default of `./data/scenes`, both under the
repo's gitignored `data/` directory.

Crash safety
------------
`StatePersister.save` never writes the target path directly. It writes a
complete JSON document to a temp file in the *same* directory, flushes
and fsyncs it, re-parses what actually landed on disk as a final sanity
check, and only then publishes it via `os.replace` (atomic on the same
filesystem). A crash or exception at any point before that rename leaves
at most an orphaned temp file; the target path itself is never observed
in a partially-written state. This mirrors `FileBlobStore`'s
write-then-rename discipline exactly, just without a content hash to key
on (there isn't a natural one for "the whole state file").

Corruption must fail loudly, never silently
---------------------------------------------
`StatePersister.load` raises `StateCorruptionError` -- never returns a
best-effort partial result -- for malformed JSON, an unexpected shape, or
(most importantly) an audit chain that fails `verify_chain`. Silently
booting with an empty timeline because the state file didn't quite parse
would be the single worst failure mode available here: it would look
exactly like "nothing has ever been captured" rather than "something is
wrong, go look." `build_store()` does not catch this -- it is meant to
blow up app startup, the same way a bad `MAPENCROACH_JWT_SECRET` already
does in `mapencroach.api.auth`.

Note on tamper detection: `verify_chain` (see `mapencroach.audit.chain`)
only proves internal consistency of whatever chain is on disk -- each
entry links correctly to the one before it. It cannot, on its own, prove
the chain on disk isn't a *shorter* prefix of the true chain (a dropped
tail re-verifies as a valid, shorter chain). Catching that would require
an externally-anchored head hash/length, which this module does not
maintain; that limitation is inherited from `audit.chain` itself; see its
module docstring. What this module *does* catch is any edit, reorder, or
deletion of an interior entry, and any hand-edited field that no longer
hashes to what it claims to.

Writer coordination (v3)
-----------------------
A stable sidecar advisory file lock protects compare-and-publish. A writer
must have loaded the exact revision it replaces; stale writers are refused,
not merged. Any failed publication marks that process unavailable (including
readiness) until restart from saved state. This intentionally supports a single
active application writer, not distributed transactions. Use the API-backed
runner rather than starting a second direct-mode writer.

"""

import contextlib
import fcntl
import hashlib
import json
import os
import tempfile
import threading
from dataclasses import dataclass
from datetime import date, datetime
from pathlib import Path
from types import MappingProxyType
from typing import Any

from mapencroach import operational_state
from mapencroach.api.store import Store, WatchEntryRecord
from mapencroach.audit.chain import (
    GENESIS_HASH,
    AuditEntry,
    compute_row_hash,
    rehash_chain,
    verify_chain,
    verify_legacy_chain,
)
from mapencroach.imagery.capture import CaptureAttempt, CaptureStatus
from mapencroach.imagery.registry import SceneRecord

# Version 2: audit row hashes use the injective constructor-tagged
# canonicalization (see mapencroach.audit.chain). Version-1 files are
# verified under the retired encoding they were written with, then
# migrated in memory; the next save writes version 2. Migration changes
# the chain's head hash, so any externally recorded head anchor must be
# re-captured after upgrading.
_STATE_VERSION = 3
_LEGACY_STATE_VERSION = 1
_DEFAULT_STATE_PATH = "data/state.json"


class StateCorruptionError(Exception):
    """Raised by `StatePersister.load` when a state file exists but cannot
    be trusted: malformed JSON, a document missing/mis-shaped fields, or
    an audit chain that fails hash-chain verification (tampered or
    corrupted on disk). Always meant to propagate out of `build_store()`
    and crash startup -- see the module docstring."""


# ---------------------------------------------------------------------
# JSON <-> domain object conversions. Round-trip fidelity matters most
# for `CaptureAttempt`: `status` must come back as a `CaptureStatus`
# member (not the bare string it renders to), and `attempted_at` must
# come back as the exact same aware `datetime` -- a capture attempt that
# silently becomes "sometime, some status" on reload is exactly the
# corruption this module exists to prevent.
# ---------------------------------------------------------------------


def _capture_to_json(attempt: CaptureAttempt) -> dict[str, Any]:
    return {
        "week": attempt.week,
        "status": attempt.status.value,
        "attempted_at": attempt.attempted_at.isoformat(),
        "scene_id": attempt.scene_id,
        "sha256": attempt.sha256,
        "cloud_pct": attempt.cloud_pct,
        "reason": attempt.reason,
    }


def _aware_timestamp(value: str) -> datetime:
    parsed = datetime.fromisoformat(value)
    if parsed.tzinfo is None or parsed.utcoffset() is None:
        raise ValueError("persisted evidence timestamp must include a timezone")
    return parsed


def _capture_from_json(raw: dict[str, Any]) -> CaptureAttempt:
    return CaptureAttempt(
        week=raw["week"],
        status=CaptureStatus(raw["status"]),
        attempted_at=_aware_timestamp(raw["attempted_at"]),
        scene_id=raw.get("scene_id"),
        sha256=raw.get("sha256"),
        cloud_pct=raw.get("cloud_pct"),
        reason=raw.get("reason"),
    )


def _watch_entry_to_json(entry: WatchEntryRecord) -> dict[str, Any]:
    return {
        "watch_id": entry.watch_id,
        # None for a parcel-originated watch -- there is no alert to name.
        "alert_id": entry.alert_id,
        "parcel_id": entry.parcel_id,
        "started_on": entry.started_on.isoformat(),
        "watched_by": entry.watched_by,
        "active": entry.active,
        "captures": [_capture_to_json(c) for c in entry.captures],
    }


def _watch_entry_from_json(raw: dict[str, Any]) -> WatchEntryRecord:
    return WatchEntryRecord(
        alert_id=raw["alert_id"],
        # Files written before parcel-originated watches existed carry no
        # watch_id; every entry in them came from an alert, so the alert id
        # is its identity and the default in __post_init__ is correct.
        watch_id=raw.get("watch_id") or raw["alert_id"],
        parcel_id=raw["parcel_id"],
        started_on=date.fromisoformat(raw["started_on"]),
        watched_by=raw["watched_by"],
        # State files written before watch deactivation had no lifecycle
        # field; those entries remain active when loaded.
        active=raw.get("active", True),
        captures=[_capture_from_json(c) for c in raw["captures"]],
        # `in_flight` is per-process, in-run bookkeeping (see
        # `WatchEntryRecord`'s docstring) -- it is never persisted and
        # always starts empty on load, which is correct: any reservation
        # from a previous process is meaningless once that process is gone.
    )


def _freeze(value: Any) -> Any:
    """Recursively convert dict/list into MappingProxyType/tuple.

    Mirrors `mapencroach.imagery.registry._deep_freeze` exactly (kept as
    a local copy rather than importing that private helper, so this
    module depends only on `registry`'s public `SceneRecord`, not its
    internals). `SceneRecord.stac_item` is stored frozen this way; without
    matching that shape on reload, a reloaded record would fail equality
    against the record that was originally registered (list vs. tuple),
    even though its content is identical.
    """
    if isinstance(value, dict):
        return MappingProxyType({k: _freeze(v) for k, v in value.items()})
    if isinstance(value, list):
        return tuple(_freeze(v) for v in value)
    return value


def _unfreeze(value: Any) -> Any:
    """Inverse of `_freeze`: MappingProxyType/tuple back to plain
    dict/list, so it round-trips through `json.dumps` cleanly."""
    if isinstance(value, MappingProxyType | dict):
        return {k: _unfreeze(v) for k, v in dict(value).items()}
    if isinstance(value, tuple | list):
        return [_unfreeze(v) for v in value]
    return value


def _scene_record_to_json(record: SceneRecord) -> dict[str, Any]:
    return {
        "scene_id": record.scene_id,
        "sha256": record.sha256,
        "captured_at": record.captured_at.isoformat(),
        "sensor": record.sensor,
        "resolution_m": record.resolution_m,
        "cloud_pct": record.cloud_pct,
        "source": record.source,
        "stac_item": _unfreeze(record.stac_item),
        "media_type": record.media_type,
        "retained": record.retained,
    }


def _scene_record_from_json(raw: dict[str, Any]) -> SceneRecord:
    return SceneRecord(
        scene_id=raw["scene_id"],
        sha256=raw["sha256"],
        captured_at=_aware_timestamp(raw["captured_at"]),
        sensor=raw["sensor"],
        resolution_m=raw["resolution_m"],
        cloud_pct=raw["cloud_pct"],
        source=raw["source"],
        stac_item=_freeze(raw["stac_item"]),
        media_type=raw.get("media_type", "image/png"),
        retained=raw.get("retained", False),
    )


def _audit_entry_to_json(entry: AuditEntry) -> dict[str, Any]:
    return {
        "payload": dict(entry.payload),
        "prev_hash": entry.prev_hash,
        "row_hash": entry.row_hash,
    }


def _audit_entry_from_json(raw: dict[str, Any]) -> AuditEntry:
    return AuditEntry(
        payload=dict(raw["payload"]), prev_hash=raw["prev_hash"], row_hash=raw["row_hash"]
    )


@dataclass
class PersistedState:
    """What a successful `StatePersister.load` hands back."""

    watchlist: dict[str, WatchEntryRecord]
    scene_records: list[SceneRecord]
    audit_chain: list[AuditEntry]
    operational: dict[str, Any] | None = None


class StatePersister:
    """Crash-safe JSON persistence for one state file at `path`.

    `save` snapshots `store.watchlist` / `store.scene_registry` /
    `store.audit_chain` under `store.lock` just long enough to copy
    references out, releases the lock, and only then serializes and
    writes -- file I/O never happens while `store.lock` is held. `load`
    is the read side: returns `None` if no file exists yet (a fresh
    boot with nothing to hydrate, not an error), or raises
    `StateCorruptionError` if a file exists but cannot be trusted.
    """

    def __init__(self, path: str | Path) -> None:
        self.path = Path(path)
        # Serializes snapshot-through-publication. The store lock alone is
        # insufficient because it is released before the atomic rename,
        # allowing an older snapshot to publish after a newer one.
        self._save_lock = threading.Lock()
        self._fingerprint: str | None = None
        self.failed = False

    def save(self, store: Store) -> None:
        # Lock a stable sidecar inode, since atomic replace changes the state inode.
        # Each writer must have loaded the revision it proposes to replace.
        with self._save_lock:
            if self.failed:
                raise RuntimeError("Persistence is unavailable; restart from saved state")
            try:
                self.path.parent.mkdir(parents=True, exist_ok=True)
                with self.path.with_suffix(self.path.suffix + ".lock").open("a+") as lock:
                    fcntl.flock(lock.fileno(), fcntl.LOCK_EX)
                    current = self.path.read_bytes() if self.path.exists() else None
                    fingerprint = (
                        hashlib.sha256(current).hexdigest() if current is not None else None
                    )
                    if fingerprint != self._fingerprint:
                        raise RuntimeError(
                            "State changed in another process; stale writer must restart"
                        )
                    with store.lock:
                        payload = {
                            "version": _STATE_VERSION,
                            "watchlist": [
                                _watch_entry_to_json(e) for e in store.watchlist.values()
                            ],
                            "scene_records": [
                                _scene_record_to_json(r)
                                for r in store.scene_registry._by_id.values()  # noqa: SLF001
                            ],
                            "audit_chain": [_audit_entry_to_json(e) for e in store.audit_chain],
                            "operational": operational_state.snapshot(store),
                        }
                    head = (
                        payload["audit_chain"][-1]["row_hash"]
                        if payload["audit_chain"] else GENESIS_HASH
                    )
                    payload["state_hash"] = compute_row_hash(payload, head)
                    encoded = json.dumps(payload, indent=2)
                    self._atomic_write(encoded)
                    self._fingerprint = hashlib.sha256(encoded.encode()).hexdigest()
            except Exception:
                # In-memory mutations may have preceded the failed publication.
                # Refuse further requests, rather than exposing unsaved state as durable.
                self.failed = True
                raise

    def _atomic_write(self, text: str) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        fd, tmp_name = tempfile.mkstemp(
            dir=self.path.parent, prefix=f".{self.path.name}.", suffix=".tmp"
        )
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as handle:
                handle.write(text)
                handle.flush()
                os.fsync(handle.fileno())

            # Sanity-check what actually landed on disk before it ever
            # becomes visible at the real path -- the JSON-document
            # equivalent of FileBlobStore's write verification (there is
            # no content hash to key this file on, so "does it parse back"
            # is the check available here).
            json.loads(Path(tmp_name).read_text(encoding="utf-8"))
            os.replace(tmp_name, self.path)
        except BaseException:
            with contextlib.suppress(FileNotFoundError):
                os.unlink(tmp_name)
            raise

    def load(self) -> PersistedState | None:
        if not self.path.exists():
            return None

        try:
            raw_text = self.path.read_text(encoding="utf-8")
            payload = json.loads(raw_text)
            # Key by the entry's own id, not by alert_id: a
            # parcel-originated watch has no alert, and keying on it put
            # every such entry under the single key None -- so they
            # silently vanished on restart while the API reported success.
            watchlist = {}
            for raw in payload["watchlist"]:
                entry = _watch_entry_from_json(raw)
                watchlist[entry.watch_id] = entry
            scene_records = [_scene_record_from_json(raw) for raw in payload["scene_records"]]
            audit_chain = [_audit_entry_from_json(raw) for raw in payload["audit_chain"]]
            version = payload.get("version")
            operational = operational_state.decode(payload["operational"]) if version == 3 else None
        except Exception as exc:
            raise StateCorruptionError(
                f"state file {self.path} is corrupt or unreadable: {exc}"
            ) from exc

        if version == _LEGACY_STATE_VERSION:
            # Written before the constructor-tagged hash encoding: verify
            # under the encoding the file was actually written with, then
            # migrate. Rehashing an unverified chain would launder
            # tampering, so the order here is load -> verify -> rehash.
            legacy_verification = verify_legacy_chain(audit_chain)
            if not legacy_verification.ok:
                raise StateCorruptionError(
                    f"state file {self.path} (version 1) audit chain failed "
                    f"verification at index {legacy_verification.first_bad_index} "
                    "-- entries do not hash-chain consistently under the "
                    "version-1 encoding (tampered or corrupted on disk); "
                    "refusing to load"
                )
            audit_chain = rehash_chain(audit_chain)
        elif version in (2, _STATE_VERSION):
            verification = verify_chain(audit_chain)
            if not verification.ok:
                raise StateCorruptionError(
                    f"state file {self.path} audit chain failed verification at "
                    f"index {verification.first_bad_index} -- entries do not "
                    "hash-chain consistently (tampered or corrupted on disk); "
                    "refusing to load"
                )
        else:
            raise StateCorruptionError(
                f"state file {self.path} has unsupported version {version!r}; "
                f"this build reads versions {_LEGACY_STATE_VERSION}, 2 and "
                f"{_STATE_VERSION}. Refusing to guess at an unknown format."
            )

        if version == 3:
            head = audit_chain[-1].row_hash if audit_chain else GENESIS_HASH
            snapshot = {key: value for key, value in payload.items() if key != "state_hash"}
            if payload.get("state_hash") != compute_row_hash(snapshot, head):
                raise StateCorruptionError("State snapshot integrity check failed")
        self._fingerprint = hashlib.sha256(raw_text.encode()).hexdigest()
        return PersistedState(
            watchlist=watchlist, scene_records=scene_records, audit_chain=audit_chain,
            operational=operational,
        )


def default_state_path() -> Path:
    """`MAPENCROACH_STATE_PATH`, or `./data/state.json` if unset --
    matches `imagery.blobstore.build_blob_store`'s env-driven-with-a-
    safe-default pattern exactly."""
    return Path(os.environ.get("MAPENCROACH_STATE_PATH", _DEFAULT_STATE_PATH))


def build_state_persister() -> StatePersister:
    """`StatePersister` rooted at `default_state_path()`."""
    return StatePersister(default_state_path())


def hydrate_store(store: Store, persister: StatePersister) -> None:
    """Load `persister`'s state (if any) onto `store`, then wire
    `store.state_persister = persister` so future mutations persist.

    Raises `StateCorruptionError` straight through if the state file
    exists but is corrupt -- callers must not catch this and fall back to
    an empty/fresh store, which would be exactly the silent evidence-loss
    this module exists to prevent. Wiring `state_persister` happens
    whether or not there was anything to load, so a fresh boot with no
    prior state still persists everything captured from here on.
    """
    loaded = persister.load()
    if loaded is not None:
        if loaded.operational is not None:
            operational_state.restore(store, loaded.operational)
        store.watchlist = loaded.watchlist
        for record in loaded.scene_records:
            # Reaching into `SceneRegistry`'s internal lookup dicts is the
            # only way in: the registry has no bulk-load API, and adding
            # one is out of this module's file ownership (registry.py is
            # off limits -- see the imagery-slice contracts). `register()`
            # itself isn't usable here either -- it re-hashes the actual
            # bytes it's handed, and we deliberately never load scene
            # bytes into memory just to reconstruct an index entry; the
            # bytes stay on disk in the blob store until something asks
            # to read them.
            store.scene_registry._by_id[record.scene_id] = record  # noqa: SLF001
            store.scene_registry._by_hash[record.sha256] = record  # noqa: SLF001
        store.audit_chain = loaded.audit_chain
    store.state_persister = persister


def build_store(*, demo: bool) -> Store:
    """Build a `Store` the way a real deployment boots one: seed the
    demo fixtures (or start empty), then hydrate + wire persistence from
    `build_state_persister()`. Used by both `create_app()`'s no-store
    path and `mapencroach.imagery.runner.main` so a cron-driven capture
    run sees the exact same parcels/alerts/watchlist the web app does.

    Raises `StateCorruptionError` straight through on a corrupt state
    file -- this is meant to abort startup, not degrade gracefully.
    """
    store = Store.seed_demo() if demo else Store()
    hydrate_store(store, build_state_persister())
    return store
