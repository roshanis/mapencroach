"""Hash-on-ingest satellite scene registry.

Evidence integrity has to start at the first byte: every scene is
sha256-hashed the moment it is ingested, and that hash becomes the
anchor the rest of the system (audit chain, court exhibits) relies on
to prove a scene hasn't been altered after the fact. Dedup is enforced
on both the content hash (identical bytes re-uploaded under any id)
and the scene_id (an id can't be silently re-pointed at different
bytes) so a scene identifier always resolves to exactly one payload.
"""

import hashlib
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any


class DuplicateScene(Exception):
    """Raised when a scene's content hash or scene_id is already registered."""


@dataclass(frozen=True)
class SceneRecord:
    scene_id: str
    sha256: str
    captured_at: datetime
    sensor: str
    resolution_m: float
    cloud_pct: float
    source: str
    stac_item: dict[str, Any]


def _build_stac_item(
    scene_id: str,
    captured_at: datetime,
    cloud_pct: float,
    resolution_m: float,
    href: str,
) -> dict[str, Any]:
    return {
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


@dataclass
class SceneRegistry:
    """In-memory scene registry, keyed by scene_id and content hash."""

    _by_id: dict[str, SceneRecord] = field(default_factory=dict)
    _by_hash: dict[str, SceneRecord] = field(default_factory=dict)

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
    ) -> SceneRecord:
        sha256 = hashlib.sha256(data).hexdigest()

        if scene_id in self._by_id or sha256 in self._by_hash:
            raise DuplicateScene(
                f"scene already registered (scene_id={scene_id!r}, sha256={sha256!r})"
            )

        record = SceneRecord(
            scene_id=scene_id,
            sha256=sha256,
            captured_at=captured_at,
            sensor=sensor,
            resolution_m=resolution_m,
            cloud_pct=cloud_pct,
            source=source,
            stac_item=_build_stac_item(scene_id, captured_at, cloud_pct, resolution_m, href),
        )
        self._by_id[scene_id] = record
        self._by_hash[sha256] = record
        return record

    def get(self, scene_id: str) -> SceneRecord:
        return self._by_id[scene_id]

    def by_hash(self, sha256: str) -> SceneRecord:
        return self._by_hash[sha256]

    def verify(self, scene_id: str, data: bytes) -> bool:
        """Recompute the hash of `data` and compare against the registered record."""
        record = self.get(scene_id)
        return hashlib.sha256(data).hexdigest() == record.sha256
