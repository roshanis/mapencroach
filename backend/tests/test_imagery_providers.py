import json
from datetime import UTC, date, datetime

import httpx
import pytest

from mapencroach.imagery.capture import ProviderScene
from mapencroach.imagery.providers import (
    CopernicusAuthError,
    CopernicusCatalogError,
    CopernicusDownloadError,
    CopernicusSentinel2Provider,
    DemoImageryProvider,
    build_provider,
)
from mapencroach.imagery.schedule import WeekRef, weeks_from

GEOMETRY = {"type": "Polygon", "coordinates": [[[78.0, 29.8], [78.0, 29.9], [78.1, 29.9]]]}
OTHER_GEOMETRY = {"type": "Polygon", "coordinates": [[[10.0, 10.0], [10.0, 10.1], [10.1, 10.1]]]}
WEEK = WeekRef(2026, 32)


class TestDemoImageryProviderDeterminism:
    def test_same_inputs_produce_identical_bytes(self):
        s1 = DemoImageryProvider().fetch(geometry=GEOMETRY, week=WEEK)
        s2 = DemoImageryProvider().fetch(geometry=GEOMETRY, week=WEEK)
        assert s1 is not None and s2 is not None
        assert s1.data == s2.data
        assert s1.scene_id == s2.scene_id
        assert s1.cloud_pct == s2.cloud_pct
        assert s1.captured_at == s2.captured_at

    def test_same_inputs_are_stable_across_many_calls(self):
        provider = DemoImageryProvider()
        results = [provider.fetch(geometry=GEOMETRY, week=WEEK) for _ in range(5)]
        assert all(r.data == results[0].data for r in results)

    def test_different_week_changes_output(self):
        provider = DemoImageryProvider()
        a = provider.fetch(geometry=GEOMETRY, week=WeekRef(2026, 32))
        b = provider.fetch(geometry=GEOMETRY, week=WeekRef(2026, 33))
        # At least one of the two must differ (both being None for two
        # different weeks with the same geometry would be a collision).
        assert (a is None) != (b is None) or (a is not None and a.data != b.data)

    def test_different_geometry_changes_output(self):
        provider = DemoImageryProvider()
        a = provider.fetch(geometry=GEOMETRY, week=WEEK)
        b = provider.fetch(geometry=OTHER_GEOMETRY, week=WEEK)
        assert (a is None) != (b is None) or (a is not None and a.data != b.data)

    def test_no_network_dependency_needed(self):
        # Sanity: fetch works with no HTTP client configured at all --
        # this class has no such dependency in the first place.
        provider = DemoImageryProvider()
        provider.fetch(geometry=GEOMETRY, week=WEEK)  # must not raise

    def test_captured_at_derives_only_from_week_not_wall_clock(self):
        provider = DemoImageryProvider()
        scene = provider.fetch(geometry=GEOMETRY, week=WeekRef(2026, 40))
        while scene is None:
            # extremely unlikely for W40 given the fixed distribution,
            # but guard defensively rather than assume.
            scene = provider.fetch(geometry=GEOMETRY, week=WeekRef(2026, 40))
        assert scene.captured_at.date() >= WeekRef(2026, 40).start
        assert scene.captured_at.date() <= WeekRef(2026, 40).end


class TestDemoImageryProviderGapHandling:
    def test_yields_a_mix_of_absent_cloudy_and_clear_weeks(self):
        provider = DemoImageryProvider()
        weeks = weeks_from(date(2026, 1, 1), date(2026, 12, 31))

        absent = cloudy = clear = 0
        for week in weeks:
            scene = provider.fetch(geometry=GEOMETRY, week=week)
            if scene is None:
                absent += 1
            elif scene.cloud_pct > 40.0:
                cloudy += 1
            else:
                clear += 1

        assert absent > 0, "expected at least one week with no coverage at all"
        assert cloudy > 0, "expected at least one week over the default cloud threshold"
        assert clear > 0, "expected at least one usable clear week"

    def test_absent_week_returns_none(self):
        provider = DemoImageryProvider()
        weeks = weeks_from(date(2026, 1, 1), date(2026, 12, 31))
        assert any(provider.fetch(geometry=GEOMETRY, week=w) is None for w in weeks)

    def test_returned_scene_matches_provider_scene_contract(self):
        provider = DemoImageryProvider()
        weeks = weeks_from(date(2026, 1, 1), date(2026, 12, 31))
        scene = next(
            s
            for s in (provider.fetch(geometry=GEOMETRY, week=w) for w in weeks)
            if s is not None
        )
        assert isinstance(scene, ProviderScene)
        assert scene.source == "demo"
        assert 0.0 <= scene.cloud_pct <= 100.0
        assert scene.data.startswith(b"\x89PNG")


class TestBuildProvider:
    def test_demo_env_flag_forces_demo_provider(self, monkeypatch):
        monkeypatch.setenv("MAPENCROACH_DEMO", "1")
        monkeypatch.setenv("COPERNICUS_CLIENT_ID", "id")
        monkeypatch.setenv("COPERNICUS_CLIENT_SECRET", "secret")
        assert isinstance(build_provider(), DemoImageryProvider)

    def test_missing_credentials_falls_back_to_demo(self, monkeypatch):
        monkeypatch.delenv("MAPENCROACH_DEMO", raising=False)
        monkeypatch.delenv("COPERNICUS_CLIENT_ID", raising=False)
        monkeypatch.delenv("COPERNICUS_CLIENT_SECRET", raising=False)
        assert isinstance(build_provider(), DemoImageryProvider)

    def test_partial_credentials_falls_back_to_demo(self, monkeypatch):
        monkeypatch.delenv("MAPENCROACH_DEMO", raising=False)
        monkeypatch.setenv("COPERNICUS_CLIENT_ID", "id-only")
        monkeypatch.delenv("COPERNICUS_CLIENT_SECRET", raising=False)
        assert isinstance(build_provider(), DemoImageryProvider)

    def test_full_credentials_select_copernicus_provider(self, monkeypatch):
        monkeypatch.delenv("MAPENCROACH_DEMO", raising=False)
        monkeypatch.setenv("COPERNICUS_CLIENT_ID", "id")
        monkeypatch.setenv("COPERNICUS_CLIENT_SECRET", "secret")
        provider = build_provider()
        try:
            assert isinstance(provider, CopernicusSentinel2Provider)
        finally:
            provider.close()


# ---------------------------------------------------------------------------
# CopernicusSentinel2Provider -- exercised entirely against mocked HTTP.
# There are no live Copernicus credentials in this environment; these
# tests verify request construction, token handling, and error paths
# against the documented API shape, not against the real service.
# ---------------------------------------------------------------------------

TOKEN_RESPONSE = {"access_token": "tok-1", "expires_in": 300}

CATALOG_RESPONSE = {
    "features": [
        {
            "id": "S2B_MSIL2A_20260805",
            "properties": {
                "datetime": "2026-08-05T05:30:00Z",
                "eo:cloud_cover": 12.5,
                "gsd": 10.0,
            },
            "assets": {"data": {"href": "https://example.com/scene.tif"}},
        },
        {
            "id": "S2A_MSIL2A_20260803",
            "properties": {
                "datetime": "2026-08-03T05:20:00Z",
                "eo:cloud_cover": 45.0,
                "gsd": 10.0,
            },
            "assets": {"data": {"href": "https://example.com/other.tif"}},
        },
    ]
}


def make_provider(handler, **kwargs) -> CopernicusSentinel2Provider:
    transport = httpx.MockTransport(handler)
    client = httpx.Client(transport=transport)
    return CopernicusSentinel2Provider(
        client_id="demo-id",
        client_secret="demo-secret",  # noqa: S106 - test fixture, not a real credential
        http_client=client,
        **kwargs,
    )


def default_handler(requests: list[httpx.Request]):
    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        if request.url.path.endswith("/token"):
            return httpx.Response(200, json=TOKEN_RESPONSE)
        if "catalog" in str(request.url):
            return httpx.Response(200, json=CATALOG_RESPONSE)
        if "process" in str(request.url):
            return httpx.Response(200, content=b"fake-raster-bytes")
        raise AssertionError(f"unexpected request to {request.url}")

    return handler


class TestCopernicusConstruction:
    def test_requires_credentials(self, monkeypatch):
        monkeypatch.delenv("COPERNICUS_CLIENT_ID", raising=False)
        monkeypatch.delenv("COPERNICUS_CLIENT_SECRET", raising=False)
        with pytest.raises(ValueError, match="client_id"):
            CopernicusSentinel2Provider()

    def test_reads_credentials_from_env_when_not_passed(self, monkeypatch):
        monkeypatch.setenv("COPERNICUS_CLIENT_ID", "env-id")
        monkeypatch.setenv("COPERNICUS_CLIENT_SECRET", "env-secret")
        provider = CopernicusSentinel2Provider(http_client=httpx.Client())
        try:
            assert provider._client_id == "env-id"  # noqa: SLF001
            assert provider._client_secret == "env-secret"  # noqa: SLF001, S105
        finally:
            provider.close()

    def test_explicit_args_override_env(self, monkeypatch):
        monkeypatch.setenv("COPERNICUS_CLIENT_ID", "env-id")
        monkeypatch.setenv("COPERNICUS_CLIENT_SECRET", "env-secret")
        provider = CopernicusSentinel2Provider(
            client_id="explicit-id",
            client_secret="explicit-secret",  # noqa: S106 - test fixture, not a real credential
            http_client=httpx.Client(),
        )
        try:
            assert provider._client_id == "explicit-id"  # noqa: SLF001
        finally:
            provider.close()


class TestCopernicusFetchSuccess:
    def test_fetch_returns_scene_from_lowest_cloud_cover_item(self):
        requests: list[httpx.Request] = []
        provider = make_provider(default_handler(requests))

        scene = provider.fetch(geometry=GEOMETRY, week=WEEK)

        assert scene is not None
        assert scene.scene_id == "S2B_MSIL2A_20260805"  # 12.5% < 45.0%
        assert scene.cloud_pct == 12.5
        assert scene.sensor == "sentinel-2"
        assert scene.source == "copernicus"
        assert scene.resolution_m == 10.0
        assert scene.data == b"fake-raster-bytes"
        assert scene.href == "https://example.com/scene.tif"
        assert scene.captured_at.isoformat() == "2026-08-05T05:30:00+00:00"

    def test_catalog_request_is_scoped_to_week_and_geometry(self):
        requests: list[httpx.Request] = []
        provider = make_provider(default_handler(requests))

        provider.fetch(geometry=GEOMETRY, week=WEEK)

        catalog_request = next(r for r in requests if "catalog" in str(r.url))
        body = json.loads(catalog_request.content)
        assert body["collections"] == ["sentinel-2-l2a"]
        assert WEEK.start.isoformat() in body["datetime"]
        assert WEEK.end.isoformat() in body["datetime"]
        assert body["intersects"] == GEOMETRY

    def test_token_is_sent_as_bearer_header_on_catalog_and_process_calls(self):
        requests: list[httpx.Request] = []
        provider = make_provider(default_handler(requests))

        provider.fetch(geometry=GEOMETRY, week=WEEK)

        catalog_request = next(r for r in requests if "catalog" in str(r.url))
        process_request = next(r for r in requests if "process" in str(r.url))
        assert catalog_request.headers["authorization"] == "Bearer tok-1"
        assert process_request.headers["authorization"] == "Bearer tok-1"

    def test_process_request_carries_item_id_and_footprint(self):
        requests: list[httpx.Request] = []
        provider = make_provider(default_handler(requests))

        provider.fetch(geometry=GEOMETRY, week=WEEK)

        process_request = next(r for r in requests if "process" in str(r.url))
        body = json.loads(process_request.content)
        assert body["input"]["bounds"]["geometry"] == GEOMETRY
        assert body["input"]["data"][0]["dataFilter"]["ids"] == ["S2B_MSIL2A_20260805"]

    def test_token_request_uses_client_credentials_grant(self):
        requests: list[httpx.Request] = []
        provider = make_provider(default_handler(requests))

        provider.fetch(geometry=GEOMETRY, week=WEEK)

        token_request = next(r for r in requests if r.url.path.endswith("/token"))
        form = dict(pair.split("=") for pair in token_request.content.decode().split("&"))
        assert form["grant_type"] == "client_credentials"
        assert form["client_id"] == "demo-id"
        assert form["client_secret"] == "demo-secret"  # noqa: S105 - test fixture value

    def test_token_is_cached_across_multiple_fetches(self):
        requests: list[httpx.Request] = []
        provider = make_provider(default_handler(requests))

        provider.fetch(geometry=GEOMETRY, week=WEEK)
        provider.fetch(geometry=GEOMETRY, week=WeekRef(2026, 33))

        token_requests = [r for r in requests if r.url.path.endswith("/token")]
        assert len(token_requests) == 1

    def test_token_is_refetched_once_expired(self):
        requests: list[httpx.Request] = []

        def handler(request: httpx.Request) -> httpx.Response:
            requests.append(request)
            if request.url.path.endswith("/token"):
                return httpx.Response(200, json={"access_token": "tok-x", "expires_in": 0})
            if "catalog" in str(request.url):
                return httpx.Response(200, json=CATALOG_RESPONSE)
            return httpx.Response(200, content=b"bytes")

        provider = make_provider(handler)
        provider.fetch(geometry=GEOMETRY, week=WEEK)
        provider.fetch(geometry=GEOMETRY, week=WeekRef(2026, 33))

        token_requests = [r for r in requests if r.url.path.endswith("/token")]
        assert len(token_requests) == 2


class TestCopernicusFetchFallbacks:
    def test_missing_stac_datetime_falls_back_to_epoch_not_wall_clock(self):
        catalog_response = {
            "features": [
                {
                    "id": "no-datetime-item",
                    "properties": {"eo:cloud_cover": 5.0},
                    "assets": {"data": {"href": "https://example.com/x.tif"}},
                }
            ]
        }

        def handler(request: httpx.Request) -> httpx.Response:
            if request.url.path.endswith("/token"):
                return httpx.Response(200, json=TOKEN_RESPONSE)
            if "catalog" in str(request.url):
                return httpx.Response(200, json=catalog_response)
            return httpx.Response(200, content=b"bytes")

        provider = make_provider(handler)
        scene = provider.fetch(geometry=GEOMETRY, week=WEEK)
        assert scene.captured_at == datetime.fromtimestamp(0, tz=UTC)

    def test_href_falls_back_to_any_asset_when_no_named_asset_present(self):
        catalog_response = {
            "features": [
                {
                    "id": "odd-asset-item",
                    "properties": {"datetime": "2026-08-05T00:00:00Z", "eo:cloud_cover": 5.0},
                    "assets": {"thumbnail": {"href": "https://example.com/thumb.png"}},
                }
            ]
        }

        def handler(request: httpx.Request) -> httpx.Response:
            if request.url.path.endswith("/token"):
                return httpx.Response(200, json=TOKEN_RESPONSE)
            if "catalog" in str(request.url):
                return httpx.Response(200, json=catalog_response)
            return httpx.Response(200, content=b"bytes")

        provider = make_provider(handler)
        scene = provider.fetch(geometry=GEOMETRY, week=WEEK)
        assert scene.href == "https://example.com/thumb.png"

    def test_href_falls_back_to_process_url_when_no_assets_at_all(self):
        catalog_response = {
            "features": [
                {
                    "id": "no-assets-item",
                    "properties": {"datetime": "2026-08-05T00:00:00Z", "eo:cloud_cover": 5.0},
                    "assets": {},
                }
            ]
        }

        def handler(request: httpx.Request) -> httpx.Response:
            if request.url.path.endswith("/token"):
                return httpx.Response(200, json=TOKEN_RESPONSE)
            if "catalog" in str(request.url):
                return httpx.Response(200, json=catalog_response)
            return httpx.Response(200, content=b"bytes")

        provider = make_provider(handler, process_url="https://example.com/process")
        scene = provider.fetch(geometry=GEOMETRY, week=WEEK)
        assert scene.href == "https://example.com/process"


class TestCopernicusFetchNoScene:
    def test_empty_catalog_returns_none(self):
        def handler(request: httpx.Request) -> httpx.Response:
            if request.url.path.endswith("/token"):
                return httpx.Response(200, json=TOKEN_RESPONSE)
            if "catalog" in str(request.url):
                return httpx.Response(200, json={"features": []})
            raise AssertionError("process should not be called with no catalog results")

        provider = make_provider(handler)
        assert provider.fetch(geometry=GEOMETRY, week=WEEK) is None


class TestCopernicusErrorPaths:
    def test_token_http_error_raises_auth_error(self):
        def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(401, text="invalid client")

        provider = make_provider(handler)
        with pytest.raises(CopernicusAuthError, match="401"):
            provider.fetch(geometry=GEOMETRY, week=WEEK)

    def test_token_response_missing_access_token_raises(self):
        def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(200, json={"expires_in": 300})

        provider = make_provider(handler)
        with pytest.raises(CopernicusAuthError, match="access_token"):
            provider.fetch(geometry=GEOMETRY, week=WEEK)

    def test_catalog_http_error_raises_catalog_error(self):
        def handler(request: httpx.Request) -> httpx.Response:
            if request.url.path.endswith("/token"):
                return httpx.Response(200, json=TOKEN_RESPONSE)
            return httpx.Response(500, text="internal error")

        provider = make_provider(handler)
        with pytest.raises(CopernicusCatalogError, match="500"):
            provider.fetch(geometry=GEOMETRY, week=WEEK)

    def test_download_http_error_raises_download_error(self):
        def handler(request: httpx.Request) -> httpx.Response:
            if request.url.path.endswith("/token"):
                return httpx.Response(200, json=TOKEN_RESPONSE)
            if "catalog" in str(request.url):
                return httpx.Response(200, json=CATALOG_RESPONSE)
            return httpx.Response(503, text="unavailable")

        provider = make_provider(handler)
        with pytest.raises(CopernicusDownloadError, match="503"):
            provider.fetch(geometry=GEOMETRY, week=WEEK)

    def test_network_error_during_token_wraps_as_auth_error(self):
        def handler(request: httpx.Request) -> httpx.Response:
            raise httpx.ConnectError("connection refused", request=request)

        provider = make_provider(handler)
        with pytest.raises(CopernicusAuthError, match="connection refused"):
            provider.fetch(geometry=GEOMETRY, week=WEEK)

    def test_network_error_during_catalog_search_wraps_as_catalog_error(self):
        def handler(request: httpx.Request) -> httpx.Response:
            if request.url.path.endswith("/token"):
                return httpx.Response(200, json=TOKEN_RESPONSE)
            raise httpx.ReadTimeout("timed out", request=request)

        provider = make_provider(handler)
        with pytest.raises(CopernicusCatalogError, match="timed out"):
            provider.fetch(geometry=GEOMETRY, week=WEEK)

    def test_network_error_during_download_wraps_as_download_error(self):
        def handler(request: httpx.Request) -> httpx.Response:
            if request.url.path.endswith("/token"):
                return httpx.Response(200, json=TOKEN_RESPONSE)
            if "catalog" in str(request.url):
                return httpx.Response(200, json=CATALOG_RESPONSE)
            raise httpx.ReadTimeout("timed out", request=request)

        provider = make_provider(handler)
        with pytest.raises(CopernicusDownloadError, match="timed out"):
            provider.fetch(geometry=GEOMETRY, week=WEEK)

    def test_provider_error_is_catchable_by_capture_week(self):
        # Contract: capture_week must be able to turn any provider
        # exception into PROVIDER_ERROR without special-casing Copernicus.
        from mapencroach.imagery.capture import CaptureStatus, capture_week
        from mapencroach.imagery.registry import SceneRegistry

        def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(500, text="boom")

        provider = make_provider(handler)
        attempt = capture_week(
            provider,
            SceneRegistry(),
            geometry=GEOMETRY,
            week=WEEK,
            attempted_at=datetime(2026, 8, 9, tzinfo=UTC),
        )
        assert attempt.status == CaptureStatus.PROVIDER_ERROR
        assert "boom" in attempt.reason
