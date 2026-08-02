import hashlib
from datetime import UTC, datetime

import pytest

from mapencroach.imagery.capture import (
    CaptureAttempt,
    CaptureStatus,
    ProviderScene,
    capture_week,
)
from mapencroach.imagery.registry import SceneRegistry
from mapencroach.imagery.schedule import WeekRef

GEOMETRY = {"type": "Polygon", "coordinates": [[[0, 0], [0, 1], [1, 1], [1, 0], [0, 0]]]}
WEEK = WeekRef(2026, 32)
ATTEMPTED_AT = datetime(2026, 8, 9, 12, 0, tzinfo=UTC)


class FakeProvider:
    def __init__(self, result=None, error: Exception | None = None):
        self._result = result
        self._error = error
        self.calls: list[tuple] = []

    def fetch(self, *, geometry, week):
        self.calls.append((geometry, week))
        if self._error is not None:
            raise self._error
        return self._result


def make_scene(
    *,
    data: bytes = b"scene-bytes",
    scene_id: str = "scene-1",
    cloud_pct: float = 5.0,
    captured_at: datetime | None = None,
) -> ProviderScene:
    return ProviderScene(
        data=data,
        scene_id=scene_id,
        captured_at=captured_at or ATTEMPTED_AT,
        sensor="sentinel-2",
        resolution_m=10.0,
        cloud_pct=cloud_pct,
        source="copernicus",
        href="https://example.com/scene-1.tif",
    )


class TestCaptureAttempt:
    def test_to_dict_shape(self):
        attempt = CaptureAttempt(
            week="2026-W32",
            status=CaptureStatus.CAPTURED,
            attempted_at=ATTEMPTED_AT,
            scene_id="scene-1",
            sha256="a" * 64,
            cloud_pct=5.0,
        )
        assert attempt.to_dict() == {
            "week": "2026-W32",
            "status": "captured",
            "attempted_at": ATTEMPTED_AT.isoformat(),
            "scene_id": "scene-1",
            "sha256": "a" * 64,
            "cloud_pct": 5.0,
            "reason": None,
        }

    def test_captured_does_not_require_reason(self):
        # Should not raise.
        CaptureAttempt(week="2026-W32", status=CaptureStatus.CAPTURED, attempted_at=ATTEMPTED_AT)

    def test_non_captured_requires_reason(self):
        with pytest.raises(ValueError, match="reason"):
            CaptureAttempt(
                week="2026-W32",
                status=CaptureStatus.NO_USABLE_SCENE,
                attempted_at=ATTEMPTED_AT,
            )

    def test_is_frozen(self):
        attempt = CaptureAttempt(
            week="2026-W32", status=CaptureStatus.CAPTURED, attempted_at=ATTEMPTED_AT
        )
        with pytest.raises(Exception):  # noqa: B017 - dataclass frozen error type
            attempt.week = "2026-W33"


class TestCaptureWeekSuccess:
    def test_captured_registers_scene_and_reports_hash(self):
        registry = SceneRegistry()
        provider = FakeProvider(result=make_scene(data=b"unique-bytes", scene_id="s1"))

        attempt = capture_week(
            provider, registry, geometry=GEOMETRY, week=WEEK, attempted_at=ATTEMPTED_AT
        )

        assert attempt.status == CaptureStatus.CAPTURED
        assert attempt.week == WEEK.key
        assert attempt.scene_id == "s1"
        assert attempt.sha256 == hashlib.sha256(b"unique-bytes").hexdigest()
        assert attempt.reason is None
        assert registry.get("s1").sha256 == attempt.sha256

    def test_captured_reports_cloud_pct(self):
        registry = SceneRegistry()
        provider = FakeProvider(result=make_scene(scene_id="s2", cloud_pct=17.5))

        attempt = capture_week(
            provider, registry, geometry=GEOMETRY, week=WEEK, attempted_at=ATTEMPTED_AT
        )

        assert attempt.cloud_pct == 17.5

    def test_provider_receives_geometry_and_week(self):
        registry = SceneRegistry()
        provider = FakeProvider(result=make_scene(scene_id="s3"))

        capture_week(provider, registry, geometry=GEOMETRY, week=WEEK, attempted_at=ATTEMPTED_AT)

        assert provider.calls == [(GEOMETRY, WEEK)]


class TestCaptureWeekNoScene:
    def test_provider_returns_none(self):
        registry = SceneRegistry()
        provider = FakeProvider(result=None)

        attempt = capture_week(
            provider, registry, geometry=GEOMETRY, week=WEEK, attempted_at=ATTEMPTED_AT
        )

        assert attempt.status == CaptureStatus.NO_USABLE_SCENE
        assert attempt.scene_id is None
        assert attempt.sha256 is None
        assert attempt.reason is not None
        assert "no" in attempt.reason.lower()

    def test_nothing_registered_when_no_scene(self):
        registry = SceneRegistry()
        provider = FakeProvider(result=None)

        capture_week(provider, registry, geometry=GEOMETRY, week=WEEK, attempted_at=ATTEMPTED_AT)

        assert registry._by_id == {}  # noqa: SLF001 - asserting no side effect occurred


class TestCaptureWeekCloudThreshold:
    def test_cloud_pct_above_default_threshold_is_unusable(self):
        registry = SceneRegistry()
        provider = FakeProvider(result=make_scene(scene_id="s1", cloud_pct=40.1))

        attempt = capture_week(
            provider, registry, geometry=GEOMETRY, week=WEEK, attempted_at=ATTEMPTED_AT
        )

        assert attempt.status == CaptureStatus.NO_USABLE_SCENE
        assert attempt.cloud_pct == 40.1
        assert "40.1" in attempt.reason
        assert attempt.scene_id is None

    def test_cloud_pct_exactly_at_default_threshold_is_usable(self):
        registry = SceneRegistry()
        provider = FakeProvider(result=make_scene(scene_id="s1", cloud_pct=40.0))

        attempt = capture_week(
            provider, registry, geometry=GEOMETRY, week=WEEK, attempted_at=ATTEMPTED_AT
        )

        assert attempt.status == CaptureStatus.CAPTURED

    def test_custom_max_cloud_pct_is_honored(self):
        registry = SceneRegistry()
        provider = FakeProvider(result=make_scene(scene_id="s1", cloud_pct=25.0))

        attempt = capture_week(
            provider,
            registry,
            geometry=GEOMETRY,
            week=WEEK,
            attempted_at=ATTEMPTED_AT,
            max_cloud_pct=20.0,
        )

        assert attempt.status == CaptureStatus.NO_USABLE_SCENE
        assert "20.0" in attempt.reason

    def test_cloud_pct_just_below_custom_threshold_is_usable(self):
        registry = SceneRegistry()
        provider = FakeProvider(result=make_scene(scene_id="s1", cloud_pct=19.9))

        attempt = capture_week(
            provider,
            registry,
            geometry=GEOMETRY,
            week=WEEK,
            attempted_at=ATTEMPTED_AT,
            max_cloud_pct=20.0,
        )

        assert attempt.status == CaptureStatus.CAPTURED


class TestCaptureWeekProviderError:
    def test_provider_exception_never_escapes(self):
        registry = SceneRegistry()
        provider = FakeProvider(error=RuntimeError("upstream is on fire"))

        attempt = capture_week(
            provider, registry, geometry=GEOMETRY, week=WEEK, attempted_at=ATTEMPTED_AT
        )

        assert attempt.status == CaptureStatus.PROVIDER_ERROR
        assert "upstream is on fire" in attempt.reason
        assert attempt.scene_id is None
        assert attempt.sha256 is None

    def test_provider_error_reason_carries_exception_type_context(self):
        registry = SceneRegistry()
        provider = FakeProvider(error=ValueError("bad footprint"))

        attempt = capture_week(
            provider, registry, geometry=GEOMETRY, week=WEEK, attempted_at=ATTEMPTED_AT
        )

        assert attempt.status == CaptureStatus.PROVIDER_ERROR
        assert "bad footprint" in attempt.reason


class TestCaptureWeekDuplicateScene:
    def test_identical_retry_resolves_to_existing_record(self):
        registry = SceneRegistry()
        # First capture of the week.
        provider = FakeProvider(result=make_scene(data=b"same-bytes", scene_id="retry-1"))
        first = capture_week(
            provider, registry, geometry=GEOMETRY, week=WEEK, attempted_at=ATTEMPTED_AT
        )

        # A second attempt (e.g. a retried batch run) fetches the exact
        # same bytes under the exact same scene_id.
        retry_provider = FakeProvider(result=make_scene(data=b"same-bytes", scene_id="retry-1"))
        second = capture_week(
            retry_provider, registry, geometry=GEOMETRY, week=WEEK, attempted_at=ATTEMPTED_AT
        )

        assert second.status == CaptureStatus.CAPTURED
        assert second.scene_id == first.scene_id
        assert second.sha256 == first.sha256

    def test_same_bytes_different_scene_id_resolves_by_hash(self):
        registry = SceneRegistry()
        provider1 = FakeProvider(result=make_scene(data=b"shared-bytes", scene_id="a"))
        first = capture_week(
            provider1, registry, geometry=GEOMETRY, week=WEEK, attempted_at=ATTEMPTED_AT
        )

        # Different provider-assigned scene_id, but byte-identical payload
        # (e.g. the archive re-served the same product under a new id).
        provider2 = FakeProvider(result=make_scene(data=b"shared-bytes", scene_id="b"))
        second = capture_week(
            provider2, registry, geometry=GEOMETRY, week=WEEK, attempted_at=ATTEMPTED_AT
        )

        assert second.status == CaptureStatus.CAPTURED
        assert second.sha256 == first.sha256
        assert second.scene_id == first.scene_id  # resolves to the existing record's id

    def test_same_scene_id_different_bytes_is_not_reported_as_a_capture(self):
        """A scene_id collision against different bytes must not become a capture.

        Reporting CAPTURED here would put a sha256 in the evidence
        timeline that is not the hash of the scene the provider returned
        -- the week would claim an anchor to bytes that were never
        stored. The registry refuses to re-point an id at a new payload;
        capture_week has to surface that, not resolve around it.
        """
        registry = SceneRegistry()
        provider1 = FakeProvider(result=make_scene(data=b"original-bytes", scene_id="dup-id"))
        first = capture_week(
            provider1, registry, geometry=GEOMETRY, week=WEEK, attempted_at=ATTEMPTED_AT
        )

        # A provider bug or upstream re-processing serves different bytes
        # under an id that is already registered.
        provider2 = FakeProvider(result=make_scene(data=b"different-bytes", scene_id="dup-id"))
        second = capture_week(
            provider2, registry, geometry=GEOMETRY, week=WEEK, attempted_at=ATTEMPTED_AT
        )

        assert second.status == CaptureStatus.PROVIDER_ERROR
        assert second.reason is not None
        assert "different bytes" in second.reason
        # Crucially, it does not inherit the first capture's hash.
        assert second.sha256 is None
        assert second.sha256 != first.sha256

        # The original record is untouched: the id still resolves to the
        # bytes it was registered with.
        assert registry.get("dup-id").sha256 == first.sha256

    def test_reported_sha256_always_matches_the_bytes_received(self):
        """The invariant behind the timeline: a reported hash describes the scene."""
        registry = SceneRegistry()
        for data, scene_id in ((b"aaa", "s-1"), (b"bbb", "s-2"), (b"aaa", "s-3")):
            attempt = capture_week(
                FakeProvider(result=make_scene(data=data, scene_id=scene_id)),
                registry,
                geometry=GEOMETRY,
                week=WEEK,
                attempted_at=ATTEMPTED_AT,
            )
            if attempt.status == CaptureStatus.CAPTURED:
                assert attempt.sha256 == hashlib.sha256(data).hexdigest()
