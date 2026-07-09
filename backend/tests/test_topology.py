from shapely.geometry import Polygon, box

from mapencroach.cadastral.topology import find_gaps, find_invalid, find_overlaps, run_qa

SQUARE_LEFT = box(0, 0, 1, 1)
SQUARE_RIGHT = box(1, 0, 2, 1)  # shares an edge with SQUARE_LEFT, no overlap
SQUARE_OVERLAPPING = box(0.5, 0, 1.5, 1)  # overlaps SQUARE_LEFT by 0.5
BOWTIE = Polygon([(0, 0), (1, 1), (1, 0), (0, 1)])  # self-intersecting -> invalid


class TestFindInvalid:
    def test_valid_parcels_produce_no_issues(self):
        assert find_invalid({"p1": SQUARE_LEFT, "p2": SQUARE_RIGHT}) == []

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
        assert find_overlaps({"a": SQUARE_LEFT, "b": SQUARE_RIGHT}) == []

    def test_overlap_is_reported_once_with_area(self):
        issues = find_overlaps({"a": SQUARE_LEFT, "b": SQUARE_OVERLAPPING})
        assert len(issues) == 1
        assert set(issues[0].parcel_ids) == {"a", "b"}
        assert abs(issues[0].area - 0.5) < 1e-9

    def test_sliver_overlaps_below_threshold_are_ignored(self):
        sliver = box(1 - 1e-6, 0, 1, 1)  # area 1e-6 against SQUARE_LEFT
        assert find_overlaps({"a": SQUARE_LEFT, "b": sliver}, min_area=1e-3) == []

    def test_three_way_overlaps_report_each_pair(self):
        c = box(0.6, 0, 1.6, 1)
        issues = find_overlaps({"a": SQUARE_LEFT, "b": SQUARE_OVERLAPPING, "c": c})
        pairs = {tuple(sorted(i.parcel_ids)) for i in issues}
        assert pairs == {("a", "b"), ("a", "c"), ("b", "c")}


class TestFindGaps:
    def test_full_coverage_has_no_gaps(self):
        boundary = box(0, 0, 2, 1)
        assert find_gaps({"a": SQUARE_LEFT, "b": SQUARE_RIGHT}, boundary) == []

    def test_uncovered_strip_is_reported_as_gap(self):
        boundary = box(0, 0, 3, 1)  # third column [2,3] uncovered
        issues = find_gaps({"a": SQUARE_LEFT, "b": SQUARE_RIGHT}, boundary)
        assert len(issues) == 1
        assert abs(issues[0].area - 1.0) < 1e-9

    def test_tiny_gaps_below_threshold_are_ignored(self):
        boundary = box(0, 0, 2 + 1e-6, 1)
        issues = find_gaps({"a": SQUARE_LEFT, "b": SQUARE_RIGHT}, boundary, min_area=1e-3)
        assert issues == []


class TestRunQa:
    def test_clean_batch_is_not_blocking(self):
        report = run_qa({"a": SQUARE_LEFT, "b": SQUARE_RIGHT}, boundary=box(0, 0, 2, 1))
        assert report.issues == []
        assert not report.blocking

    def test_invalid_geometry_blocks_the_batch(self):
        report = run_qa({"a": SQUARE_LEFT, "bad": BOWTIE})
        assert report.blocking

    def test_overlaps_block_the_batch(self):
        report = run_qa({"a": SQUARE_LEFT, "b": SQUARE_OVERLAPPING})
        assert report.blocking

    def test_gaps_warn_but_do_not_block(self):
        # gaps can be legitimate (roads, rivers) -> warning, not quarantine
        report = run_qa({"a": SQUARE_LEFT}, boundary=box(0, 0, 2, 1))
        assert len(report.issues) == 1
        assert report.issues[0].kind == "gap"
        assert not report.blocking

    def test_without_boundary_gap_check_is_skipped(self):
        report = run_qa({"a": SQUARE_LEFT})
        assert report.issues == []
