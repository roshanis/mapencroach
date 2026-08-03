"""Baseline declaration: the legal anchor of the whole detection posture.

The platform never adjudicates occupation that predates monitoring —
that is a political and legal question (LEGACY tier, LEGACY_REFERRED
routing). What it *can* prove is post-baseline change, and that proof
is only as strong as the baseline itself. A declaration therefore pins:
an AOI, a date, and the exact scene set (ids + content hashes) that
depicts the AOI on that date — recorded in the audit chain, so "what
did the land look like on the baseline date?" has one answer forever.
Declarations are append-only: a new one supersedes, none is ever edited.
"""

from datetime import date, datetime
from typing import Any


class BaselineError(ValueError):
    pass


def declare_baseline(
    store: Any,
    *,
    aoi_jurisdiction_id: str,
    baseline_date: date,
    scene_ids: list[str],
    declared_by: str,
    declared_at: datetime,
    note: str = "",
) -> dict[str, Any]:
    """Pin the baseline scene set for an AOI and anchor it in the audit chain."""
    if not scene_ids:
        raise BaselineError("a baseline must pin at least one scene")
    scenes = store.scenes
    missing = [scene_id for scene_id in scene_ids if scene_id not in scenes]
    if missing:
        raise BaselineError(f"baseline references unregistered scenes: {missing}")

    late = [
        scene_id
        for scene_id in scene_ids
        if datetime.fromisoformat(scenes[scene_id]["captured_at"]).date() > baseline_date
    ]
    if late:
        raise BaselineError(
            f"scenes captured after the baseline date cannot depict it: {late}"
        )

    declaration = store.declare_baseline(
        {
            "aoi_jurisdiction_id": aoi_jurisdiction_id,
            "baseline_date": baseline_date.isoformat(),
            "declared_by": declared_by,
            "declared_at": declared_at.isoformat(),
            "scene_ids": list(scene_ids),
            "scene_hashes": [scenes[scene_id]["sha256"] for scene_id in scene_ids],
            "note": note,
        }
    )
    store.record_audit(
        actor=declared_by,
        action="baseline.declare",
        object_type="baseline",
        object_id=f"{aoi_jurisdiction_id}:{baseline_date.isoformat()}",
    )
    return declaration


def resolve_baseline_scene(
    store: Any, aoi_jurisdiction_id: str, current_scene: dict[str, Any]
) -> str:
    """Pick the declared baseline scene that covers the current scene's extent.

    Verifies the pinned hash still matches the registry before returning —
    a baseline whose scene bytes changed is a chain-of-custody failure,
    not something to silently run with.
    """
    from shapely.geometry import box

    declaration = store.active_baseline(aoi_jurisdiction_id)
    if declaration is None:
        raise BaselineError(
            f"no baseline declared for AOI {aoi_jurisdiction_id!r}; "
            "declare one or pass baseline_scene_id explicitly"
        )

    scenes = store.scenes
    current_box = box(*current_scene["stac_item"]["bbox"])
    for scene_id, pinned_hash in zip(
        declaration["scene_ids"], declaration["scene_hashes"], strict=True
    ):
        scene = scenes.get(scene_id)
        if scene is None:
            raise BaselineError(f"declared baseline scene vanished from registry: {scene_id!r}")
        if scene["sha256"] != pinned_hash:
            raise BaselineError(
                f"baseline scene {scene_id!r} hash mismatch — registry no longer matches "
                "the declaration; investigate before running detection"
            )
        if box(*scene["stac_item"]["bbox"]).covers(current_box):
            return scene_id
    raise BaselineError(
        f"no declared baseline scene covers the current scene's extent for "
        f"AOI {aoi_jurisdiction_id!r}"
    )
