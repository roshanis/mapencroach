"""Scene details are derived from a scoped capture, never from a browse date."""
from dataclasses import replace
from datetime import UTC, datetime

import pytest

from mapencroach.imagery.blobstore import MemoryBlobStore
from mapencroach.imagery.capture import CaptureAttempt, CaptureStatus
from mapencroach.imagery.registry import SceneRegistry
from mapencroach.imagery.view import capture_view


@pytest.fixture
def registered():
    registry = SceneRegistry(blob_store=MemoryBlobStore())
    record = registry.register(
        data=b"view-test-raster", scene_id="view-scene",
        captured_at=datetime(2026, 8, 3, tzinfo=UTC),
        sensor="sentinel-2", resolution_m=10.0, cloud_pct=7.5, source="example-catalog",
        href="https://example.test/raster?signature=do-not-project",
    )
    attempt = CaptureAttempt(week="2026-W32", status=CaptureStatus.CAPTURED,
                             attempted_at=datetime(2026, 8, 9, tzinfo=UTC),
                             scene_id=record.scene_id, sha256=record.sha256, cloud_pct=7.5)
    return registry, record, attempt


def test_projects_observation_time_separately_without_raw_stac_or_asset_urls(registered):
    registry, record, attempt = registered
    result = capture_view(attempt, registry)
    assert result["attempted_at"] != result["scene_details"]["captured_at"]
    assert result["scene_details"] == {
        "metadata_status": "available", "scene_id": record.scene_id,
        "captured_at": record.captured_at.isoformat(), "sensor": "sentinel-2",
        "resolution_m": 10.0, "cloud_pct": 7.5, "source": "example-catalog", "retained": True,
    }
    assert "signature" not in str(result)
    assert "stac_item" not in result["scene_details"]
    assert "scene_details" not in attempt.to_dict()  # no duplicated persisted state


@pytest.mark.parametrize("changes,status", [
    ({"scene_id": "missing"}, "missing"),
    ({"sha256": None}, "missing"),
    ({"sha256": "0" * 64}, "hash_mismatch"),
])
def test_missing_or_mismatched_metadata_has_no_scene_fields(registered, changes, status):
    registry, _, attempt = registered
    assert capture_view(replace(attempt, **changes), registry)["scene_details"] == {
        "metadata_status": status,
    }


def test_non_retained_scene_is_still_inspectable_metadata(registered):
    registry, record, attempt = registered
    registry._by_id[record.scene_id] = replace(record, retained=False)
    assert capture_view(attempt, registry)["scene_details"]["retained"] is False


def test_uncaptured_attempt_does_not_resolve_a_scene(registered):
    registry, _, attempt = registered
    failed = replace(attempt, status=CaptureStatus.PROVIDER_ERROR, reason="Service unavailable")
    assert capture_view(failed, registry)["scene_details"] is None


@pytest.mark.parametrize("source", [
    "https://example.test/catalog?token=secret", "//example.test/catalog",
    "www.example.test/catalog", "user@example.test", "catalog?signature=secret",
])
def test_source_projection_is_a_label_not_a_url_or_credential_container(registered, source):
    registry, record, attempt = registered
    registry._by_id[record.scene_id] = replace(record, source=source)
    details = capture_view(attempt, registry)["scene_details"]
    assert details["source"] == "Provider catalog (URL withheld)"
