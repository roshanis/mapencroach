"""H3 hexagonal indexing over parcels and alerts.

H3 is an analytical/index layer only, never a legal boundary: the exact
parcel geometry (Shapely/PostGIS) stays the sole authority for "is this
change inside parcel X", and every H3-derived view says so in the
console. Within that limit it earns its keep three ways, at resolutions
matched to Indian parcel sizes (holdings here are commonly a few hundred
to a few thousand m²):

- res 13 (~44 m² cells): parcel cell sets, fine enough that even a small
  urban plot gets several cells — a fast pre-filter index for "which
  parcels could this detection touch".
- res 12 (~307 m², ~20 m across): alert dedup keys. Two change hits in
  the same res-12 cell are almost certainly the same encroachment, and
  ~20 m is a couple of Sentinel-2 pixels.
- coarser parents (res 9 village, res 7 taluk/district): dashboard
  rollups via cell_to_parent — compute fine once, aggregate upward free.

`polygon_to_cells` uses center-containment, so a parcel smaller than one
cell can yield zero cells; every cover falls back to the cell containing
a guaranteed-interior point (the same fallback the web console's
h3-grid.ts uses).
"""

from collections import Counter
from collections.abc import Iterable
from typing import Any

import h3
from shapely.geometry import shape

PARCEL_INDEX_RES = 13
ALERT_DEDUP_RES = 12

# A response-size guard, not a correctness limit: callers asking for a
# finer resolution than a geometry can sensibly carry get a clear error
# instead of a many-megabyte cell list. The web console caps its grid at
# 4000 cells for the same reason.
MAX_CELLS = 5000


class CellBudgetExceeded(Exception):
    """Raised when a cover would exceed MAX_CELLS at the requested resolution."""


def _ring_latlng(ring: list[list[float]]) -> list[tuple[float, float]]:
    # GeoJSON is (lon, lat); h3 shapes take (lat, lng).
    return [(pt[1], pt[0]) for pt in ring]


def _to_h3shape(geometry: dict[str, Any]) -> h3.LatLngPoly | h3.LatLngMultiPoly:
    kind = geometry.get("type")
    coordinates = geometry.get("coordinates")
    if not coordinates:
        raise ValueError("geometry has no coordinates")
    if kind == "Polygon":
        outer, *holes = coordinates
        return h3.LatLngPoly(_ring_latlng(outer), *[_ring_latlng(h) for h in holes])
    if kind == "MultiPolygon":
        polys = [
            h3.LatLngPoly(_ring_latlng(outer), *[_ring_latlng(h) for h in holes])
            for outer, *holes in coordinates
        ]
        return h3.LatLngMultiPoly(*polys)
    raise ValueError(f"unsupported geometry type for H3 cover: {kind!r}")


def interior_cell(geometry: dict[str, Any], res: int = ALERT_DEDUP_RES) -> str:
    """The cell containing a guaranteed-interior point of the geometry.

    Uses Shapely's representative_point rather than the centroid: the
    centroid of a concave parcel (a canal bend, an L-shaped plot) can lie
    outside it, which would key the parcel to a neighbour's cell.
    """
    point = shape(geometry).representative_point()
    return h3.latlng_to_cell(point.y, point.x, res)


def polygon_cells(geometry: dict[str, Any], res: int = PARCEL_INDEX_RES) -> set[str]:
    """All cells covering the geometry at `res`, never empty.

    Center-containment can miss a sub-cell-sized geometry entirely; the
    interior-point cell is always included so every parcel indexes to at
    least one cell.
    """
    cells = set(h3.h3shape_to_cells(_to_h3shape(geometry), res))
    if len(cells) > MAX_CELLS:
        raise CellBudgetExceeded(
            f"{len(cells)} cells at res {res} exceeds the {MAX_CELLS}-cell budget; "
            "use a coarser resolution"
        )
    cells.add(interior_cell(geometry, res))
    return cells


def compact(cells: Iterable[str]) -> list[str]:
    """Mixed-resolution minimal covering of `cells` (h3.compact_cells)."""
    return list(h3.compact_cells(list(cells)))


def cell_parent(cell: str, res: int) -> str:
    """The cell's ancestor at coarser (or equal) resolution `res`."""
    if h3.get_resolution(cell) < res:
        raise ValueError(f"cannot roll {cell} up to finer resolution {res}")
    return h3.cell_to_parent(cell, res)


def rollup(cells: Iterable[str], res: int) -> dict[str, int]:
    """Count cells by their parent at coarser resolution `res`."""
    counts: Counter[str] = Counter()
    for cell in cells:
        counts[cell_parent(cell, res)] += 1
    return dict(counts)


def cells_geojson(cells: dict[str, dict[str, Any]] | Iterable[str]) -> dict[str, Any]:
    """GeoJSON FeatureCollection of cell boundaries for map display.

    `cells` is either a plain iterable of cell ids or a mapping of cell
    id -> extra feature properties (counts, severities).
    """
    properties: dict[str, dict[str, Any]]
    if isinstance(cells, dict):
        properties = cells
    else:
        properties = {cell: {} for cell in cells}

    features = []
    for cell, props in sorted(properties.items()):
        boundary = h3.cell_to_boundary(cell)
        ring = [[lng, lat] for lat, lng in boundary]
        ring.append(ring[0])
        features.append(
            {
                "type": "Feature",
                "geometry": {"type": "Polygon", "coordinates": [ring]},
                "properties": {"cell": cell, **props},
            }
        )
    return {"type": "FeatureCollection", "features": features}
