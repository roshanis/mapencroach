"""Hash-on-ingest satellite scene registry.

Evidence integrity has to start at the first byte: every scene is
sha256-hashed the moment it is ingested, and that hash becomes the
anchor the rest of the system (audit chain, court exhibits) relies on
to prove a scene hasn't been altered after the fact. Dedup is enforced
on both the content hash (identical bytes re-uploaded under any id)
and the scene_id (an id can't be silently re-pointed at different
bytes) so a scene identifier always resolves to exactly one payload.

A hash with no payload behind it can't be checked against anything,
which defeats the point of hashing on ingest -- so when a `BlobStore` is
supplied, `register` also writes the bytes through it and the resulting
`SceneRecord.retained` is True. Without one, behaviour is exactly what it
was before blob storage existed: the hash is recorded, no bytes are
persisted, `retained` is False. That backward-compatible default matters
because most callers (including most of this module's own test suite)
construct `SceneRegistry()` with no store at all.
"""

import hashlib
import threading
from collections.abc import Mapping
from dataclasses import dataclass, field
from datetime import datetime
from types import MappingProxyType
from typing import Any

from mapencroach.imagery.blobstore import BlobStore

_DEFAULT_MEDIA_TYPE = "image/png"


class DuplicateScene(Exception):
    """Raised when a scene's content hash or scene_id is already registered."""


class SceneNotRetained(Exception):
    """Raised by `SceneRegistry.load` when a registered scene's bytes were
    never persisted to a blob store (the registry was built without one,
    or without one at the time this particular scene was registered)."""


def _deep_freeze(value: Any) -> Any:
    """Recursively replace dicts/lists with read-only Mapping/tuple views.

    `SceneRecord` is frozen, but a frozen dataclass only stops attribute
    *reassignment* -- a plain dict stored in one of its fields is still
    mutable in place. Freezing the whole structure means evidence
    provenance (the stac_item) can't be silently altered after
    registration by mutating it through the returned record.
    """
    if isinstance(value, dict):
        return MappingProxyType({k: _deep_freeze(v) for k, v in value.items()})
    if isinstance(value, list):
        return tuple(_deep_freeze(v) for v in value)
    return value


@dataclass(frozen=True)
class SceneRecord:
    scene_id: str
    sha256: str
    captured_at: datetime
    sensor: str
    resolution_m: float
    cloud_pct: float
    source: str
    stac_item: Mapping[str, Any]
    media_type: str = _DEFAULT_MEDIA_TYPE
    retained: bool = False


def _build_stac_item(
    scene_id: str,
    captured_at: datetime,
    cloud_pct: float,
    resolution_m: float,
    href: str,
) -> Mapping[str, Any]:
    return _deep_freeze(
        {
            "id": scene_id,
            "properties": {
                "datetime": captured_at.isoformat(),
                "eo:cloud_cover": cloud_pct,
                "gsd": resolution_m,
            },
            "assets": {
                "data": {"href": href},
            },
        }
    )


@dataclass
class SceneRegistry:
    """In-memory scene registry, keyed by scene_id and content hash.

    `blob_store` is the only constructor argument: pass one and `register`
    persists each scene's bytes through it (`SceneRecord.retained` is then
    True and `load` can hand the bytes back later); leave it `None` (the
    default) and the registry behaves exactly as it did before blob
    storage existed -- hash-on-ingest bookkeeping only, no bytes retained,
    `load` always raises `SceneNotRetained`.

    The lookup dicts (and the lock guarding them) are internal state, not
    part of the public API: they are excluded from `__init__`/`__repr__`/
    `__eq__` (`init=False, repr=False, compare=False`) so a caller can't
    construct or compare a registry by injecting arbitrary entries into
    them directly -- the only way in is `register`.

    `register` is called from `api/app.py`'s capture handlers *outside*
    `store.lock` (capture calls out to imagery providers, and that lock is
    deliberately released before any I/O -- see `api/store.py`), so two
    concurrent capture runs can call `register` on the same shared
    registry at once. `_lock` guards the duplicate check and both dict
    inserts so that race can't register the same scene_id/hash twice or
    leave the two lookup dicts inconsistent with each other.
    """

    blob_store: BlobStore | None = None

    _by_id: dict[str, SceneRecord] = field(
        default_factory=dict, init=False, repr=False, compare=False
    )
    _by_hash: dict[str, SceneRecord] = field(
        default_factory=dict, init=False, repr=False, compare=False
    )
    _lock: threading.Lock = field(
        default_factory=threading.Lock, init=False, repr=False, compare=False
    )

    def register(
        self,
        data: bytes,
        *,
        scene_id: str,
        captured_at: datetime,
        sensor: str,
        resolution_m: float,
        cloud_pct: float,
        source: str,
        href: str,
        media_type: str = _DEFAULT_MEDIA_TYPE,
        stac_item: dict[str, Any] | None = None,
    ) -> SceneRecord:
        sha256 = hashlib.sha256(data).hexdigest()

        with self._lock:
            if scene_id in self._by_id or sha256 in self._by_hash:
                raise DuplicateScene(
                    f"scene already registered (scene_id={scene_id!r}, sha256={sha256!r})"
                )

            retained = False
            if self.blob_store is not None:
                # `put` is itself keyed by (and verifies against) this same
                # sha256, so storage can never disagree with the registry
                # about which bytes a scene_id/hash resolves to.
                self.blob_store.put(data)
                retained = True

            record = SceneRecord(
                scene_id=scene_id,
                sha256=sha256,
                captured_at=captured_at,
                sensor=sensor,
                resolution_m=resolution_m,
                cloud_pct=cloud_pct,
                source=source,
                # A caller that discovered the scene in an external STAC
                # catalog passes that catalog's own item so provenance is
                # preserved; it gets the same deep-freeze as synthesized
                # items so it can't be altered after registration either.
                stac_item=_deep_freeze(stac_item)
                if stac_item is not None
                else _build_stac_item(scene_id, captured_at, cloud_pct, resolution_m, href),
                media_type=media_type,
                retained=retained,
            )
            self._by_id[scene_id] = record
            self._by_hash[sha256] = record
            return record

    def get(self, scene_id: str) -> SceneRecord:
        return self._by_id[scene_id]

    def load(self, scene_id: str) -> bytes:
        """Return the retained bytes for `scene_id`.

        Raises `KeyError` if `scene_id` was never registered (same as
        `get`), or `SceneNotRetained` if it was registered but its bytes
        were never persisted (no blob store was configured at the time).
        A `BlobNotFound`/`BlobIntegrityError` from the underlying store is
        let through unchanged -- both indicate the retained-bytes
        invariant has been violated at the storage layer, which callers
        must not paper over.
        """
        record = self.get(scene_id)
        if not record.retained:
            raise SceneNotRetained(f"scene {scene_id!r} bytes were not retained")
        if self.blob_store is None:  # pragma: no cover - retained implies a store was set
            raise SceneNotRetained(f"scene {scene_id!r} has no blob store to load from")
        return self.blob_store.get(record.sha256)

    def by_hash(self, sha256: str) -> SceneRecord:
        return self._by_hash[sha256]

    def verify(self, scene_id: str, data: bytes) -> bool:
        """Recompute the hash of `data` and compare against the registered record."""
        record = self.get(scene_id)
        return hashlib.sha256(data).hexdigest() == record.sha256
