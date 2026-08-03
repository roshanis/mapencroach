"""Metric geometry helpers for WGS84 features.

Cadastral geometries live in EPSG:4326, but every enforcement question
is metric — areas in m², buffers in meters. These helpers project into
the local UTM zone (computed from the geometry itself, so Haridwar gets
44N without hardcoding it) for honest measurement.
"""

from pyproj import Transformer
from shapely.geometry.base import BaseGeometry
from shapely.ops import transform as shapely_transform


def local_utm_epsg(geometry: BaseGeometry) -> int:
    centroid = geometry.centroid
    zone = int((centroid.x + 180) // 6) + 1
    return (32600 if centroid.y >= 0 else 32700) + zone


def to_local_utm(geometry: BaseGeometry) -> BaseGeometry:
    transformer = Transformer.from_crs(4326, local_utm_epsg(geometry), always_xy=True)
    return shapely_transform(transformer.transform, geometry)


def area_m2(geometry: BaseGeometry) -> float:
    if geometry.is_empty:
        return 0.0
    return to_local_utm(geometry).area


def buffer_m(geometry: BaseGeometry, meters: float) -> BaseGeometry:
    """Buffer in meters, returned in WGS84."""
    epsg = local_utm_epsg(geometry)
    forward = Transformer.from_crs(4326, epsg, always_xy=True)
    backward = Transformer.from_crs(epsg, 4326, always_xy=True)
    buffered = shapely_transform(forward.transform, geometry).buffer(meters)
    return shapely_transform(backward.transform, buffered)


def distance_m(a: BaseGeometry, b: BaseGeometry) -> float:
    """Distance in meters, both geometries projected into `a`'s UTM zone."""
    forward = Transformer.from_crs(4326, local_utm_epsg(a), always_xy=True)
    return shapely_transform(forward.transform, a).distance(
        shapely_transform(forward.transform, b)
    )
