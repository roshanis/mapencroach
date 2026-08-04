import json
from datetime import UTC, datetime

import httpx
import pytest

from mapencroach.imagery.registry import DuplicateScene, SceneRegistry
from mapencroach.imagery.stac_search import (
    SENTINEL2_COLLECTION,
    StacClient,
    StacSearchError,
    build_search_payload,
    geometry_bbox,
    ingest_candidate,
    parse_items,
)

HARIDWAR_BBOX = (77.85, 29.80, 78.05, 30.00)
START = datetime(2026, 5, 1, tzinfo=UTC)
END = datetime(2026, 8, 1, tzinfo=UTC)


def stac_feature(
    scene_id: str = "S2B_43RGM_20260730_0_L2A",
    captured: str = "2026-07-30T05:25:31.024000+00:00",
    cloud: float = 12.5,
) -> dict:
    return {
        "type": "Feature",
        "id": scene_id,
        "properties": {
            "datetime": captured,
            "eo:cloud_cover": cloud,
            "platform": "sentinel-2b",
        },
        "assets": {
            "thumbnail": {"href": f"https://example.com/{scene_id}/thumb.jpg"},
            "visual": {"href": f"https://example.com/{scene_id}/TCI.tif"},
        },
    }


class TestGeometryBbox:
    def test_polygon_bbox(self):
        geometry = {
            "type": "Polygon",
            "coordinates": [
                [[77.9, 29.9], [78.0, 29.9], [78.0, 29.95], [77.9, 29.95], [77.9, 29.9]]
            ],
        }
        assert geometry_bbox(geometry) == (77.9, 29.9, 78.0, 29.95)

    def test_buffer_expands_outward(self):
        geometry = {"type": "Point", "coordinates": [78.0, 29.9]}
        assert geometry_bbox(geometry, buffer_deg=0.01) == pytest.approx(
            (77.99, 29.89, 78.01, 29.91)
        )

    def test_multipolygon_spans_all_parts(self):
        geometry = {
            "type": "MultiPolygon",
            "coordinates": [
                [[[77.9, 29.9], [77.91, 29.9], [77.91, 29.91], [77.9, 29.9]]],
                [[[78.0, 29.95], [78.01, 29.95], [78.01, 29.96], [78.0, 29.95]]],
            ],
        }
        assert geometry_bbox(geometry) == (77.9, 29.9, 78.01, 29.96)

    def test_empty_geometry_raises(self):
        with pytest.raises(ValueError):
            geometry_bbox({"type": "Polygon", "coordinates": []})


class TestSearchPayload:
    def test_payload_shape(self):
        payload = build_search_payload(
            HARIDWAR_BBOX, start=START, end=END, max_cloud_pct=30.0, limit=5
        )
        assert payload["collections"] == [SENTINEL2_COLLECTION]
        assert payload["bbox"] == list(HARIDWAR_BBOX)
        assert payload["datetime"] == "2026-05-01T00:00:00Z/2026-08-01T00:00:00Z"
        assert payload["query"] == {"eo:cloud_cover": {"lt": 30.0}}
        assert payload["limit"] == 5

    def test_no_cloud_filter_omits_query(self):
        payload = build_search_payload(
            HARIDWAR_BBOX, start=START, end=END, max_cloud_pct=None, limit=5
        )
        assert "query" not in payload

    def test_naive_datetimes_treated_as_utc(self):
        payload = build_search_payload(
            HARIDWAR_BBOX,
            start=datetime(2026, 5, 1),
            end=datetime(2026, 8, 1),
            max_cloud_pct=None,
            limit=1,
        )
        assert payload["datetime"] == "2026-05-01T00:00:00Z/2026-08-01T00:00:00Z"


class TestParseItems:
    def test_maps_feature_fields(self):
        [candidate] = parse_items([stac_feature()], source="earth-search")
        assert candidate.scene_id == "S2B_43RGM_20260730_0_L2A"
        assert candidate.captured_at == datetime(2026, 7, 30, 5, 25, 31, 24000, tzinfo=UTC)
        assert candidate.cloud_pct == 12.5
        assert candidate.resolution_m == 10.0  # sentinel-2 default when gsd absent
        assert candidate.sensor == "sentinel-2b"
        assert candidate.source == "earth-search"
        assert candidate.thumbnail_href.endswith("thumb.jpg")
        assert candidate.visual_href.endswith("TCI.tif")
        assert candidate.stac_item["id"] == candidate.scene_id

    def test_item_gsd_wins_over_default(self):
        feature = stac_feature()
        feature["properties"]["gsd"] = 20
        [candidate] = parse_items([feature], source="s")
        assert candidate.resolution_m == 20.0

    def test_malformed_features_are_skipped(self):
        malformed = [
            {"type": "Feature"},  # no id
            {"id": "no-datetime", "properties": {}},
            {"id": "bad-datetime", "properties": {"datetime": "not-a-date"}},
        ]
        candidates = parse_items([*malformed, stac_feature()], source="s")
        assert [c.scene_id for c in candidates] == ["S2B_43RGM_20260730_0_L2A"]

    def test_missing_assets_yield_none_hrefs(self):
        feature = stac_feature()
        feature["assets"] = {}
        [candidate] = parse_items([feature], source="s")
        assert candidate.thumbnail_href is None
        assert candidate.visual_href is None


def mock_client(handler) -> StacClient:
    return StacClient(
        "https://stac.test/v1/search", transport=httpx.MockTransport(handler)
    )


class TestStacClient:
    def test_search_returns_candidates(self):
        def handler(request: httpx.Request) -> httpx.Response:
            body = json.loads(request.content)
            assert body["collections"] == [SENTINEL2_COLLECTION]
            assert body["bbox"] == list(HARIDWAR_BBOX)
            return httpx.Response(200, json={"features": [stac_feature()]})

        client = mock_client(handler)
        scenes = client.search(HARIDWAR_BBOX, start=START, end=END, max_cloud_pct=30.0)
        assert len(scenes) == 1
        assert scenes[0].source == "https://stac.test/v1/search"

    def test_http_error_raises_stac_search_error(self):
        client = mock_client(lambda request: httpx.Response(500, text="boom"))
        with pytest.raises(StacSearchError):
            client.search(HARIDWAR_BBOX, start=START, end=END)

    def test_network_error_raises_stac_search_error(self):
        def handler(request: httpx.Request) -> httpx.Response:
            raise httpx.ConnectError("no route to host")

        client = mock_client(handler)
        with pytest.raises(StacSearchError):
            client.search(HARIDWAR_BBOX, start=START, end=END)

    def test_missing_features_raises_stac_search_error(self):
        client = mock_client(lambda request: httpx.Response(200, json={"type": "Catalog"}))
        with pytest.raises(StacSearchError):
            client.search(HARIDWAR_BBOX, start=START, end=END)


class TestIngestCandidate:
    def test_registers_bytes_under_catalog_metadata(self):
        [candidate] = parse_items([stac_feature()], source="earth-search")
        registry = SceneRegistry()
        record = ingest_candidate(registry, candidate, b"downloaded-scene-bytes")
        assert registry.get(candidate.scene_id) is record
        assert registry.verify(candidate.scene_id, b"downloaded-scene-bytes")
        assert record.sensor == "sentinel-2b"
        # provenance: the catalog's own STAC item, not a synthesized one
        assert record.stac_item is candidate.stac_item

    def test_dedup_still_enforced_on_reingest(self):
        [candidate] = parse_items([stac_feature()], source="earth-search")
        registry = SceneRegistry()
        ingest_candidate(registry, candidate, b"bytes")
        with pytest.raises(DuplicateScene):
            ingest_candidate(registry, candidate, b"other-bytes")
