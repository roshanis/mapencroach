"""Scene ingestion: hash-first ordering, COG output, STAC correctness, sidecars."""

import hashlib
import json
from datetime import UTC, datetime

import numpy as np
import pytest
import rasterio
from rasterio.transform import from_origin
from rio_cogeo.cogeo import cog_validate

from mapencroach.imagery.pipeline import IngestedScene, ingest_scene, register_scene
from mapencroach.imagery.sidecar import parse_sidecar

CAPTURED = datetime(2026, 7, 1, 5, 30, tzinfo=UTC)

# A small UTM-44N raster near Haridwar (so WGS84 reprojection is exercised).
UTM_CRS = "EPSG:32644"
ORIGIN_X, ORIGIN_Y = 220_000, 3_313_000


def write_tif(path, bands=4, size=32, pixel=10.0, seed=7):
    rng = np.random.default_rng(seed)
    data = rng.integers(0, 255, size=(bands, size, size)).astype("uint8")
    transform = from_origin(ORIGIN_X, ORIGIN_Y, pixel, pixel)
    with rasterio.open(
        path,
        "w",
        driver="GTiff",
        height=size,
        width=size,
        count=bands,
        dtype="uint8",
        crs=UTM_CRS,
        transform=transform,
    ) as dst:
        dst.write(data)
    return path


@pytest.fixture
def scene(tmp_path) -> IngestedScene:
    tif = write_tif(tmp_path / "delivered.tif")
    sidecar = tmp_path / "delivered_meta.txt"
    sidecar.write_text(
        "SatID = CARTOSAT-3\nGSD = 0.28\nSunAzimuth = 143.2\nDateTime = 2026-07-01T05:30:00Z\n"
    )
    return ingest_scene(
        tif,
        scene_id="c3-2026-07-01-hrda-01",
        captured_at=CAPTURED,
        sensor="Cartosat-3 PAN",
        resolution_m=0.28,
        cloud_pct=2.0,
        source="USAC",
        output_dir=tmp_path / "cogs",
        sidecar_path=sidecar,
    )


class TestHashFirstOrdering:
    def test_original_hash_matches_delivered_bytes(self, tmp_path, scene):
        delivered = (tmp_path / "delivered.tif").read_bytes()
        assert scene.original_sha256 == hashlib.sha256(delivered).hexdigest()

    def test_cog_is_a_separate_artifact_with_its_own_hash(self, tmp_path, scene):
        cog_bytes = (tmp_path / "cogs" / "c3-2026-07-01-hrda-01.tif").read_bytes()
        assert scene.cog_sha256 == hashlib.sha256(cog_bytes).hexdigest()
        assert scene.cog_sha256 != scene.original_sha256

    def test_sidecar_preserved_verbatim_and_hashed(self, tmp_path, scene):
        raw = (tmp_path / "delivered_meta.txt").read_text()
        assert scene.sidecar.raw == raw
        assert scene.sidecar.sha256 == hashlib.sha256(raw.encode()).hexdigest()
        assert scene.sidecar.fields["SatID"] == "CARTOSAT-3"
        assert scene.sidecar.fields["GSD"] == "0.28"


class TestCogOutput:
    def test_output_is_a_valid_cog(self, tmp_path, scene):
        valid, errors, _warnings = cog_validate(scene.cog_path, quiet=True)
        assert valid, errors

    def test_scene_without_crs_is_refused(self, tmp_path):
        path = tmp_path / "nocrs.tif"
        data = np.zeros((1, 8, 8), dtype="uint8")
        with rasterio.open(
            path, "w", driver="GTiff", height=8, width=8, count=1, dtype="uint8"
        ) as dst:
            dst.write(data)
        with pytest.raises(ValueError, match="CRS"):
            ingest_scene(
                path,
                scene_id="bad",
                captured_at=CAPTURED,
                sensor="x",
                resolution_m=1.0,
                cloud_pct=0.0,
                source="test",
                output_dir=tmp_path / "cogs",
            )


class TestStacItem:
    def test_footprint_is_wgs84_near_haridwar(self, scene):
        left, bottom, right, top = scene.stac_item["bbox"]
        assert 77.0 < left < right < 79.0
        assert 29.0 < bottom < top < 31.0
        assert scene.stac_item["geometry"]["type"] == "Polygon"

    def test_properties_carry_evidence_hashes(self, scene):
        props = scene.stac_item["properties"]
        assert props["mapencroach:original_sha256"] == scene.original_sha256
        assert props["mapencroach:cog_sha256"] == scene.cog_sha256
        assert props["mapencroach:sidecar_sha256"] == scene.sidecar.sha256
        assert props["gsd"] == 0.28
        assert props["datetime"] == CAPTURED.isoformat()


class TestSidecarFormats:
    def test_xml_sidecar_is_flattened(self):
        record = parse_sidecar(
            b"<Metadata><Sensor><Name>CARTOSAT-3</Name><Angle>12.5</Angle></Sensor>"
            b"<Ephemeris><X>7000.1</X></Ephemeris></Metadata>"
        )
        assert record.format == "xml"
        assert record.fields["Sensor.Name"] == "CARTOSAT-3"
        assert record.fields["Ephemeris.X"] == "7000.1"

    def test_malformed_sidecar_still_preserved(self):
        record = parse_sidecar(b"<Metadata><broken>")
        assert record.format == "unparsed"
        assert record.fields == {}
        assert record.raw == "<Metadata><broken>"
        assert len(record.sha256) == 64

    def test_colon_separated_keyvalue(self):
        record = parse_sidecar(b"ProductID: 123\n# comment\nPath: 97\n")
        assert record.fields == {"ProductID": "123", "Path": "97"}


class TestRegistration:
    def test_register_persists_and_audits(self, scene):
        from mapencroach.api.store import Store

        store = Store.seed_demo()
        stored = register_scene(store, scene, actor="data-admin-1")
        assert store.scenes[scene.scene_id]["sha256"] == scene.original_sha256
        assert stored["sidecar_raw"].startswith("SatID")
        assert store.audit_chain[-1].payload["action"] == "scene.ingest"

    def test_duplicate_scene_id_and_content_are_refused(self, scene):
        from mapencroach.api.store import Store

        store = Store.seed_demo()
        register_scene(store, scene, actor="data-admin-1")
        with pytest.raises(ValueError, match="already registered"):
            store.save_scene(scene.to_store_dict())
        renamed = scene.to_store_dict() | {"scene_id": "different-id"}
        with pytest.raises(ValueError, match="content already registered"):
            store.save_scene(renamed)

    def test_database_store_round_trips_scene(self, scene):
        from sqlalchemy import create_engine
        from sqlalchemy.pool import StaticPool

        from mapencroach.db.store import DatabaseStore, init_db, seed_demo_database

        engine = create_engine(
            "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
        )
        init_db(engine)
        seed_demo_database(engine)
        store = DatabaseStore(engine)
        register_scene(store, scene, actor="data-admin-1")

        reborn = DatabaseStore(engine).scenes[scene.scene_id]
        assert reborn["sha256"] == scene.original_sha256
        assert reborn["cog_sha256"] == scene.cog_sha256
        assert reborn["stac_item"]["properties"]["gsd"] == 0.28
        assert reborn["sidecar_raw"] == scene.sidecar.raw
        assert json.dumps(reborn["stac_item"])  # fully JSON-serializable