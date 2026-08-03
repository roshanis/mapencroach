"""GIS layer ingestion (requisition §3): the verification layers around parcels.

Same contract as parcel ingestion — schema errors reject, topology
problems quarantine, clean data is accepted — but generalized over the
layer taxonomy: zone/plan layers are polygonal and run the polygon QA,
network layers (roads, canals) are linear and run the linear QA. A road
centerline file full of polygons (or vice versa) is a schema error, not
a topology warning.
"""

from dataclasses import dataclass
from pathlib import Path
from typing import Any

import geopandas as gpd
from shapely.geometry import LineString, MultiLineString, MultiPolygon, Polygon
from shapely.geometry import mapping as geo_mapping
from shapely.geometry.base import BaseGeometry

from mapencroach.cadastral.topology import TopologyReport, run_linear_qa, run_qa

_WGS84 = "EPSG:4326"

POLYGON_KINDS = frozenset(
    {
        "khasra",
        "plot_boundary",
        "property",
        "master_plan",
        "elu",
        "plu",
        "green_belt",
        "ward",
        "building_footprint",
        "approved_plan",
        "legacy_encroachment",
    }
)
LINE_KINDS = frozenset({"road", "water_body"})
LAYER_KINDS = POLYGON_KINDS | LINE_KINDS

_POLYGON_TYPES = (Polygon, MultiPolygon)
_LINE_TYPES = (LineString, MultiLineString)


@dataclass(frozen=True)
class LayerFeature:
    source_feature_id: str
    geometry: dict[str, Any]  # GeoJSON, WGS84
    attributes: dict[str, Any]


@dataclass
class LayerIngestionResult:
    status: str  # "accepted" | "quarantined" | "rejected"
    kind: str
    features: list[LayerFeature]
    report: TopologyReport | None
    errors: list[str]


def _rejected(kind: str, errors: list[str]) -> LayerIngestionResult:
    return LayerIngestionResult(
        status="rejected", kind=kind, features=[], report=None, errors=errors
    )


def load_layer(
    path: str | Path,
    *,
    kind: str,
    id_column: str,
) -> LayerIngestionResult:
    if kind not in LAYER_KINDS:
        return _rejected(kind, [f"unknown layer kind {kind!r}"])

    path = Path(path)
    if not path.exists():
        return _rejected(kind, [f"file not found: {path}"])

    try:
        gdf = gpd.read_file(path)
    except Exception as exc:  # noqa: BLE001
        return _rejected(kind, [f"unable to read file {path}: {exc}"])

    errors: list[str] = []
    if id_column not in gdf.columns:
        return _rejected(kind, [f"id column '{id_column}' not present in file columns"])
    if gdf[id_column].isna().any():
        errors.append(f"id column '{id_column}' contains null/missing values")
    duplicated = gdf[id_column][gdf[id_column].duplicated() & gdf[id_column].notna()]
    if not duplicated.empty:
        dupes = sorted({str(v) for v in duplicated.unique()})
        errors.append(f"id column '{id_column}' contains duplicate ids: {', '.join(dupes)}")
    if gdf.crs is None:
        errors.append("layer has no CRS set")

    expected_types = _POLYGON_TYPES if kind in POLYGON_KINDS else _LINE_TYPES
    family = "polygonal" if kind in POLYGON_KINDS else "linear"
    wrong_type = []
    for idx, geometry in zip(gdf.index, gdf.geometry, strict=True):
        if geometry is None or not isinstance(geometry, expected_types):
            raw_id = gdf.loc[idx, id_column]
            label = "unknown" if raw_id is None or raw_id != raw_id else str(raw_id)
            geom_type = "missing" if geometry is None else geometry.geom_type
            wrong_type.append((label, geom_type))
    if wrong_type:
        detail = ", ".join(f"id={label} ({geom_type})" for label, geom_type in wrong_type)
        errors.append(f"layer kind '{kind}' requires {family} geometry; found: {detail}")

    if errors:
        return _rejected(kind, errors)

    if gdf.crs.to_epsg() != 4326:
        gdf = gdf.to_crs(_WGS84)

    geometries: dict[str, BaseGeometry] = {}
    features: list[LayerFeature] = []
    for _idx, row in gdf.iterrows():
        feature_id = str(row[id_column])
        geometries[feature_id] = row.geometry
        features.append(
            LayerFeature(
                source_feature_id=feature_id,
                geometry=geo_mapping(row.geometry),
                attributes={
                    column: value
                    for column, value in row.items()
                    if column not in (id_column, "geometry")
                },
            )
        )

    report = (
        run_qa(geometries) if kind in POLYGON_KINDS else run_linear_qa(geometries)
    )
    if report.blocking:
        return LayerIngestionResult(
            status="quarantined", kind=kind, features=[], report=report, errors=[]
        )
    return LayerIngestionResult(
        status="accepted", kind=kind, features=features, report=report, errors=[]
    )
