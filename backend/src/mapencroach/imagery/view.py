"""Read-only metadata projection for an already authorized capture relationship.

Keep this out of CaptureAttempt.to_dict(): details are derived, not persisted.
The caller must resolve the parent and capture under its existing scope check.
No raw STAC properties, asset URLs, or image bytes are returned here.
"""
import re
from typing import Any

from mapencroach.imagery.capture import CaptureAttempt, CaptureStatus
from mapencroach.imagery.registry import SceneRegistry


def capture_view(attempt: CaptureAttempt, registry: SceneRegistry) -> dict[str, Any]:
    result = attempt.to_dict()
    result["scene_details"] = None
    if attempt.status != CaptureStatus.CAPTURED:
        return result
    details: dict[str, Any] = {"metadata_status": "missing"}
    result["scene_details"] = details
    if not attempt.scene_id or not attempt.sha256:
        return result
    try:
        record = registry.get(attempt.scene_id)
    except KeyError:
        return result
    if record.sha256 != attempt.sha256:
        details["metadata_status"] = "hash_mismatch"
        return result
    details.update(
        metadata_status="available", scene_id=record.scene_id,
        captured_at=record.captured_at.isoformat(), sensor=record.sensor,
        resolution_m=record.resolution_m, cloud_pct=record.cloud_pct,
        source=(record.source if re.fullmatch(r"[A-Za-z][A-Za-z0-9 _-]{0,119}", record.source)
                else "Provider catalog (URL withheld)"),
        retained=record.retained,
    )
    return result
