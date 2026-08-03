"""Cadastral topology QA: invalid geometries, overlaps, coverage gaps.

Invalid geometries and overlaps quarantine the import batch (blocking);
gaps only warn — uncovered strips are often legitimate roads or rivers.
Linear layers (road centerlines, canals) get their own QA: empty or
self-intersecting lines block; exact duplicates warn.
"""

from dataclasses import dataclass, field

from shapely.geometry.base import BaseGeometry
from shapely.ops import unary_union
from shapely.strtree import STRtree
from shapely.validation import explain_validity

_BLOCKING_KINDS = frozenset({"invalid", "overlap", "self_intersection"})


@dataclass(frozen=True)
class TopologyIssue:
    kind: str  # "invalid" | "overlap" | "gap" | "self_intersection" | "duplicate"
    parcel_ids: tuple[str, ...]
    detail: str
    area: float | None = None


@dataclass
class TopologyReport:
    issues: list[TopologyIssue] = field(default_factory=list)

    @property
    def blocking(self) -> bool:
        return any(issue.kind in _BLOCKING_KINDS for issue in self.issues)


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
    parcels: dict[str, BaseGeometry], min_area: float = 1e-9
) -> list[TopologyIssue]:
    valid = _valid_only(parcels)
    parcel_ids = list(valid)
    geometries = [valid[pid] for pid in parcel_ids]
    tree = STRtree(geometries)
    issues = []
    for i, geometry in enumerate(geometries):
        for j in tree.query(geometry, predicate="intersects"):
            j = int(j)
            if j <= i:  # each pair once, skip self
                continue
            overlap_area = geometry.intersection(geometries[j]).area
            if overlap_area >= min_area:
                issues.append(
                    TopologyIssue(
                        "overlap",
                        (parcel_ids[i], parcel_ids[j]),
                        f"parcels overlap by {overlap_area:.6g}",
                        area=overlap_area,
                    )
                )
    return issues


def find_gaps(
    parcels: dict[str, BaseGeometry],
    boundary: BaseGeometry,
    min_area: float = 1e-9,
) -> list[TopologyIssue]:
    coverage = unary_union(list(_valid_only(parcels).values()))
    uncovered = boundary.difference(coverage)
    if uncovered.is_empty:
        return []
    parts = uncovered.geoms if hasattr(uncovered, "geoms") else [uncovered]
    return [
        TopologyIssue("gap", (), "uncovered area within boundary", area=part.area)
        for part in parts
        if part.area >= min_area
    ]


def run_qa(
    parcels: dict[str, BaseGeometry],
    boundary: BaseGeometry | None = None,
    min_overlap_area: float = 1e-9,
    min_gap_area: float = 1e-9,
) -> TopologyReport:
    issues = find_invalid(parcels)
    issues += find_overlaps(parcels, min_area=min_overlap_area)
    if boundary is not None:
        issues += find_gaps(parcels, boundary, min_area=min_gap_area)
    return TopologyReport(issues=issues)


def find_self_intersections(lines: dict[str, BaseGeometry]) -> list[TopologyIssue]:
    issues = []
    for feature_id, geometry in lines.items():
        if not geometry.is_empty and geometry.is_valid and not geometry.is_simple:
            issues.append(
                TopologyIssue(
                    "self_intersection", (feature_id,), "line crosses itself"
                )
            )
    return issues


def find_duplicates(lines: dict[str, BaseGeometry]) -> list[TopologyIssue]:
    seen: dict[bytes, str] = {}
    issues = []
    for feature_id, geometry in lines.items():
        if geometry.is_empty:
            continue
        key = geometry.wkb
        if key in seen:
            issues.append(
                TopologyIssue(
                    "duplicate",
                    (seen[key], feature_id),
                    "identical geometry appears twice",
                )
            )
        else:
            seen[key] = feature_id
    return issues


def run_linear_qa(lines: dict[str, BaseGeometry]) -> TopologyReport:
    """QA for centerline networks (roads, canals, drains)."""
    issues = find_invalid(lines)
    issues += find_self_intersections(lines)
    issues += find_duplicates(lines)
    return TopologyReport(issues=issues)
