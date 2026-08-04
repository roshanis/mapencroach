import h3
import pytest

from mapencroach.hexgrid.grid import (
    ALERT_DEDUP_RES,
    PARCEL_INDEX_RES,
    CellBudgetExceeded,
    cell_parent,
    cells_geojson,
    compact,
    interior_cell,
    polygon_cells,
    rollup,
)

# ~110m square, the demo parcel shape, centred in Haridwar City
PARCEL = {
    "type": "Polygon",
    "coordinates": [
        [
            [78.1345, 29.9445],
            [78.1355, 29.9445],
            [78.1355, 29.9455],
            [78.1345, 29.9455],
            [78.1345, 29.9445],
        ]
    ],
}

# A few metres across: far smaller than one res-13 cell
TINY = {
    "type": "Polygon",
    "coordinates": [
        [
            [78.13500, 29.94500],
            [78.13502, 29.94500],
            [78.13502, 29.94502],
            [78.13500, 29.94502],
            [78.13500, 29.94500],
        ]
    ],
}


class TestPolygonCells:
    def test_demo_parcel_gets_many_res13_cells(self):
        cells = polygon_cells(PARCEL, PARCEL_INDEX_RES)
        assert 150 < len(cells) < 400  # ~12,100 m2 / ~44 m2 per cell
        assert all(h3.get_resolution(c) == PARCEL_INDEX_RES for c in cells)

    def test_deterministic(self):
        assert polygon_cells(PARCEL) == polygon_cells(PARCEL)

    def test_sub_cell_geometry_still_indexes_to_one_cell(self):
        cells = polygon_cells(TINY, 11)
        assert cells == {interior_cell(TINY, 11)}

    def test_interior_point_cell_always_included(self):
        cells = polygon_cells(PARCEL, PARCEL_INDEX_RES)
        assert interior_cell(PARCEL, PARCEL_INDEX_RES) in cells

    def test_multipolygon_supported(self):
        multi = {"type": "MultiPolygon", "coordinates": [PARCEL["coordinates"]]}
        assert polygon_cells(multi, 12) == polygon_cells(PARCEL, 12)

    def test_cell_budget_enforced(self):
        with pytest.raises(CellBudgetExceeded):
            polygon_cells(PARCEL, 15)  # ~13k sub-metre cells

    def test_point_geometry_rejected(self):
        with pytest.raises(ValueError):
            polygon_cells({"type": "Point", "coordinates": [78.0, 29.9]}, 12)

    def test_empty_geometry_rejected(self):
        with pytest.raises(ValueError):
            polygon_cells({"type": "Polygon", "coordinates": []}, 12)


class TestInteriorCell:
    def test_resolution_and_containment(self):
        cell = interior_cell(PARCEL, ALERT_DEDUP_RES)
        assert h3.get_resolution(cell) == ALERT_DEDUP_RES
        lat, lng = h3.cell_to_latlng(cell)
        assert 29.94 < lat < 29.95
        assert 78.13 < lng < 78.14

    def test_same_parcel_same_dedup_key(self):
        assert interior_cell(PARCEL) == interior_cell(PARCEL)


class TestHierarchy:
    def test_cell_parent_coarsens(self):
        cell = interior_cell(PARCEL, 12)
        parent = cell_parent(cell, 9)
        assert h3.get_resolution(parent) == 9

    def test_cell_parent_same_res_is_identity(self):
        cell = interior_cell(PARCEL, 12)
        assert cell_parent(cell, 12) == cell

    def test_cell_parent_refuses_finer_target(self):
        with pytest.raises(ValueError):
            cell_parent(interior_cell(PARCEL, 9), 12)

    def test_rollup_counts_by_parent(self):
        cells = sorted(polygon_cells(PARCEL, 13))
        counts = rollup(cells, 9)
        assert sum(counts.values()) == len(cells)
        # a 110m parcel sits within one or two res-9 (~350m) cells
        assert 1 <= len(counts) <= 2

    def test_compact_shrinks_cover(self):
        cells = polygon_cells(PARCEL, 13)
        compacted = compact(cells)
        assert 0 < len(compacted) < len(cells)


class TestCellsGeojson:
    def test_features_are_closed_lonlat_hexagon_rings(self):
        cell = interior_cell(PARCEL, 9)
        fc = cells_geojson([cell])
        [feature] = fc["features"]
        assert feature["properties"]["cell"] == cell
        [ring] = feature["geometry"]["coordinates"]
        assert ring[0] == ring[-1]
        assert len(ring) == 7  # hexagon + closing point
        for lng, lat in ring:
            assert 77 < lng < 79  # lon/lat order, not lat/lon
            assert 29 < lat < 31

    def test_mapping_input_carries_properties(self):
        cell = interior_cell(PARCEL, 9)
        fc = cells_geojson({cell: {"count": 3, "max_severity": 0.7}})
        [feature] = fc["features"]
        assert feature["properties"] == {"cell": cell, "count": 3, "max_severity": 0.7}
