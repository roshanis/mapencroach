"""Parcel mask checks use real, small rasters; network and catalog are simulated."""
from datetime import UTC, datetime, timedelta

import numpy as np
import pytest
from rasterio.io import MemoryFile
from rasterio.transform import from_origin

from mapencroach.imagery.clear_view import (
    ClearViewService,
    assess_mask,
    candidate_assets,
    render_parcel,
)
from mapencroach.imagery.stac_search import SceneCandidate, StacSearchError

NOW = datetime(2026, 9, 9, tzinfo=UTC)
GEOMETRY = {"type": "Polygon", "coordinates": [
    [[1005, 1955], [1045, 1955], [1045, 1995], [1005, 1995], [1005, 1955]],
]}


def candidate(day=5):
    scene_id = f"S2B_43RGP_202609{day:02d}_0_L2A"
    base = ("https://sentinel-cogs.s3.us-west-2.amazonaws.com/"
            f"sentinel-s2-l2a-cogs/43/R/GP/2026/9/{scene_id}")
    return SceneCandidate(
        scene_id, datetime(2026, 9, day, 5, tzinfo=UTC), 85.0, 10.0, "sentinel-2b",
        "Earth Search", None, f"{base}/TCI.tif",
        {"id": scene_id, "collection": "sentinel-2-l2a", "assets": {
            "scl": {"href": f"{base}/SCL.tif"}, "visual": {"href": f"{base}/TCI.tif"},
        }},
    )


def raster(data, resolution=20):
    memory = MemoryFile()
    bands = data[np.newaxis] if data.ndim == 2 else data
    with memory.open(driver="GTiff", width=bands.shape[2], height=bands.shape[1],
                     count=bands.shape[0], dtype="uint8", crs="EPSG:32643",
                     transform=from_origin(1000, 2000, resolution, resolution), nodata=0) as ds:
        ds.write(bands)
    return memory


@pytest.mark.parametrize("code", [0, 1, 2, 3, 7, 8, 9, 10, 11, 255])
def test_one_nonclear_pixel_rejects_whole_parcel(code):
    data = np.full((4, 4), 4, dtype="uint8")
    data[0, 0] = code
    with raster(data) as memory, memory.open() as ds:
        result = assess_mask(ds, GEOMETRY)
    assert result["clear"] is False
    assert result["sampled_pixels"] == 9  # includes edge pixels, not just centres


def test_clear_classes_and_full_coverage_are_required():
    data = np.array([[4, 5, 6, 0]] * 4, dtype="uint8")
    with raster(data) as memory, memory.open() as ds:
        assert assess_mask(ds, GEOMETRY)["clear"] is True
        outside = {"type": "Polygon", "coordinates": [[
            [990, 1990], [1020, 1990], [1020, 2010], [990, 2010], [990, 1990],
        ]]}
        assert assess_mask(ds, outside)["clear"] is False


def test_holes_are_excluded_and_multipolygons_include_all_parts():
    data = np.full((6, 6), 4, dtype="uint8")
    data[2, 2] = 9
    outer = [[1001, 1899], [1101, 1899], [1101, 1999], [1001, 1999], [1001, 1899]]
    hole = [[1039, 1939], [1061, 1939], [1061, 1961], [1039, 1961], [1039, 1939]]
    shape = {"type": "Polygon", "coordinates": [outer, hole]}
    with raster(data) as memory, memory.open() as ds:
        assert assess_mask(ds, shape)["clear"] is True
        other = [[1105, 1950], [1115, 1950], [1115, 1990], [1105, 1990], [1105, 1950]]
        multi = {"type": "MultiPolygon", "coordinates": [[outer], [other]]}
        assert assess_mask(ds, multi)["clear"] is False


def test_preview_is_png_with_transparency_and_visual_coverage_is_checked():
    with raster(np.full((3, 8, 8), 90, dtype="uint8"), 10) as memory, memory.open() as ds:
        png, width, height = render_parcel(ds, GEOMETRY)
        assert png.startswith(b"\x89PNG")
        assert width <= 768 and height <= 768
        with MemoryFile(png) as output, output.open() as image:
            assert image.count == 4
            assert (image.read(4) == 255).any()


def test_preview_downsampling_cannot_hide_missing_native_pixels():
    data = np.full((3, 800, 800), 90, dtype="uint8")
    data[:, 12, 12] = 0  # omitted by 800-to-768 nearest-neighbour downsampling
    geometry = {"type": "Polygon", "coordinates": [[
        [1000, -6000], [9000, -6000], [9000, 2000], [1000, 2000], [1000, -6000],
    ]]}
    with raster(data, 10) as memory, memory.open() as ds, pytest.raises(ValueError):
        render_parcel(ds, geometry)


@pytest.mark.parametrize("href", [
    "http://sentinel-cogs.s3.us-west-2.amazonaws.com/SCL.tif",
    "https://localhost/SCL.tif", "https://127.0.0.1/SCL.tif",
    "https://sentinel-cogs.s3.us-west-2.amazonaws.com/../SCL.tif",
])
def test_untrusted_asset_urls_rejected(href):
    item = candidate()
    item.stac_item["assets"]["scl"]["href"] = href
    with pytest.raises(ValueError):
        candidate_assets(item)


def test_assets_must_match_exact_scene_and_have_no_query():
    item = candidate()
    assert candidate_assets(item)[0].endswith("/SCL.tif")
    item.stac_item["assets"]["visual"]["href"] += "?signed=private"
    with pytest.raises(ValueError):
        candidate_assets(item)


class Catalog:
    def __init__(self, items=(), fail=False):
        self.items, self.fail, self.calls = items, fail, []

    def search(self, bbox, **kwargs):
        self.calls.append(kwargs)
        if self.fail:
            raise StacSearchError("private upstream details")
        return self.items


class Inspector:
    def __init__(self, outcomes):
        self.outcomes, self.seen = outcomes, []

    def inspect(self, item, geometry, budget):
        self.seen.append(item.scene_id)
        outcome = self.outcomes[item.captured_at.day]
        if isinstance(outcome, Exception):
            raise outcome
        return {"clear": outcome, "sampled_pixels": 9,
                "image_base64": "iVBORw0KGgo=", "width": 3, "height": 3}


def test_newest_clear_scene_uses_parcel_quality_not_tile_percentage():
    catalog = Catalog([candidate(3), candidate(5), candidate(4)])
    inspector = Inspector({5: False, 4: True})
    result = ClearViewService(catalog, inspector=inspector).search(GEOMETRY, end=NOW)
    assert result["status"] == "clear"
    assert result["scene_id"] == candidate(4).scene_id
    assert result["captured_at"] == candidate(4).captured_at.isoformat()
    assert result["checked_scenes"] == 2
    assert catalog.calls[0]["max_cloud_pct"] is None
    assert catalog.calls[0]["start"] == NOW - timedelta(days=90)
    assert catalog.calls[0]["limit"] == 24


def test_empty_search_and_unassessed_scenes_are_distinct():
    empty = ClearViewService(Catalog(), inspector=Inspector({})).search(GEOMETRY, end=NOW)
    assert empty["status"] == "no_clear"
    failed = ClearViewService(Catalog([candidate()]), inspector=Inspector({5: OSError("timeout")}))
    assert failed.search(GEOMETRY, end=NOW)["status"] == "incomplete"
    failed_catalog = ClearViewService(Catalog(fail=True)).search(GEOMETRY, end=NOW)
    assert failed_catalog["status"] == "provider_error"


def test_newer_failure_is_disclosed_when_older_clear_scene_is_found():
    service = ClearViewService(Catalog([candidate(5), candidate(4)]),
                              inspector=Inspector({5: OSError(), 4: True}))
    result = service.search(GEOMETRY, end=NOW)
    assert result["status"] == "clear" and result["unassessed_scenes"] == 1


def test_candidate_limit_and_old_or_future_dates_are_fail_closed():
    items = [candidate()] * 30
    inspector = Inspector({5: False})
    result = ClearViewService(Catalog(items), inspector=inspector).search(GEOMETRY, end=NOW)
    assert len(inspector.seen) <= 24
    assert result["search_limited"] is True
    result = ClearViewService(Catalog([candidate()]), inspector=inspector).search(
        GEOMETRY, end=NOW - timedelta(days=120))
    assert result["status"] == "incomplete"
