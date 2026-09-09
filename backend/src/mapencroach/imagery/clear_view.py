"""Exact-scene parcel previews selected using native Sentinel-2 SCL pixels.

    A passing mask is a screening rule, not proof of perfect cloud detection.
    No scenes, searches, or PNGs are registered/persisted by this module.
"""
import base64
import math
import re
import time
from datetime import timedelta
from uuid import uuid4

import httpx
import numpy as np
import rasterio
from rasterio.enums import Resampling
from rasterio.features import geometry_mask, geometry_window
from rasterio.io import MemoryFile
from rasterio.warp import transform_geom
from shapely.geometry import box, shape

from mapencroach.imagery.cog_reader import RangeReader, ReadBudget
from mapencroach.imagery.stac_search import StacSearchError, geometry_bbox

MAX_CANDIDATES = 24
MAX_MASK_PIXELS = 1_000_000
MAX_PREVIEW_EDGE = 768
MAX_PNG_BYTES = 3_000_000


def candidate_assets(candidate):
    """Require exact server-derived asset paths and matching collection/identity."""
    match = re.fullmatch(r"S2[ABC]_(\d{2})([C-HJ-NP-X])([A-Z]{2})_(\d{8})_(\d{1,3})_L2A",
                         candidate.scene_id)
    item = candidate.stac_item
    if (not match or item.get("id") != candidate.scene_id
            or item.get("collection") != "sentinel-2-l2a"):
        raise ValueError("Unrecognized scene identity")
    zone, band, square, day, _ = match.groups()
    if not 1 <= int(zone) <= 60 or candidate.captured_at.strftime("%Y%m%d") != day:
        raise ValueError("Scene date or zone disagrees")
    base = ("https://sentinel-cogs.s3.us-west-2.amazonaws.com/sentinel-s2-l2a-cogs/"
            f"{int(zone)}/{band}/{square}/{day[:4]}/{int(day[4:6])}/{candidate.scene_id}")
    expected = (f"{base}/SCL.tif", f"{base}/TCI.tif")
    assets = item.get("assets", {})
    actual = tuple(assets.get(key, {}).get("href") for key in ("scl", "visual"))
    if actual != expected:
        raise ValueError("Scene assets do not match the approved public layout")
    return expected


def parcel_window(dataset, geometry):
    polygon = shape(geometry)
    if polygon.is_empty or not polygon.is_valid or polygon.geom_type not in {
        "Polygon", "MultiPolygon",
    }:
        raise ValueError("Invalid parcel geometry")
    if not box(*dataset.bounds).covers(polygon):
        return None
    window = geometry_window(dataset, [geometry], boundless=False)
    if window.width * window.height > MAX_MASK_PIXELS:
        raise ValueError("Parcel exceeds the bounded raster window")
    return window


def assess_mask(dataset, projected_geometry):
    """Check every touched native SCL pixel; no resampling or colour heuristic."""
    window = parcel_window(dataset, projected_geometry)
    if window is None:
        return {"clear": False, "sampled_pixels": 0}
    data = dataset.read(1, window=window, masked=True)
    inside = geometry_mask([projected_geometry], out_shape=data.shape,
                           transform=dataset.window_transform(window),
                           all_touched=True, invert=True)
    pixels = data[inside]
    count = int(pixels.size)
    clear = bool(count and not np.ma.getmaskarray(pixels).any()
                 and np.isin(pixels.data, [4, 5, 6]).all())
    return {"clear": clear, "sampled_pixels": count}


def render_parcel(dataset, projected_geometry):
    window = parcel_window(dataset, projected_geometry)
    if window is None or dataset.count < 3 or dataset.dtypes[:3] != ("uint8",) * 3:
        raise ValueError("Colour imagery has no complete parcel coverage")
    native = dataset.read([1, 2, 3], window=window, masked=True)
    native_inside = geometry_mask([projected_geometry], out_shape=native.shape[1:],
                                  transform=dataset.window_transform(window),
                                  all_touched=True, invert=True)
    if not native_inside.any() or np.ma.getmaskarray(native)[:, native_inside].any():
        raise ValueError("Colour imagery contains missing native parcel pixels")
    scale = min(1.0, MAX_PREVIEW_EDGE / max(window.width, window.height))
    width = max(1, math.ceil(window.width * scale))
    height = max(1, math.ceil(window.height * scale))
    transform = dataset.window_transform(window) * rasterio.Affine.scale(
        window.width / width, window.height / height)
    rgb = dataset.read([1, 2, 3], window=window, out_shape=(3, height, width),
                       masked=True, resampling=Resampling.nearest)
    inside = geometry_mask([projected_geometry], out_shape=(height, width),
                           transform=transform, all_touched=True, invert=True)
    if not inside.any() or np.ma.getmaskarray(rgb)[:, inside].any():
        raise ValueError("Colour imagery contains missing parcel pixels")
    rgba = np.concatenate((rgb.filled(0), (inside.astype("uint8") * 255)[np.newaxis]))
    # Clear surroundings rather than implying that areas outside the mask passed.
    rgba[:3, ~inside] = 0
    with MemoryFile() as memory:
        with memory.open(driver="PNG", width=width, height=height, count=4,
                         dtype="uint8", transform=transform) as output:
            output.write(rgba)
        png = memory.read()
        if len(png) > MAX_PNG_BYTES:
            raise ValueError("Rendered preview exceeds its byte limit")
        return png, width, height


class CogInspector:
    def inspect(self, candidate, geometry, budget):
        scl_url, visual_url = candidate_assets(candidate)
        with httpx.Client(timeout=4, follow_redirects=False, trust_env=False) as client:
            def open_asset(url):
                reader = RangeReader(url, client, budget)
                name = f"{uuid4().hex}/{url.rsplit('/', 1)[1]}"

                def opener(path, mode="rb"):
                    if path != name or mode not in {"r", "rb"}:
                        raise FileNotFoundError(path)
                    reader.seek(0)
                    return reader

                return rasterio.open(name, opener=opener, driver="GTiff")

            with rasterio.Env(GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR", GDAL_PAM_ENABLED="NO"):
                with open_asset(scl_url) as dataset:
                    if (dataset.crs is None or not dataset.crs.is_projected
                            or dataset.crs.linear_units != "metre" or dataset.count != 1
                            or dataset.dtypes[0] != "uint8"
                            or dataset.transform.b != 0 or dataset.transform.d != 0
                            or not all(abs(r - 20) < 0.01 for r in dataset.res)):
                        raise ValueError("Unexpected SCL grid")
                    projected = transform_geom("EPSG:4326", dataset.crs, geometry)
                    result = assess_mask(dataset, projected)
                if not result["clear"]:
                    return result
                budget.check()
                with open_asset(visual_url) as dataset:
                    if (dataset.crs is None or not dataset.crs.is_projected
                            or dataset.crs.linear_units != "metre"
                            or dataset.transform.b != 0 or dataset.transform.d != 0
                            or not all(abs(r - 10) < 0.01 for r in dataset.res)):
                        raise ValueError("Unexpected colour image grid")
                    projected = transform_geom("EPSG:4326", dataset.crs, geometry)
                    png, width, height = render_parcel(dataset, projected)
                return {**result, "image_base64": base64.b64encode(png).decode("ascii"),
                        "width": width, "height": height}


class ClearViewService:
    def __init__(self, catalog, *, inspector=None):
        self.catalog = catalog
        self.inspector = inspector or CogInspector()

    def search(self, geometry, *, end):
        start = end - timedelta(days=90)
        budget = ReadBudget()
        result = {"status": "no_clear", "checked_scenes": 0, "unassessed_scenes": 0,
                  "search_limited": False, "from": start.isoformat(), "to": end.isoformat()}
        try:
            candidates = self.catalog.search(geometry_bbox(geometry), start=start, end=end,
                                             max_cloud_pct=None, limit=MAX_CANDIDATES)
        except (StacSearchError, ValueError):
            return {**result, "status": "provider_error"}
        result["search_limited"] = len(candidates) >= MAX_CANDIDATES
        eligible = []
        for item in candidates[:MAX_CANDIDATES]:
            if item.captured_at.tzinfo is None or not start <= item.captured_at <= end:
                result["unassessed_scenes"] += 1
            else:
                eligible.append(item)
        eligible.sort(key=lambda item: item.captured_at, reverse=True)
        for index, candidate in enumerate(eligible):
            if time.monotonic() >= budget.deadline:
                result["unassessed_scenes"] += len(eligible) - index
                result["search_limited"] = True
                break
            try:
                candidate_assets(candidate)
                inspected = self.inspector.inspect(candidate, geometry, budget)
            except (OSError, ValueError, httpx.HTTPError, rasterio.errors.RasterioError):
                result["unassessed_scenes"] += 1
                continue
            result["checked_scenes"] += 1
            if inspected["clear"]:
                return {**result, "status": "clear", "scene_id": candidate.scene_id,
                        "captured_at": candidate.captured_at.isoformat(),
                        "sensor": candidate.sensor, "source": "Sentinel-2 L2A / Earth Search",
                        "mask_resolution_m": 20, "sampled_pixels": inspected["sampled_pixels"],
                        "rule": "All parcel pixels classified vegetation, bare soil or water",
                        "image_base64": inspected["image_base64"], "width": inspected["width"],
                        "height": inspected["height"]}
        if result["unassessed_scenes"]:
            result["status"] = "incomplete"
        return result
