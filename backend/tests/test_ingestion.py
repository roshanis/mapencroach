import geopandas as gpd
from shapely.geometry import MultiPolygon, Point, box

from mapencroach.cadastral.ingestion import load_parcels

SQUARE_LEFT = box(0, 0, 1, 1)
SQUARE_RIGHT = box(1, 0, 2, 1)
SQUARE_OVERLAPPING = box(0.5, 0, 1.5, 1)


def _write_geojson(tmp_path, gdf, name="parcels.geojson"):
    path = tmp_path / name
    gdf.to_file(path, driver="GeoJSON")
    return path


def _write_gpkg(tmp_path, gdf, name="parcels.gpkg"):
    path = tmp_path / name
    gdf.to_file(path, driver="GPKG")
    return path


def _clean_gdf(ids=("1", "2"), geoms=(SQUARE_LEFT, SQUARE_RIGHT), crs="EPSG:4326", **extra_cols):
    data = {"parcel_id": list(ids), "geometry": list(geoms)}
    data.update(extra_cols)
    return gpd.GeoDataFrame(data, crs=crs)


class TestHappyPathGeoJson:
    def test_valid_geojson_is_accepted_with_correct_records(self, tmp_path):
        gdf = _clean_gdf(owner=["Ram", "Shyam"])
        path = _write_geojson(tmp_path, gdf)

        result = load_parcels(path, id_column="parcel_id")

        assert result.status == "accepted"
        assert result.errors == []
        assert result.report is not None
        assert len(result.parcels) == 2
        by_id = {p.parcel_id: p for p in result.parcels}
        assert set(by_id) == {"1", "2"}
        for record in result.parcels:
            assert isinstance(record.geometry, MultiPolygon)


class TestHappyPathGpkg:
    def test_valid_gpkg_is_accepted_with_correct_records(self, tmp_path):
        gdf = _clean_gdf(owner=["Ram", "Shyam"])
        path = _write_gpkg(tmp_path, gdf)

        result = load_parcels(path, id_column="parcel_id")

        assert result.status == "accepted"
        assert result.errors == []
        assert len(result.parcels) == 2
        for record in result.parcels:
            assert isinstance(record.geometry, MultiPolygon)


class TestReprojection:
    def test_utm_zone_43n_is_reprojected_to_epsg_4326(self, tmp_path):
        # A parcel near Bhopal, India, expressed directly in UTM 43N metres.
        utm_square = box(500000, 2600000, 500100, 2600100)
        gdf = gpd.GeoDataFrame(
            {"parcel_id": ["1"], "geometry": [utm_square]}, crs="EPSG:32643"
        )
        path = _write_geojson(tmp_path, gdf)
        pre_reproject_coords = list(utm_square.exterior.coords)

        result = load_parcels(path, id_column="parcel_id")

        assert result.status == "accepted"
        record = result.parcels[0]
        reprojected_poly = record.geometry.geoms[0]
        post_coords = list(reprojected_poly.exterior.coords)
        assert post_coords != pre_reproject_coords
        for x, y in post_coords:
            assert -180 <= x <= 180
            assert -90 <= y <= 90


class TestPolygonPromotion:
    def test_polygon_is_promoted_to_single_part_multipolygon(self, tmp_path):
        gdf = _clean_gdf(ids=("1",), geoms=(SQUARE_LEFT,))
        path = _write_geojson(tmp_path, gdf)

        result = load_parcels(path, id_column="parcel_id")

        assert result.status == "accepted"
        record = result.parcels[0]
        assert isinstance(record.geometry, MultiPolygon)
        assert len(record.geometry.geoms) == 1
        assert record.geometry.geoms[0].equals(SQUARE_LEFT)

    def test_multipolygon_passes_through_as_is(self, tmp_path):
        # Parts must be disjoint (not merely touching) or the multipolygon
        # itself is invalid per OGC rules.
        disjoint_part = box(1.5, 0, 2.5, 1)
        mp = MultiPolygon([SQUARE_LEFT, disjoint_part])
        gdf = gpd.GeoDataFrame({"parcel_id": ["1"], "geometry": [mp]}, crs="EPSG:4326")
        path = _write_geojson(tmp_path, gdf)

        result = load_parcels(path, id_column="parcel_id")

        assert result.status == "accepted"
        record = result.parcels[0]
        assert isinstance(record.geometry, MultiPolygon)
        assert len(record.geometry.geoms) == 2


class TestAttributes:
    def test_non_geometry_non_id_columns_are_preserved_and_id_column_excluded(self, tmp_path):
        gdf = _clean_gdf(ids=("1",), geoms=(SQUARE_LEFT,), owner=["Ram"], area_ha=[2.5])
        path = _write_geojson(tmp_path, gdf)

        result = load_parcels(path, id_column="parcel_id")

        assert result.status == "accepted"
        record = result.parcels[0]
        assert record.attributes["owner"] == "Ram"
        assert record.attributes["area_ha"] == 2.5
        assert "parcel_id" not in record.attributes
        assert "geometry" not in record.attributes


class TestRejectionMissingFile:
    def test_missing_file_path_is_rejected(self, tmp_path):
        path = tmp_path / "does_not_exist.geojson"

        result = load_parcels(path, id_column="parcel_id")

        assert result.status == "rejected"
        assert result.parcels == []
        assert result.report is None
        assert any("does_not_exist" in e or "file" in e.lower() for e in result.errors)

    def test_unreadable_file_is_rejected(self, tmp_path):
        path = tmp_path / "corrupt.geojson"
        path.write_text("this is not valid geojson content {{{")

        result = load_parcels(path, id_column="parcel_id")

        assert result.status == "rejected"
        assert result.parcels == []
        assert result.report is None
        assert any("unable to read" in e.lower() or "corrupt.geojson" in e for e in result.errors)


class TestRejectionMissingIdColumn:
    def test_missing_id_column_is_rejected(self, tmp_path):
        gdf = _clean_gdf()
        path = _write_geojson(tmp_path, gdf)

        result = load_parcels(path, id_column="not_a_real_column")

        assert result.status == "rejected"
        assert result.parcels == []
        assert result.report is None
        assert any("not_a_real_column" in e for e in result.errors)


class TestRejectionDuplicateIds:
    def test_duplicate_ids_are_rejected(self, tmp_path):
        gdf = _clean_gdf(ids=("1", "1"))
        path = _write_geojson(tmp_path, gdf)

        result = load_parcels(path, id_column="parcel_id")

        assert result.status == "rejected"
        assert result.parcels == []
        assert result.report is None
        assert any("parcel_id" in e and "duplicate" in e.lower() for e in result.errors)


class TestRejectionNullId:
    def test_null_id_is_rejected(self, tmp_path):
        gdf = gpd.GeoDataFrame(
            {"parcel_id": ["1", None], "geometry": [SQUARE_LEFT, SQUARE_RIGHT]},
            crs="EPSG:4326",
        )
        path = _write_geojson(tmp_path, gdf)

        result = load_parcels(path, id_column="parcel_id")

        assert result.status == "rejected"
        assert result.parcels == []
        assert result.report is None
        assert any("parcel_id" in e and ("null" in e.lower() or "missing" in e.lower())
                    for e in result.errors)


class TestRejectionNoCrs:
    def test_missing_crs_is_rejected(self, tmp_path):
        # GeoJSON always reads back as EPSG:4326 per RFC 7946, so GPKG is
        # used here to genuinely exercise a layer with no CRS set.
        gdf = _clean_gdf(crs=None)
        path = _write_gpkg(tmp_path, gdf)

        result = load_parcels(path, id_column="parcel_id")

        assert result.status == "rejected"
        assert result.parcels == []
        assert result.report is None
        assert any("crs" in e.lower() for e in result.errors)


class TestRejectionNonPolygonGeometry:
    def test_point_geometry_present_is_rejected(self, tmp_path):
        gdf = gpd.GeoDataFrame(
            {"parcel_id": ["1", "2"], "geometry": [SQUARE_LEFT, Point(0, 0)]},
            crs="EPSG:4326",
        )
        path = _write_geojson(tmp_path, gdf)

        result = load_parcels(path, id_column="parcel_id")

        assert result.status == "rejected"
        assert result.parcels == []
        assert result.report is None
        assert any("2" in e and "geometry" in e.lower() for e in result.errors)


class TestQuarantineOnOverlap:
    def test_overlapping_parcels_are_quarantined(self, tmp_path):
        gdf = _clean_gdf(ids=("1", "2"), geoms=(SQUARE_LEFT, SQUARE_OVERLAPPING))
        path = _write_geojson(tmp_path, gdf)

        result = load_parcels(path, id_column="parcel_id")

        assert result.status == "quarantined"
        assert result.parcels == []
        assert result.report is not None
        assert result.report.blocking


class TestAcceptedWithGapWarnings:
    def test_gap_within_boundary_warns_but_accepts(self, tmp_path):
        gdf = _clean_gdf(ids=("1", "2"), geoms=(SQUARE_LEFT, SQUARE_RIGHT))
        path = _write_geojson(tmp_path, gdf)
        boundary = box(0, 0, 3, 1)

        result = load_parcels(path, id_column="parcel_id", boundary=boundary)

        assert result.status == "accepted"
        assert len(result.parcels) == 2
        assert result.report is not None
        assert any(issue.kind == "gap" for issue in result.report.issues)
        assert not result.report.blocking


class TestIdCoercion:
    def test_integer_id_column_is_coerced_to_string(self, tmp_path):
        gdf = gpd.GeoDataFrame(
            {"parcel_id": [1, 2], "geometry": [SQUARE_LEFT, SQUARE_RIGHT]},
            crs="EPSG:4326",
        )
        path = _write_geojson(tmp_path, gdf)

        result = load_parcels(path, id_column="parcel_id")

        assert result.status == "accepted"
        ids = {p.parcel_id for p in result.parcels}
        assert ids == {"1", "2"}
        for parcel_id in ids:
            assert isinstance(parcel_id, str)


class TestNoIssuesReportAttached:
    def test_clean_batch_without_boundary_still_attaches_empty_report(self, tmp_path):
        gdf = _clean_gdf()
        path = _write_geojson(tmp_path, gdf)

        result = load_parcels(path, id_column="parcel_id")

        assert result.status == "accepted"
        assert result.report is not None
        assert result.report.issues == []
        assert not result.report.blocking


class TestNullGeometry:
    def test_null_geometry_is_rejected_not_crashed(self, tmp_path):
        gdf = gpd.GeoDataFrame(
            {"parcel_id": ["1", "2"], "geometry": [SQUARE_LEFT, None]}, crs="EPSG:4326"
        )
        path = _write_gpkg(tmp_path, gdf)

        result = load_parcels(path, id_column="parcel_id")

        assert result.status == "rejected"
        assert result.parcels == []
        assert any("id=2" in error and "missing" in error for error in result.errors)
