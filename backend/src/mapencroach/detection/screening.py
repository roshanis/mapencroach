"""Parcel-clipped change screening on VNIR imagery.

Cartosat-3 MX carries four VNIR bands (Blue, Green, Red, NIR) and no
SWIR, so SWIR-based built-up indices (NDBI/BSI) are not computable from
this sensor. The screening signal is therefore the defensible VNIR
pair: a persistent NDVI *drop* (vegetation lost) coincident with a
brightness *rise* (bare earth / concrete / roofing reflect more than
canopy). This is a screening heuristic, deliberately explainable to an
officer and a court — "vegetation disappeared and the ground got
brighter" — not a black-box classifier. Every number that feeds an
alert is preserved in the result.
"""

from dataclasses import dataclass
from typing import Any

import numpy as np
import rasterio
from rasterio.features import shapes as raster_shapes
from rasterio.mask import mask as raster_mask
from rasterio.warp import transform_geom
from shapely.geometry import mapping, shape
from shapely.ops import unary_union

_WGS84 = "EPSG:4326"
_EPS = 1e-9


@dataclass(frozen=True)
class BandMap:
    """Zero-based band indices in the raster (default: Cartosat-3 MX order B,G,R,N)."""

    red: int = 2
    nir: int = 3


@dataclass(frozen=True)
class ScreeningThresholds:
    ndvi_drop: float = 0.15  # NDVI must fall by at least this much
    brightness_rise: float = 0.10  # relative brightness must rise by at least this much
    min_changed_area_m2: float = 50.0  # ignore sub-noise slivers


DEFAULT_BAND_MAP = BandMap()
DEFAULT_THRESHOLDS = ScreeningThresholds()


@dataclass(frozen=True)
class ParcelScreenResult:
    parcel_id: str
    changed_area_m2: float
    changed_pixels: int
    valid_pixels: int
    mean_ndvi_delta: float
    mean_brightness_delta: float
    change_geometry: dict[str, Any] | None  # GeoJSON (WGS84) of changed area

    @property
    def is_candidate(self) -> bool:
        return self.changed_pixels > 0

    def stats(self) -> dict[str, Any]:
        return {
            "changed_area_m2": round(self.changed_area_m2, 1),
            "changed_pixels": self.changed_pixels,
            "valid_pixels": self.valid_pixels,
            "mean_ndvi_delta": round(self.mean_ndvi_delta, 4),
            "mean_brightness_delta": round(self.mean_brightness_delta, 4),
        }


def ndvi(bands: np.ndarray, band_map: BandMap = DEFAULT_BAND_MAP) -> np.ndarray:
    red = bands[band_map.red].astype("float64")
    nir = bands[band_map.nir].astype("float64")
    return (nir - red) / (nir + red + _EPS)


def brightness(bands: np.ndarray) -> np.ndarray:
    return bands.astype("float64").mean(axis=0)


def change_mask(
    baseline: np.ndarray,
    current: np.ndarray,
    valid: np.ndarray,
    band_map: BandMap = DEFAULT_BAND_MAP,
    thresholds: ScreeningThresholds = DEFAULT_THRESHOLDS,
) -> np.ndarray:
    """Boolean mask of pixels where vegetation fell AND brightness rose."""
    ndvi_delta = ndvi(current, band_map) - ndvi(baseline, band_map)
    base_bright = brightness(baseline)
    relative_brightness_delta = (brightness(current) - base_bright) / (base_bright + _EPS)
    return (
        valid
        & (ndvi_delta <= -thresholds.ndvi_drop)
        & (relative_brightness_delta >= thresholds.brightness_rise)
    )


def _pixel_area_m2(dataset: rasterio.DatasetReader) -> float:
    if dataset.crs is None or dataset.crs.is_geographic:
        raise ValueError(
            "detection requires a projected CRS (meters); "
            f"got {dataset.crs} — reproject scenes before screening"
        )
    transform = dataset.transform
    return abs(transform.a * transform.e)


def _clip(dataset: rasterio.DatasetReader, geometry_wgs84: dict[str, Any]):
    projected = transform_geom(_WGS84, dataset.crs, geometry_wgs84)
    data, transform = raster_mask(dataset, [projected], crop=True, filled=False)
    return data, transform


def _changed_geometry_wgs84(
    mask: np.ndarray, transform, crs
) -> dict[str, Any] | None:
    geoms = [
        shape(geom)
        for geom, value in raster_shapes(
            mask.astype("uint8"), mask=mask, transform=transform
        )
        if value == 1
    ]
    if not geoms:
        return None
    dissolved = unary_union(geoms)
    return transform_geom(crs, _WGS84, mapping(dissolved))


def screen_parcel(
    baseline_ds: rasterio.DatasetReader,
    current_ds: rasterio.DatasetReader,
    parcel_id: str,
    parcel_geometry_wgs84: dict[str, Any],
    band_map: BandMap = DEFAULT_BAND_MAP,
    thresholds: ScreeningThresholds = DEFAULT_THRESHOLDS,
) -> ParcelScreenResult:
    """Screen one parcel for probable unauthorized change between two scenes."""
    pixel_area = _pixel_area_m2(current_ds)

    base_data, _ = _clip(baseline_ds, parcel_geometry_wgs84)
    cur_data, cur_transform = _clip(current_ds, parcel_geometry_wgs84)

    if base_data.shape != cur_data.shape:
        raise ValueError(
            f"baseline and current clips differ in shape for {parcel_id}: "
            f"{base_data.shape} vs {cur_data.shape} — scenes must share grid and extent"
        )

    valid = ~(np.ma.getmaskarray(base_data).any(axis=0)
              | np.ma.getmaskarray(cur_data).any(axis=0))
    baseline_bands = np.ma.filled(base_data, 0)
    current_bands = np.ma.filled(cur_data, 0)

    changed = change_mask(baseline_bands, current_bands, valid, band_map, thresholds)
    changed_pixels = int(changed.sum())
    changed_area = changed_pixels * pixel_area

    if changed_area < thresholds.min_changed_area_m2:
        changed = np.zeros_like(changed)
        changed_pixels = 0
        changed_area = 0.0

    ndvi_delta = ndvi(current_bands, band_map) - ndvi(baseline_bands, band_map)
    base_bright = brightness(baseline_bands)
    bright_delta = (brightness(current_bands) - base_bright) / (base_bright + _EPS)

    region = changed if changed_pixels else valid
    mean_ndvi_delta = float(ndvi_delta[region].mean()) if region.any() else 0.0
    mean_bright_delta = float(bright_delta[region].mean()) if region.any() else 0.0

    return ParcelScreenResult(
        parcel_id=parcel_id,
        changed_area_m2=changed_area,
        changed_pixels=changed_pixels,
        valid_pixels=int(valid.sum()),
        mean_ndvi_delta=mean_ndvi_delta,
        mean_brightness_delta=mean_bright_delta,
        change_geometry=(
            _changed_geometry_wgs84(changed, cur_transform, current_ds.crs)
            if changed_pixels
            else None
        ),
    )
