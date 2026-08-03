"""Classical building-footprint extraction from VNIR imagery.

Confirmation (detection/confirm.py) needs a footprint layer to test new
change against: PLAN §12 expects that layer to come from Google Open
Buildings / MS Footprints, and PLAN §9-10 expects approved-plan imports.
Neither exists for every parcel on day one. This module bootstraps a
footprint where no such layer has been loaded yet, using the same
band-ratio-first approach as screening.py: an NDVI/brightness threshold
plus two rounds of pure-numpy morphology (an opening to kill salt noise,
a closing to fill pinholes) — deliberately classical and explainable in
front of an officer or a court, not a black-box segmentation model. Per
PLAN §11 ("band-ratio first, deep models when labels justify"), a
learned footprint model waits until officer dispositions on confirmed
alerts accumulate into enough labels to justify one; until then this is
the whole footprint story.

Only numpy, rasterio and shapely are used — no scipy, no scikit-image —
so the morphology below is hand-rolled: 3x3-square erosion/dilation via
shifted-slice boolean algebra, which is easy for a reviewer to read pixel
by pixel with no import doubling as a dependency risk.
"""

from dataclasses import dataclass
from typing import Any

import numpy as np
import rasterio
from rasterio.features import shapes as raster_shapes
from rasterio.mask import mask as raster_mask
from rasterio.warp import transform_geom
from shapely.geometry import mapping, shape

from mapencroach.detection.geo import buffer_m
from mapencroach.detection.screening import DEFAULT_BAND_MAP, BandMap, brightness, ndvi

_WGS84 = "EPSG:4326"


@dataclass(frozen=True)
class FootprintThresholds:
    """Classification + cleanup thresholds.

    Defaults are picked against the same synthetic VNIR values used
    throughout this codebase (see tests): healthy canopy has
    NDVI ~= 0.67 and mean brightness ~= 90 (8-bit DN); bare
    earth/roofing/concrete has NDVI ~= -0.25 and mean brightness ~= 130.
    ``ndvi_max`` and ``brightness_min`` sit roughly midway between those
    pairs so either signal alone already separates the two classes, and
    requiring both cuts shadow/soil false positives that only trip one.
    """

    ndvi_max: float = 0.1  # built-up: vegetation index must be at or below this
    brightness_min: float = 110.0  # built-up: mean DN across bands must exceed this (8-bit)
    min_area_m2: float = 25.0  # drop blobs smaller than this after cleanup


DEFAULT_THRESHOLDS = FootprintThresholds()


def built_up_mask(
    bands: np.ndarray,
    band_map: BandMap = DEFAULT_BAND_MAP,
    thresholds: FootprintThresholds = DEFAULT_THRESHOLDS,
) -> np.ndarray:
    """Boolean mask of pixels that look built-up: low NDVI and bright."""
    return (ndvi(bands, band_map) <= thresholds.ndvi_max) & (
        brightness(bands) >= thresholds.brightness_min
    )


def _erode(mask: np.ndarray) -> np.ndarray:
    """3x3-square erosion: a pixel survives only if its full neighborhood is set.

    Pixels outside the array count as unset (no wraparound, no false
    survivors at the raster edge).
    """
    padded = np.pad(mask, 1, mode="constant", constant_values=False)
    height, width = mask.shape
    out = np.ones_like(mask, dtype=bool)
    for dr in (-1, 0, 1):
        for dc in (-1, 0, 1):
            out &= padded[1 + dr : 1 + dr + height, 1 + dc : 1 + dc + width]
    return out


def _dilate(mask: np.ndarray) -> np.ndarray:
    """3x3-square dilation: a pixel is set if any neighbor (or itself) is set."""
    padded = np.pad(mask, 1, mode="constant", constant_values=False)
    height, width = mask.shape
    out = np.zeros_like(mask, dtype=bool)
    for dr in (-1, 0, 1):
        for dc in (-1, 0, 1):
            out |= padded[1 + dr : 1 + dr + height, 1 + dc : 1 + dc + width]
    return out


def _opening(mask: np.ndarray) -> np.ndarray:
    """Erode then dilate: removes isolated salt-noise pixels."""
    return _dilate(_erode(mask))


def _closing(mask: np.ndarray) -> np.ndarray:
    """Dilate then erode: fills small pinhole gaps inside a blob."""
    return _erode(_dilate(mask))


def _require_projected_crs(dataset: rasterio.DatasetReader) -> None:
    if dataset.crs is None or dataset.crs.is_geographic:
        raise ValueError(
            "footprint extraction requires a projected CRS (meters); "
            f"got {dataset.crs} — reproject scenes before extracting footprints"
        )


def extract_footprints(
    dataset: rasterio.DatasetReader,
    aoi_geometry_wgs84: dict[str, Any] | None = None,
    *,
    band_map: BandMap = DEFAULT_BAND_MAP,
    thresholds: FootprintThresholds = DEFAULT_THRESHOLDS,
) -> list[dict[str, Any]]:
    """Extract built-up footprint polygons (GeoJSON, WGS84) from one scene.

    Classifies built-up pixels (NDVI/brightness thresholds), cleans the
    mask with one opening and one closing pass, drops blobs under
    ``min_area_m2``, and vectorizes what remains — one polygon per
    connected blob, no dissolve, sorted by area descending.
    """
    _require_projected_crs(dataset)

    if aoi_geometry_wgs84 is not None:
        projected = transform_geom(_WGS84, dataset.crs, aoi_geometry_wgs84)
        data, transform = raster_mask(dataset, [projected], crop=True, filled=False)
    else:
        data = dataset.read(masked=True)
        transform = dataset.transform

    valid = ~np.ma.getmaskarray(data).any(axis=0)
    bands = np.ma.filled(data, 0)

    built = built_up_mask(bands, band_map, thresholds) & valid
    cleaned = _closing(_opening(built))

    found: list[tuple[float, dict[str, Any]]] = []
    for geom, value in raster_shapes(cleaned.astype("uint8"), mask=cleaned, transform=transform):
        if value != 1:
            continue
        polygon = shape(geom)
        area = polygon.area  # dataset CRS is projected (checked above) -> m2
        if area < thresholds.min_area_m2:
            continue
        found.append((area, transform_geom(dataset.crs, _WGS84, mapping(polygon))))

    found.sort(key=lambda pair: pair[0], reverse=True)
    return [geom for _area, geom in found]


def footprints_for_confirmation(
    dataset: rasterio.DatasetReader,
    parcel_geometry_wgs84: dict[str, Any],
    *,
    neighborhood_m: float = 50.0,
    band_map: BandMap = DEFAULT_BAND_MAP,
    thresholds: FootprintThresholds = DEFAULT_THRESHOLDS,
) -> list[dict[str, Any]]:
    """Footprints around a parcel, ready for ``confirm_change``'s footprint_geometries.

    The parcel is buffered by ``neighborhood_m`` (default 50m) before
    extraction so footprints straddling the parcel boundary — a
    building whose plinth sits partly outside the cadastral line, or a
    neighbor's structure the change might actually be explained by —
    are still picked up, not just what falls strictly inside the parcel.
    """
    neighborhood = mapping(buffer_m(shape(parcel_geometry_wgs84), neighborhood_m))
    return extract_footprints(dataset, neighborhood, band_map=band_map, thresholds=thresholds)
