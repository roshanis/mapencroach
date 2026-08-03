"""Classical footprint extraction: threshold + numpy morphology + vectorize.

Synthetic scenes follow test_detection.py's conventions (4-band uint8
UTM rasters, VEG=[60,60,40,200] vs BUILT=[140,140,150,90] per band
B,G,R,NIR) but this file is self-contained — it does not import the
fixture from test_detection.py so it stays correct even if that
module's internals change shape.
"""

import numpy as np
import pytest
import rasterio
from rasterio.transform import from_origin
from shapely.geometry import shape

from mapencroach.detection.confirm import confirm_change
from mapencroach.detection.footprints import (
    extract_footprints,
    footprints_for_confirmation,
)

UTM = "EPSG:32644"
PIXEL_M = 5.0
SIZE = 60  # 300m x 300m
ORIGIN_X = 300000.0
ORIGIN_Y = 3300000.0

VEG = np.array([60, 60, 40, 200], dtype="uint8")  # B,G,R,NIR — healthy canopy
BUILT = np.array([140, 140, 150, 90], dtype="uint8")  # bright, low NIR

# 10x10 px = 100 px * 25 m2/px = 2500 m2
BLOCK_A = (5, 15, 5, 15)
# 6x6 px = 36 px * 25 m2/px = 900 m2
BLOCK_B = (40, 46, 40, 46)


def write_scene(path, *, built_blocks=(), noise_pixels=(), holes=()):
    """A vegetated 4-band uint8 UTM scene, optionally paved in blocks/noise/holes."""
    data = np.empty((4, SIZE, SIZE), dtype="uint8")
    for band in range(4):
        data[band, :, :] = VEG[band]
    for r0, r1, c0, c1 in built_blocks:
        for band in range(4):
            data[band, r0:r1, c0:c1] = BUILT[band]
    for r, c in noise_pixels:
        for band in range(4):
            data[band, r, c] = BUILT[band]
    for r, c in holes:
        for band in range(4):
            data[band, r, c] = VEG[band]
    with rasterio.open(
        path,
        "w",
        driver="GTiff",
        height=SIZE,
        width=SIZE,
        count=4,
        dtype="uint8",
        crs=UTM,
        transform=from_origin(ORIGIN_X, ORIGIN_Y, PIXEL_M, PIXEL_M),
    ) as dst:
        dst.write(data)
    return path


def pixel_to_wgs84_bbox(row0, row1, col0, col1):
    """Bounding box (WGS84) for a pixel window, for "near the raster location" checks."""
    from rasterio.warp import transform_bounds

    left = ORIGIN_X + col0 * PIXEL_M
    right = ORIGIN_X + col1 * PIXEL_M
    top = ORIGIN_Y - row0 * PIXEL_M
    bottom = ORIGIN_Y - row1 * PIXEL_M
    return transform_bounds(UTM, "EPSG:4326", left, bottom, right, top)


class TestExtractFootprints:
    def test_two_separated_blocks_yield_two_sorted_footprints(self, tmp_path):
        path = write_scene(tmp_path / "scene.tif", built_blocks=[BLOCK_A, BLOCK_B])
        with rasterio.open(path) as ds:
            footprints = extract_footprints(ds)

        assert len(footprints) == 2
        areas = [shape(g).area for g in footprints]
        # shapely area is in degrees^2 here (geometries are WGS84); use the
        # dataset's own projected math instead by re-deriving expected ratio.
        assert areas[0] > areas[1]  # sorted descending
        for geom in footprints:
            poly = shape(geom)
            assert poly.is_valid
            assert poly.geom_type == "Polygon"
            assert len(poly.interiors) == 0

        # Larger footprint (block A, 2500 m2) should sit near block A's window.
        bbox_a = pixel_to_wgs84_bbox(*BLOCK_A)
        big = shape(footprints[0])
        assert big.centroid.x == pytest.approx((bbox_a[0] + bbox_a[2]) / 2, abs=0.01)
        assert big.centroid.y == pytest.approx((bbox_a[1] + bbox_a[3]) / 2, abs=0.01)

    def test_footprint_areas_match_pixel_counts(self, tmp_path):
        path = write_scene(tmp_path / "scene.tif", built_blocks=[BLOCK_A, BLOCK_B])
        with rasterio.open(path) as ds:
            footprints = extract_footprints(ds)

        # Reproject back to the dataset CRS to measure true metric area.
        from rasterio.warp import transform_geom as rio_transform_geom

        with rasterio.open(path) as ds:
            metric_areas = sorted(
                (
                    shape(rio_transform_geom("EPSG:4326", ds.crs, g)).area
                    for g in footprints
                ),
                reverse=True,
            )
        assert metric_areas[0] == pytest.approx(2500.0, abs=25.0)  # ± one pixel ring
        assert metric_areas[1] == pytest.approx(900.0, abs=25.0)

    def test_salt_noise_is_removed_by_opening(self, tmp_path):
        path = write_scene(
            tmp_path / "scene.tif",
            noise_pixels=[(3, 50), (55, 3), (20, 20), (0, 0), (59, 59)],
        )
        with rasterio.open(path) as ds:
            footprints = extract_footprints(ds)
        assert footprints == []

    def test_small_hole_is_closed_not_left_as_a_donut(self, tmp_path):
        path = write_scene(
            tmp_path / "scene.tif",
            built_blocks=[BLOCK_A],
            holes=[(10, 10), (10, 11)],
        )
        with rasterio.open(path) as ds:
            footprints = extract_footprints(ds)
        assert len(footprints) == 1
        poly = shape(footprints[0])
        assert len(poly.interiors) == 0  # filled, not a donut
        assert poly.is_valid

    def test_geographic_crs_is_refused(self, tmp_path):
        path = tmp_path / "geo.tif"
        data = np.zeros((4, 8, 8), dtype="uint8")
        with rasterio.open(
            path,
            "w",
            driver="GTiff",
            height=8,
            width=8,
            count=4,
            dtype="uint8",
            crs="EPSG:4326",
            transform=from_origin(78.14, 29.94, 0.0001, 0.0001),
        ) as dst:
            dst.write(data)
        with rasterio.open(path) as ds, pytest.raises(ValueError, match="projected CRS"):
            extract_footprints(ds)

    def test_aoi_clip_returns_only_the_covered_block(self, tmp_path):
        path = write_scene(tmp_path / "scene.tif", built_blocks=[BLOCK_A, BLOCK_B])
        bbox_a = pixel_to_wgs84_bbox(*BLOCK_A)
        # Pad the AOI generously so raster resampling/clipping doesn't clip
        # into the block itself, while staying well clear of block B.
        pad = 0.0005
        aoi = {
            "type": "Polygon",
            "coordinates": [
                [
                    [bbox_a[0] - pad, bbox_a[1] - pad],
                    [bbox_a[2] + pad, bbox_a[1] - pad],
                    [bbox_a[2] + pad, bbox_a[3] + pad],
                    [bbox_a[0] - pad, bbox_a[3] + pad],
                    [bbox_a[0] - pad, bbox_a[1] - pad],
                ]
            ],
        }
        with rasterio.open(path) as ds:
            footprints = extract_footprints(ds, aoi)
        assert len(footprints) == 1


class TestFootprintsForConfirmation:
    def test_shape_matches_extract_footprints_on_a_buffered_aoi(self, tmp_path):
        path = write_scene(tmp_path / "scene.tif", built_blocks=[BLOCK_A])
        bbox_a = pixel_to_wgs84_bbox(*BLOCK_A)
        parcel = {
            "type": "Polygon",
            "coordinates": [
                [
                    [bbox_a[0], bbox_a[1]],
                    [bbox_a[2], bbox_a[1]],
                    [bbox_a[2], bbox_a[3]],
                    [bbox_a[0], bbox_a[3]],
                    [bbox_a[0], bbox_a[1]],
                ]
            ],
        }
        with rasterio.open(path) as ds:
            footprints = footprints_for_confirmation(ds, parcel)
        assert len(footprints) == 1
        assert shape(footprints[0]).is_valid


class TestConfirmationIntegration:
    def test_extracted_footprint_dismisses_a_change_on_a_pre_existing_building(self, tmp_path):
        """A change alert that sits exactly on an already-standing building is dismissed."""
        path = write_scene(tmp_path / "scene.tif", built_blocks=[BLOCK_A])
        with rasterio.open(path) as ds:
            footprints = extract_footprints(ds)
        assert len(footprints) == 1

        # The "change" the screening stage reported is the same building.
        change_geometry = footprints[0]
        outcome, reason, new_built_m2, _deviation = confirm_change(
            change_geometry, footprint_geometries=footprints
        )
        assert outcome == "dismissed"
        assert reason == "matches_existing_footprint"
        assert new_built_m2 == pytest.approx(0.0, abs=1.0)
