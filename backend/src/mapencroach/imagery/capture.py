"""Weekly capture attempts: turn a provider fetch into recorded evidence.

The one property that matters most here: a missing week must be a
recorded fact, not an absent row. Haridwar-Roorkee monsoon means many
weeks genuinely have no usable optical scene, and an evidence timeline
with unexplained gaps is worse than one that documents why it's empty.
`capture_week` therefore always returns a `CaptureAttempt` -- it never
lets a provider exception escape, and it never returns nothing.

Every successful capture is hashed on ingest via `SceneRegistry.register`
before it is reported CAPTURED, so the bytes are sha256-anchored the
moment they arrive (see `mapencroach.imagery.registry`).
"""

import hashlib
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import datetime
from enum import StrEnum
from typing import Any, Protocol

from mapencroach.imagery.registry import DuplicateScene, SceneRegistry
from mapencroach.imagery.schedule import WeekRef


class CaptureStatus(StrEnum):
    CAPTURED = "captured"
    NO_USABLE_SCENE = "no_usable_scene"
    PROVIDER_ERROR = "provider_error"


@dataclass(frozen=True)
class ProviderScene:
    """A scene handed back by an `ImageryProvider.fetch` call."""

    data: bytes
    scene_id: str
    captured_at: datetime
    sensor: str
    resolution_m: float
    cloud_pct: float
    source: str
    href: str
    media_type: str = "image/png"


class ImageryProvider(Protocol):
    def fetch(self, *, geometry: Mapping[str, Any], week: WeekRef) -> ProviderScene | None:
        """Fetch the best available scene for `geometry` in `week`.

        Returns None when no scene exists at all for that week/footprint
        (e.g. no satellite pass, or the archive has nothing). Cloud
        filtering is the caller's job -- a provider may return a scene
        with a high `cloud_pct` and let `capture_week` decide whether
        it's usable.
        """
        ...


@dataclass(frozen=True)
class CaptureAttempt:
    """The recorded outcome of one week's capture attempt.

    `reason` is always set unless `status` is CAPTURED -- that's what
    makes a gap in the evidence timeline an explained fact instead of a
    silent hole.
    """

    week: str
    status: CaptureStatus
    attempted_at: datetime
    scene_id: str | None = None
    sha256: str | None = None
    cloud_pct: float | None = None
    reason: str | None = None

    def __post_init__(self) -> None:
        if self.status != CaptureStatus.CAPTURED and self.reason is None:
            raise ValueError(f"reason must be set for status {self.status.value}")

    def to_dict(self) -> dict[str, Any]:
        return {
            "week": self.week,
            "status": self.status.value,
            "attempted_at": self.attempted_at.isoformat(),
            "scene_id": self.scene_id,
            "sha256": self.sha256,
            "cloud_pct": self.cloud_pct,
            "reason": self.reason,
        }


def capture_week(
    provider: ImageryProvider,
    registry: SceneRegistry,
    *,
    geometry: Mapping[str, Any],
    week: WeekRef,
    attempted_at: datetime,
    max_cloud_pct: float = 40.0,
) -> CaptureAttempt:
    """Attempt to capture one week's scene for `geometry` and record the outcome.

    Always returns a `CaptureAttempt` -- never raises, so a single bad
    week can't take out an entire batch of weekly captures:

    - provider returns None                 -> NO_USABLE_SCENE
    - provider returns cloud_pct too high    -> NO_USABLE_SCENE
    - provider raises                        -> PROVIDER_ERROR, message preserved in `reason`
    - provider returns a usable scene        -> registered (hash-on-ingest) -> CAPTURED

    A `DuplicateScene` from the registry splits two ways, and the
    difference is an evidence question, not a bookkeeping one:

    - the *same bytes* are already on record (a retried attempt for a
      week already captured) -> resolves to the existing record and is
      still CAPTURED. The bytes were genuinely captured and hashed, just
      not by this call, and the reported sha256 is theirs.
    - the *scene_id* is on record against *different* bytes -> reported
      PROVIDER_ERROR. Anything else would anchor this week to the hash of
      a payload the provider did not return, so the reported sha256 would
      not describe the scene. The registry forbids re-pointing an id at
      new bytes by design; this honours that rather than working around it.

    The reported `sha256` is therefore always the hash of the bytes this
    attempt actually obtained.
    """
    try:
        scene = provider.fetch(geometry=geometry, week=week)
    except Exception as exc:  # noqa: BLE001 - provider errors must never escape
        return CaptureAttempt(
            week=week.key,
            status=CaptureStatus.PROVIDER_ERROR,
            attempted_at=attempted_at,
            reason=f"provider error: {exc}",
        )

    if scene is None:
        return CaptureAttempt(
            week=week.key,
            status=CaptureStatus.NO_USABLE_SCENE,
            attempted_at=attempted_at,
            reason="no scene available for this week and footprint",
        )

    if scene.cloud_pct > max_cloud_pct:
        return CaptureAttempt(
            week=week.key,
            status=CaptureStatus.NO_USABLE_SCENE,
            attempted_at=attempted_at,
            cloud_pct=scene.cloud_pct,
            reason=(
                f"cloud cover {scene.cloud_pct:.1f}% exceeds max {max_cloud_pct:.1f}%"
            ),
        )

    try:
        record = registry.register(
            scene.data,
            scene_id=scene.scene_id,
            captured_at=scene.captured_at,
            sensor=scene.sensor,
            resolution_m=scene.resolution_m,
            cloud_pct=scene.cloud_pct,
            source=scene.source,
            href=scene.href,
            media_type=scene.media_type,
        )
    except DuplicateScene:
        sha256 = hashlib.sha256(scene.data).hexdigest()
        try:
            record = registry.by_hash(sha256)
        except KeyError:
            # The scene_id is taken, but not by these bytes. The registry
            # forbids re-pointing an id at a different payload on purpose,
            # and we must not paper over it: reporting CAPTURED here would
            # anchor this week to the hash of bytes we never received, and
            # the sha256 in the evidence timeline would not be the sha256
            # of the scene the provider actually returned.
            return CaptureAttempt(
                week=week.key,
                status=CaptureStatus.PROVIDER_ERROR,
                attempted_at=attempted_at,
                cloud_pct=scene.cloud_pct,
                reason=(
                    f"scene_id {scene.scene_id!r} is already registered against "
                    f"different bytes (received sha256 {sha256[:12]}... is not "
                    "on record); refusing to report a capture the registry "
                    "does not hold"
                ),
            )

    return CaptureAttempt(
        week=week.key,
        status=CaptureStatus.CAPTURED,
        attempted_at=attempted_at,
        scene_id=record.scene_id,
        sha256=record.sha256,
        cloud_pct=scene.cloud_pct,
    )
