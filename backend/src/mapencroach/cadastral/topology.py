"""Cadastral topology QA: invalid geometries, overlaps, coverage gaps.

Invalid geometries and overlaps quarantine the import batch (blocking);
gaps only warn -- uncovered strips are often legitimate roads or rivers.

Every geometry passed in here -- parcels and, when given, `boundary` --
is assumed to be EPSG:4326 (longitude, latitude in degrees). That is what
`cadastral.ingestion.load_parcels` normalizes parcel geometries to before
calling into this module. Areas are computed geodesically (via
`pyproj.Geod` on the WGS84 ellipsoid) rather than by taking the planar
`.area` of degree coordinates, so `min_area` thresholds and reported
issue areas are real square metres, consistent everywhere regardless of
latitude, and consistent with the m^2-based severity model in
`domain.alerts`. Geometries whose bounds fall outside plausible lon/lat
range are rejected with a clear error instead of silently producing a
meaningless area.
"""

from dataclasses import dataclass, field

from pyproj import Geod
from shapely.geometry.base import BaseGeometry
from shapely.ops import unary_union
from shapely.strtree import STRtree
from shapely.validation import explain_validity

_WGS84_GEOD = Geod(ellps="WGS84")

# A degree of longitude/latitude is on the order of tens to a hundred
# kilometres; coordinates outside these bounds cannot be EPSG:4326, and
# treating them as such would make the geodesic area below meaningless.
_LON_RANGE = (-180.0, 180.0)
_LAT_RANGE = (-90.0, 90.0)

# Default QA thresholds, in square metres. Previously these were 1e-9
# expressed in square *degrees*, which is roughly 11-12 m^2 of real land
# near the equator (and a different, latitude-dependent figure elsewhere)
# -- so genuine overlaps/gaps up to roughly that size passed QA silently.
# 1.0 m^2 is a tight, latitude-independent default; callers with looser
# digitization tolerances should pass an explicit, documented value.
_DEFAULT_MIN_AREA_M2 = 1.0


@dataclass(frozen=True)
class TopologyIssue:
    kind: str  # "invalid" | "overlap" | "gap"
    parcel_ids: tuple[str, ...]
    detail: str
    area: float | None = None  # square metres (geodesic, WGS84); see module docstring


@dataclass
class TopologyReport:
    issues: list[TopologyIssue] = field(default_factory=list)

    @property
    def blocking(self) -> bool:
        return any(issue.kind in ("invalid", "overlap") for issue in self.issues)


def assert_wgs84_bounds(geometry: BaseGeometry, *, label: str = "geometry") -> None:
    """Raise ValueError if `geometry`'s bounds fall outside EPSG:4326 lon/lat range.

    This is a plausibility check, not a CRS-correctness proof -- a
    geometry can have small coordinates and still not actually be
    EPSG:4326 -- but it catches the common, high-damage mistake of
    handing this module (or `cadastral.ingestion.load_parcels`'s
    `boundary` parameter) geometry in a projected CRS (UTM metres, etc.),
    which would otherwise silently produce areas off by many orders of
    magnitude.
    """
    if geometry.is_empty:
        return
    minx, miny, maxx, maxy = geometry.bounds
    lon_lo, lon_hi = _LON_RANGE
    lat_lo, lat_hi = _LAT_RANGE
    if not (lon_lo <= minx <= lon_hi and lon_lo <= maxx <= lon_hi):
        raise ValueError(
            f"{label} bounds {geometry.bounds} fall outside EPSG:4326 longitude range "
            f"{_LON_RANGE}; topology QA assumes geometries are already in EPSG:4326"
        )
    if not (lat_lo <= miny <= lat_hi and lat_lo <= maxy <= lat_hi):
        raise ValueError(
            f"{label} bounds {geometry.bounds} fall outside EPSG:4326 latitude range "
            f"{_LAT_RANGE}; topology QA assumes geometries are already in EPSG:4326"
        )


def _geodesic_area_m2(geometry: BaseGeometry) -> float:
    """Unsigned geodesic area of an EPSG:4326 geometry, in square metres."""
    if geometry.is_empty:
        return 0.0
    area, _perimeter = _WGS84_GEOD.geometry_area_perimeter(geometry)
    return abs(area)


def find_invalid(parcels: dict[str, BaseGeometry]) -> list[TopologyIssue]:
    issues = []
    for parcel_id, geometry in parcels.items():
        if geometry.is_empty:
            issues.append(TopologyIssue("invalid", (parcel_id,), "empty geometry"))
        elif not geometry.is_valid:
            issues.append(TopologyIssue("invalid", (parcel_id,), explain_validity(geometry)))
    return issues


def _valid_only(parcels: dict[str, BaseGeometry]) -> dict[str, BaseGeometry]:
    return {pid: g for pid, g in parcels.items() if not g.is_empty and g.is_valid}


def find_overlaps(
    parcels: dict[str, BaseGeometry], min_area: float = _DEFAULT_MIN_AREA_M2
) -> list[TopologyIssue]:
    """Flag parcel pairs whose geometries overlap by at least `min_area` m^2.

    `min_area` and the reported issue `area` are square metres, computed
    geodesically; see the module docstring for the EPSG:4326 assumption.
    """
    valid = _valid_only(parcels)
    for geometry in valid.values():
        assert_wgs84_bounds(geometry, label="parcel")
    parcel_ids = list(valid)
    geometries = [valid[pid] for pid in parcel_ids]
    tree = STRtree(geometries)
    issues = []
    for i, geometry in enumerate(geometries):
        for j in tree.query(geometry, predicate="intersects"):
            j = int(j)
            if j <= i:  # each pair once, skip self
                continue
            overlap_geom = geometry.intersection(geometries[j])
            if overlap_geom.is_empty:
                continue
            overlap_area = _geodesic_area_m2(overlap_geom)
            if overlap_area >= min_area:
                issues.append(
                    TopologyIssue(
                        "overlap",
                        (parcel_ids[i], parcel_ids[j]),
                        f"parcels overlap by {overlap_area:.3g} m^2",
                        area=overlap_area,
                    )
                )
    return issues


def find_gaps(
    parcels: dict[str, BaseGeometry],
    boundary: BaseGeometry,
    min_area: float = _DEFAULT_MIN_AREA_M2,
) -> list[TopologyIssue]:
    """Flag boundary-interior areas not covered by any parcel, at least `min_area` m^2 each.

    `boundary` and `parcels` are assumed to be EPSG:4326; see the module
    docstring. `min_area` and the reported issue `area` are square metres,
    computed geodesically.
    """
    assert_wgs84_bounds(boundary, label="boundary")
    valid = _valid_only(parcels)
    for geometry in valid.values():
        assert_wgs84_bounds(geometry, label="parcel")
    coverage = unary_union(list(valid.values()))
    uncovered = boundary.difference(coverage)
    if uncovered.is_empty:
        return []
    parts = uncovered.geoms if hasattr(uncovered, "geoms") else [uncovered]
    issues = []
    for part in parts:
        area = _geodesic_area_m2(part)
        if area >= min_area:
            issues.append(TopologyIssue("gap", (), "uncovered area within boundary", area=area))
    return issues


def run_qa(
    parcels: dict[str, BaseGeometry],
    boundary: BaseGeometry | None = None,
    min_overlap_area: float = _DEFAULT_MIN_AREA_M2,
    min_gap_area: float = _DEFAULT_MIN_AREA_M2,
) -> TopologyReport:
    """Run full topology QA. `min_overlap_area`/`min_gap_area` are square
    metres; see the module docstring for the EPSG:4326 assumption.
    """
    issues = find_invalid(parcels)
    issues += find_overlaps(parcels, min_area=min_overlap_area)
    if boundary is not None:
        issues += find_gaps(parcels, boundary, min_area=min_gap_area)
    return TopologyReport(issues=issues)
