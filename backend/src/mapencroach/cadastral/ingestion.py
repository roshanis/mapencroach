"""Cadastral file ingestion: schema validation and topology QA for parcel layers.

Any format geopandas can read is accepted, including layers whose CRS has
no mapped EPSG code (custom ellipsoids, PROJ4-only definitions, etc.) --
reprojection is decided by comparing the CRS itself, not by round-tripping
through an EPSG code that may not exist. Schema errors (missing file,
missing/duplicate/null ids, absent CRS, non-polygonal geometry) reject the
batch outright and topology QA never runs. Once schema-valid, geometries are
reprojected to EPSG:4326 and normalized to MultiPolygon before topology QA
decides between accepted and quarantined.
"""

from dataclasses import dataclass
from pathlib import Path
from typing import Any

import geopandas as gpd
from pyproj import CRS
from shapely.geometry import MultiPolygon, Polygon
from shapely.geometry.base import BaseGeometry

from mapencroach.cadastral.topology import TopologyReport, assert_wgs84_bounds, run_qa

_WGS84 = "EPSG:4326"
_WGS84_CRS = CRS.from_epsg(4326)


@dataclass(frozen=True)
class ParcelRecord:
    parcel_id: str
    geometry: MultiPolygon
    attributes: dict[str, Any]


@dataclass
class IngestionResult:
    status: str
    parcels: list[ParcelRecord]
    report: TopologyReport | None
    errors: list[str]


def _rejected(errors: list[str]) -> IngestionResult:
    return IngestionResult(status="rejected", parcels=[], report=None, errors=errors)


def _to_multipolygon(geometry: BaseGeometry) -> MultiPolygon:
    if isinstance(geometry, MultiPolygon):
        return geometry
    return MultiPolygon([geometry])


def load_parcels(
    path: str | Path,
    id_column: str,
    boundary: BaseGeometry | None = None,
    min_overlap_area: float = 1.0,
    min_gap_area: float = 1.0,
) -> IngestionResult:
    """Load, schema-validate, and topology-QA a parcel layer.

    `boundary`, if given, must already be in EPSG:4326 (longitude,
    latitude in degrees). Unlike the parcel layer read from `path`, it is
    supplied directly by the caller rather than read from a file with its
    own CRS, so it cannot be reprojected automatically -- it is validated
    against plausible lon/lat bounds instead, and the batch is rejected
    (not silently mis-measured) if it looks like it's in a different CRS.

    `min_overlap_area` and `min_gap_area` are square metres (see
    `cadastral.topology` for how area is computed).
    """
    path = Path(path)
    if not path.exists():
        return _rejected([f"file not found: {path}"])

    try:
        gdf = gpd.read_file(path)
    except Exception as exc:  # noqa: BLE001
        return _rejected([f"unable to read file {path}: {exc}"])

    errors: list[str] = []

    if id_column not in gdf.columns:
        return _rejected([f"id column '{id_column}' not present in file columns"])

    if gdf[id_column].isna().any():
        errors.append(f"id column '{id_column}' contains null/missing values")

    duplicated = gdf[id_column][gdf[id_column].duplicated() & gdf[id_column].notna()]
    if not duplicated.empty:
        dupes = sorted({str(v) for v in duplicated.unique()})
        errors.append(f"id column '{id_column}' contains duplicate ids: {', '.join(dupes)}")

    if gdf.crs is None:
        errors.append("layer has no CRS set")

    invalid_geom_ids = []
    for idx, geometry in zip(gdf.index, gdf.geometry, strict=True):
        if geometry is None or not isinstance(geometry, (Polygon, MultiPolygon)):
            raw_id = gdf.loc[idx, id_column]
            label = "unknown" if raw_id is None or raw_id != raw_id else str(raw_id)
            geom_type = "missing" if geometry is None else geometry.geom_type
            invalid_geom_ids.append((label, geom_type))
    if invalid_geom_ids:
        detail = ", ".join(f"id={label} ({geom_type})" for label, geom_type in invalid_geom_ids)
        errors.append(f"non-polygonal geometry found for: {detail}")

    if errors:
        return _rejected(errors)

    if boundary is not None:
        try:
            assert_wgs84_bounds(boundary, label="boundary")
        except ValueError as exc:
            return _rejected([str(exc)])

    # Compare CRS objects directly rather than gdf.crs.to_epsg() == 4326:
    # some valid CRS definitions (custom ellipsoids, PROJ4-only strings)
    # have no EPSG mapping, so to_epsg() can return None for a CRS that
    # either is or isn't WGS84 -- .equals() answers that without needing
    # an EPSG code to exist at all.
    if not CRS(gdf.crs).equals(_WGS84_CRS):
        gdf = gdf.to_crs(_WGS84)

    parcels: dict[str, BaseGeometry] = {}
    records: list[ParcelRecord] = []
    for _idx, row in gdf.iterrows():
        parcel_id = str(row[id_column])
        geometry = _to_multipolygon(row.geometry)
        attributes = {
            column: value
            for column, value in row.items()
            if column not in (id_column, "geometry")
        }
        parcels[parcel_id] = geometry
        records.append(ParcelRecord(parcel_id=parcel_id, geometry=geometry, attributes=attributes))

    report = run_qa(
        parcels,
        boundary=boundary,
        min_overlap_area=min_overlap_area,
        min_gap_area=min_gap_area,
    )

    if report.blocking:
        return IngestionResult(status="quarantined", parcels=[], report=report, errors=[])

    return IngestionResult(status="accepted", parcels=records, report=report, errors=[])
