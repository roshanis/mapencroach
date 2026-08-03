"""Enrichment joins: green belt, ELU/PLU mismatch, RoW breach, water proximity."""

import pytest
from shapely.geometry import mapping

from mapencroach.detection.enrichment import enrich


def poly(x, y, size=0.0005):
    return {
        "type": "Polygon",
        "coordinates": [
            [[x, y], [x + size, y], [x + size, y + size], [x, y + size], [x, y]]
        ],
    }


def feature(geometry, feature_id="f1", **attributes):
    return {"source_feature_id": feature_id, "geometry": geometry, "attributes": attributes}


# A ~50m x 55m change footprint near Haridwar.
CHANGE = poly(78.1200, 29.9200)


class TestGreenBelt:
    def test_intersection_is_flagged_with_area(self):
        flags = enrich(CHANGE, {"green_belt": [feature(poly(78.1200, 29.9200, 0.01))]})
        assert flags["green_belt"]["intersects"] is True
        assert flags["green_belt"]["area_m2"] == pytest.approx(48 * 55, rel=0.1)

    def test_disjoint_green_belt_is_silent(self):
        flags = enrich(CHANGE, {"green_belt": [feature(poly(78.5, 29.5))]})
        assert "green_belt" not in flags


class TestZoning:
    def test_elu_plu_mismatch_is_flagged(self):
        zone = poly(78.1195, 29.9195, 0.002)
        flags = enrich(
            CHANGE,
            {
                "elu": [feature(zone, land_use="commercial")],
                "plu": [feature(zone, land_use="residential")],
            },
        )
        assert flags["zoning"]["existing_land_use"] == ["commercial"]
        assert flags["zoning"]["planned_land_use"] == ["residential"]
        assert flags["zoning"]["mismatch"] is True

    def test_agreeing_uses_are_reported_without_mismatch(self):
        zone = poly(78.1195, 29.9195, 0.002)
        flags = enrich(
            CHANGE,
            {
                "elu": [feature(zone, land_use="residential")],
                "plu": [feature(zone, land_use="residential")],
            },
        )
        assert "mismatch" not in flags["zoning"]

    def test_absent_zoning_layers_yield_no_verdict(self):
        # Absence of data is never reported as absence of conflict.
        assert enrich(CHANGE, {}) == {}

    def test_unattributed_zones_are_ignored(self):
        zone = poly(78.1195, 29.9195, 0.002)
        flags = enrich(CHANGE, {"plu": [feature(zone)]})  # no land_use attribute
        assert "zoning" not in flags


class TestRightOfWay:
    def test_change_inside_road_corridor_is_a_breach(self):
        # Road centerline passing through the change; 45m RoW -> 22.5m each side.
        road = {
            "type": "LineString",
            "coordinates": [[78.1190, 29.9202], [78.1215, 29.9202]],
        }
        flags = enrich(CHANGE, {"road": [feature(road, row_width_m=45.0)]})
        assert flags["right_of_way"]["breach"] is True
        assert flags["right_of_way"]["area_m2"] > 0

    def test_change_beyond_the_corridor_is_silent(self):
        road = {
            "type": "LineString",
            "coordinates": [[78.1190, 29.9250], [78.1215, 29.9250]],  # ~550m north
        }
        flags = enrich(CHANGE, {"road": [feature(road, row_width_m=45.0)]})
        assert "right_of_way" not in flags


class TestWaterProximity:
    def test_change_near_canal_is_flagged_with_distance(self):
        canal = {
            "type": "LineString",
            # ~30m south of the change footprint
            "coordinates": [[78.1190, 29.91972], [78.1215, 29.91972]],
        }
        flags = enrich(CHANGE, {"water_body": [feature(canal)]})
        assert flags["water_body"]["distance_m"] == pytest.approx(31, abs=5)

    def test_distant_water_is_silent(self):
        canal = {
            "type": "LineString",
            "coordinates": [[78.1190, 29.9100], [78.1215, 29.9100]],  # ~1.1km away
        }
        assert "water_body" not in enrich(CHANGE, {"water_body": [feature(canal)]})


class TestDetectionIntegration:
    def test_detected_alert_carries_enrichment_flags(self, tmp_path):
        from datetime import UTC, datetime

        from sqlalchemy import create_engine
        from sqlalchemy.pool import StaticPool

        from mapencroach.db.store import DatabaseStore, init_db, seed_demo_database
        from test_detection import CHANGE_BLOCK, detect, register, write_scene

        engine = create_engine(
            "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
        )
        init_db(engine)
        seed_demo_database(engine)
        store = DatabaseStore(engine)
        register(
            store, "base", write_scene(tmp_path / "b.tif"), datetime(2026, 1, 5, tzinfo=UTC)
        )
        register(
            store,
            "cur1",
            write_scene(tmp_path / "c1.tif", built_block=CHANGE_BLOCK),
            datetime(2026, 6, 5, tzinfo=UTC),
        )
        register(
            store,
            "cur2",
            write_scene(tmp_path / "c2.tif", built_block=CHANGE_BLOCK),
            datetime(2026, 7, 5, tzinfo=UTC),
        )

        # Green belt exactly over parcel-1 (the demo canal-bank parcel).
        from shapely.geometry import shape

        parcel_geom = shape(store.parcels["parcel-1"]["geometry"])
        layers = {
            "green_belt": [
                {
                    "source_feature_id": "gb-1",
                    "geometry": mapping(parcel_geom.buffer(0.001)),
                    "attributes": {},
                }
            ]
        }

        from mapencroach.detection.run import run_detection

        run_detection(
            store,
            baseline_scene_id="base",
            current_scene_id="cur1",
            aoi_jurisdiction_id="taluk-a1",
            enrichment_layers=layers,
        )
        summary = run_detection(
            store,
            baseline_scene_id="base",
            current_scene_id="cur2",
            aoi_jurisdiction_id="taluk-a1",
            enrichment_layers=layers,
        )
        assert len(summary.alerts_created) == 1
        alert = store.alerts[summary.alerts_created[0]]
        assert alert["enrichment"]["green_belt"]["intersects"] is True
        # detect() helper unused here but kept importable for parity
        assert callable(detect)