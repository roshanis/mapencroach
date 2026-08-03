"""H3 hexagonal grid helpers for aggregation and portable spatial indexing.

Why H3 here: hotspot aggregation and coverage rollups need a spatial
bucket that is stable across map zooms, comparable across districts,
and computable identically on SQLite and PostGIS (no spatial index
required — a cell id is just a string). Uber's H3 gives exactly that,
with a resolution ladder (res 8 ≈ 0.74 km² for district dashboards,
res 10 ≈ 0.015 km² for parcel-scale work).

Correctness trap encoded here: h3's polygon fill only returns cells
whose *centroid* falls inside the polygon, so a small parcel (the demo
parcels are ~110 m squares) yields ZERO cells at coarse resolutions.
Every fill therefore unions in the cell containing the geometry's
representative point — a geometry always maps to at least one cell.
"""

from typing import Any

import h3
from shapely.geometry import shape


def cell_for_geometry(geometry: dict[str, Any], resolution: int) -> str:
    """The single H3 cell for a geometry's representative point."""
    point = shape(geometry).representative_point()
    return h3.latlng_to_cell(point.y, point.x, resolution)


def cells_for_geometry(geometry: dict[str, Any], resolution: int) -> frozenset[str]:
    """All H3 cells covering a polygonal geometry (never empty).

    Union of h3's centroid-based polygon fill and the representative
    point's cell, so sub-cell-sized geometries still index.
    """
    geom_type = geometry.get("type")
    filled: set[str] = set()
    if geom_type in ("Polygon", "MultiPolygon"):
        filled = set(h3.geo_to_cells(geometry, resolution))
    filled.add(cell_for_geometry(geometry, resolution))
    return frozenset(filled)


def cell_boundary_geojson(cell: str) -> dict[str, Any]:
    """The hexagon outline as a closed GeoJSON polygon (lng/lat order)."""
    ring = [[lng, lat] for lat, lng in h3.cell_to_boundary(cell)]
    ring.append(ring[0])
    return {"type": "Polygon", "coordinates": [ring]}


def neighbors(cell: str, k: int = 1) -> frozenset[str]:
    """The cell plus its k-ring neighborhood (for smoothing / adjacency)."""
    return frozenset(h3.grid_disk(cell, k))
