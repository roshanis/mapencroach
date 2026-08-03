"""Alert enrichment against authority GIS layers (requisition §3.2–3.3).

Given a detected change (or a parcel), answer the questions HRDA's
verification layers exist to answer: does this sit in a green belt?
against planned zoning? inside a road right-of-way? near a protected
water body? The output is a flags dict stored on the alert — context
for the officer's triage, never an automatic escalation: severity stays
the explainable formula, and a zoning flag is a *reason to look*, not a
verdict.
"""

from typing import Any

from shapely.geometry import shape
from shapely.geometry.base import BaseGeometry
from shapely.ops import unary_union

from mapencroach.detection.geo import area_m2, buffer_m, distance_m

# Attribute key conventions for imported layers. Imports should map
# their source columns onto these; enrichment degrades gracefully when
# they are absent.
LAND_USE_ATTRIBUTE = "land_use"
ROW_WIDTH_ATTRIBUTE = "row_width_m"

DEFAULT_ROW_WIDTH_M = 12.0  # conservative urban road RoW when unattributed
DEFAULT_WATER_PROXIMITY_M = 50.0


def _union(features: list[dict[str, Any]]) -> BaseGeometry | None:
    geoms = [shape(f["geometry"]) for f in features]
    return unary_union(geoms) if geoms else None


def _zoning_uses(geometry: BaseGeometry, features: list[dict[str, Any]]) -> list[str]:
    uses = {
        str(f["attributes"][LAND_USE_ATTRIBUTE])
        for f in features
        if LAND_USE_ATTRIBUTE in f.get("attributes", {})
        and shape(f["geometry"]).intersects(geometry)
    }
    return sorted(uses)


def enrich(
    geometry_geojson: dict[str, Any],
    layers: dict[str, list[dict[str, Any]]],
    *,
    water_proximity_m: float = DEFAULT_WATER_PROXIMITY_M,
    default_row_width_m: float = DEFAULT_ROW_WIDTH_M,
) -> dict[str, Any]:
    """Compute enrichment flags for a change/parcel geometry (GeoJSON WGS84).

    `layers` maps layer kind -> features (as returned by
    store.layer_features). Only the kinds present are evaluated, so a
    deployment without a digitized master plan simply gets no zoning
    flags — absence of data is never reported as absence of conflict.
    """
    geometry = shape(geometry_geojson)
    flags: dict[str, Any] = {}

    green_belt = _union(layers.get("green_belt", []))
    if green_belt is not None:
        overlap = geometry.intersection(green_belt)
        if not overlap.is_empty:
            flags["green_belt"] = {"intersects": True, "area_m2": round(area_m2(overlap), 1)}

    elu_uses = _zoning_uses(geometry, layers.get("elu", []))
    plu_uses = _zoning_uses(geometry, layers.get("plu", []))
    if elu_uses or plu_uses:
        zoning: dict[str, Any] = {}
        if elu_uses:
            zoning["existing_land_use"] = elu_uses
        if plu_uses:
            zoning["planned_land_use"] = plu_uses
        # The requisition's "commercial/residential mismatch": present use
        # differs from every planned use for the same ground.
        if elu_uses and plu_uses and not set(elu_uses) & set(plu_uses):
            zoning["mismatch"] = True
        flags["zoning"] = zoning

    roads = layers.get("road", [])
    if roads:
        corridors = []
        for road in roads:
            width = float(
                road.get("attributes", {}).get(ROW_WIDTH_ATTRIBUTE, default_row_width_m)
            )
            # RoW extends half-width to each side of the centerline.
            corridors.append(buffer_m(shape(road["geometry"]), width / 2))
        row_zone = unary_union(corridors)
        breach = geometry.intersection(row_zone)
        if not breach.is_empty and area_m2(breach) > 0:
            flags["right_of_way"] = {
                "breach": True,
                "area_m2": round(area_m2(breach), 1),
            }

    water = _union(layers.get("water_body", []))
    if water is not None:
        distance = distance_m(geometry, water)
        if distance <= water_proximity_m:
            flags["water_body"] = {
                "within_m": water_proximity_m,
                "distance_m": round(distance, 1),
            }

    return flags
