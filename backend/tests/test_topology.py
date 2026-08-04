import pytest
from shapely.geometry import Polygon, box

from mapencroach.cadastral.topology import (
    assert_wgs84_bounds,
    find_gaps,
    find_invalid,
    find_overlaps,
    run_qa,
)

# Realistic EPSG:4326 coordinates near Haridwar, India, rather than toy
# planar geometries at the origin -- topology QA computes areas
# geodesically, so tests need plausible lon/lat values for area
# assertions (thresholds, reported areas) to mean anything in m^2.
_LON0, _LAT0 = 78.1642, 29.9457
_M_PER_DEG_LAT = 110_852.0  # approx at this latitude
_M_PER_DEG_LON = 96_486.0  # approx: 111_320 * cos(29.9457 deg)


def _deg_lon(metres: float) -> float:
    return metres / _M_PER_DEG_LON


def _deg_lat(metres: float) -> float:
    return metres / _M_PER_DEG_LAT


_DLON = _deg_lon(100.0)  # ~100m in degrees longitude at this latitude
_DLAT = _deg_lat(100.0)  # ~100m in degrees latitude

PARCEL_A = box(_LON0, _LAT0, _LON0 + _DLON, _LAT0 + _DLAT)  # ~100m x 100m
PARCEL_B = box(_LON0 + _DLON, _LAT0, _LON0 + 2 * _DLON, _LAT0 + _DLAT)  # shares edge, no overlap
PARCEL_OVERLAP = box(
    _LON0 + _DLON / 2, _LAT0, _LON0 + 1.5 * _DLON, _LAT0 + _DLAT
)  # overlaps A by ~half
BOWTIE = Polygon(
    [
        (_LON0, _LAT0),
        (_LON0 + _DLON, _LAT0 + _DLAT),
        (_LON0 + _DLON, _LAT0),
        (_LON0, _LAT0 + _DLAT),
    ]
)  # self-intersecting -> invalid

# Coordinates that look like UTM easting/northing (metres), not lon/lat --
# used to prove projected-CRS input is rejected instead of silently
# producing a meaningless area.
_UTM_LIKE = box(500_000, 2_600_000, 500_100, 2_600_100)


class TestAssertWgs84Bounds:
    def test_plausible_lon_lat_geometry_passes(self):
        assert_wgs84_bounds(PARCEL_A, label="parcel")

    def test_utm_like_coordinates_are_rejected(self):
        with pytest.raises(ValueError, match="4326"):
            assert_wgs84_bounds(_UTM_LIKE, label="parcel")

    def test_empty_geometry_is_not_rejected(self):
        assert_wgs84_bounds(Polygon(), label="parcel")

    def test_valid_longitude_with_out_of_range_latitude_is_rejected(self):
        # Longitude alone can't distinguish a genuine lon/lat geometry from
        # a projected one whose easting happens to fall in [-180, 180];
        # northing values (like UTM metres) are usually what gives it away.
        bad_latitude = box(50.0, 2_600_000, 60.0, 2_600_100)
        with pytest.raises(ValueError, match="4326"):
            assert_wgs84_bounds(bad_latitude, label="parcel")


class TestFindInvalid:
    def test_valid_parcels_produce_no_issues(self):
        assert find_invalid({"p1": PARCEL_A, "p2": PARCEL_B}) == []

    def test_self_intersecting_polygon_is_flagged_with_reason(self):
        issues = find_invalid({"bad": BOWTIE})
        assert len(issues) == 1
        assert issues[0].parcel_ids == ("bad",)
        assert "self-intersection" in issues[0].detail.lower()

    def test_empty_geometry_is_flagged(self):
        issues = find_invalid({"empty": Polygon()})
        assert len(issues) == 1


class TestFindOverlaps:
    def test_disjoint_and_touching_parcels_do_not_overlap(self):
        assert find_overlaps({"a": PARCEL_A, "b": PARCEL_B}) == []

    def test_overlap_is_reported_once_with_area_in_square_metres(self):
        issues = find_overlaps({"a": PARCEL_A, "b": PARCEL_OVERLAP})
        assert len(issues) == 1
        assert set(issues[0].parcel_ids) == {"a", "b"}
        # ~50m x 100m of real overlap -- roughly 5000 m^2, not 0.5 (what
        # planar .area on degree coordinates would have reported).
        assert 4500 <= issues[0].area <= 5500
        assert "m^2" in issues[0].detail

    def test_genuine_overlap_below_the_old_degree_based_threshold_is_caught(self):
        # A ~3m x 3m sliver (~9 m^2) would have passed silently under the
        # old 1e-9-square-degree default (~11-12 m^2 of real land); the
        # m^2-based default (1.0 m^2) still flags it.
        sliver = box(
            _LON0 + _DLON,
            _LAT0,
            _LON0 + _DLON + _deg_lon(3.0),
            _LAT0 + _deg_lat(3.0),
        )
        issues = find_overlaps({"a": PARCEL_B, "b": sliver})
        assert len(issues) == 1
        assert 1.0 <= issues[0].area <= 20.0

    def test_sliver_overlaps_below_threshold_are_ignored(self):
        tiny = box(
            _LON0 + _DLON,
            _LAT0,
            _LON0 + _DLON + _deg_lon(0.05),
            _LAT0 + _deg_lat(0.05),
        )
        assert find_overlaps({"a": PARCEL_B, "b": tiny}, min_area=1.0) == []

    def test_three_way_overlaps_report_each_pair(self):
        c = box(_LON0 + 0.6 * _DLON, _LAT0, _LON0 + 1.6 * _DLON, _LAT0 + _DLAT)
        issues = find_overlaps({"a": PARCEL_A, "b": PARCEL_OVERLAP, "c": c})
        pairs = {tuple(sorted(i.parcel_ids)) for i in issues}
        assert pairs == {("a", "b"), ("a", "c"), ("b", "c")}

    def test_utm_like_parcel_coordinates_are_rejected(self):
        with pytest.raises(ValueError, match="4326"):
            find_overlaps({"a": _UTM_LIKE, "b": PARCEL_A})


class TestFindGaps:
    def test_full_coverage_has_no_gaps(self):
        boundary = box(_LON0, _LAT0, _LON0 + 2 * _DLON, _LAT0 + _DLAT)
        assert find_gaps({"a": PARCEL_A, "b": PARCEL_B}, boundary) == []

    def test_uncovered_strip_is_reported_in_square_metres(self):
        # third ~100m strip [2*_DLON, 3*_DLON] is left uncovered
        boundary = box(_LON0, _LAT0, _LON0 + 3 * _DLON, _LAT0 + _DLAT)
        issues = find_gaps({"a": PARCEL_A, "b": PARCEL_B}, boundary)
        assert len(issues) == 1
        assert 9000 <= issues[0].area <= 11000  # ~100m x 100m, not ~1.0 (square degrees)

    def test_tiny_gaps_below_threshold_are_ignored(self):
        boundary = box(_LON0, _LAT0, _LON0 + 2 * _DLON + _deg_lon(0.005), _LAT0 + _DLAT)
        issues = find_gaps({"a": PARCEL_A, "b": PARCEL_B}, boundary, min_area=1.0)
        assert issues == []

    def test_utm_like_boundary_is_rejected(self):
        with pytest.raises(ValueError, match="4326"):
            find_gaps({"a": PARCEL_A}, _UTM_LIKE)


class TestRunQa:
    def test_clean_batch_is_not_blocking(self):
        boundary = box(_LON0, _LAT0, _LON0 + 2 * _DLON, _LAT0 + _DLAT)
        report = run_qa({"a": PARCEL_A, "b": PARCEL_B}, boundary=boundary)
        assert report.issues == []
        assert not report.blocking

    def test_invalid_geometry_blocks_the_batch(self):
        report = run_qa({"a": PARCEL_A, "bad": BOWTIE})
        assert report.blocking

    def test_overlaps_block_the_batch(self):
        report = run_qa({"a": PARCEL_A, "b": PARCEL_OVERLAP})
        assert report.blocking

    def test_gaps_warn_but_do_not_block(self):
        # gaps can be legitimate (roads, rivers) -> warning, not quarantine
        boundary = box(_LON0, _LAT0, _LON0 + 2 * _DLON, _LAT0 + _DLAT)
        report = run_qa({"a": PARCEL_A}, boundary=boundary)
        assert len(report.issues) == 1
        assert report.issues[0].kind == "gap"
        assert not report.blocking

    def test_without_boundary_gap_check_is_skipped(self):
        report = run_qa({"a": PARCEL_A})
        assert report.issues == []

    def test_default_thresholds_are_expressed_in_square_metres(self):
        # A genuine ~9 m^2 overlap must still block under the default
        # thresholds -- this was the concrete gap the old square-degree
        # default left open (overlaps up to ~11-12 m^2 passed as clean).
        sliver = box(
            _LON0 + _DLON,
            _LAT0,
            _LON0 + _DLON + _deg_lon(3.0),
            _LAT0 + _deg_lat(3.0),
        )
        report = run_qa({"a": PARCEL_B, "b": sliver})
        assert report.blocking
