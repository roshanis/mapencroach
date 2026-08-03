from geoalchemy2 import Geometry
from sqlalchemy import Text
from sqlalchemy.dialects import postgresql, sqlite

from mapencroach.db.models import (
    Alert,
    AuditLog,
    Base,
    CaseEventRow,
    CaseRow,
    ContextObservation,
    ContextSource,
    DetectionRun,
    EvidencePacket,
    GeographicUnit,
    ImageryScene,
    Jurisdiction,
    Media,
    Parcel,
    ParcelGeographicLink,
    ParcelIdentifier,
    ParcelLineage,
)
from mapencroach.db.types import GeoJSONGeometry


class TestSchemaRegistration:
    def test_expected_tables_are_registered(self):
        assert {
            "parcel",
            "parcel_tag",
            "parcel_context_snapshot",
            "jurisdiction",
            "jurisdiction_level",
            "audit_log",
            "parcel_identifier",
            "parcel_lineage",
            "context_source",
            "geographic_unit",
            "parcel_geographic_link",
            "context_observation",
            "imagery_scene",
            "detection_run",
            "alert",
            "case",
            "case_event",
            "inspection",
            "media",
            "evidence_packet",
        } <= set(Base.metadata.tables)


class TestParcel:
    def test_geometry_is_multipolygon_wgs84(self):
        geom = Parcel.__table__.c.geometry
        assert isinstance(geom.type, GeoJSONGeometry)
        assert geom.type.geometry_type == "MULTIPOLYGON"
        assert geom.type.srid == 4326

    def test_geometry_is_postgis_on_postgresql_and_text_on_sqlite(self):
        geom_type = Parcel.__table__.c.geometry.type
        pg_impl = geom_type.load_dialect_impl(postgresql.dialect())
        assert isinstance(pg_impl, Geometry)
        assert pg_impl.geometry_type == "MULTIPOLYGON"
        assert pg_impl.srid == 4326
        assert isinstance(geom_type.load_dialect_impl(sqlite.dialect()), Text)

    def test_boundary_grade_is_constrained_to_a_b_c(self):
        col = Parcel.__table__.c.boundary_grade
        assert not col.nullable
        assert set(col.type.enums) == {"A", "B", "C"}

    def test_land_category_covers_plan_categories(self):
        col = Parcel.__table__.c.land_category
        assert {"waterbody", "forest", "revenue", "municipal"} <= set(col.type.enums)

    def test_parcel_is_scoped_to_a_jurisdiction(self):
        fks = {fk.column.table.name for fk in Parcel.__table__.c.jurisdiction_id.foreign_keys}
        assert fks == {"jurisdiction"}


class TestJurisdiction:
    def test_parent_is_self_referential_and_nullable_for_root(self):
        col = Jurisdiction.__table__.c.parent_id
        assert col.nullable
        assert {fk.column.table.name for fk in col.foreign_keys} == {"jurisdiction"}

    def test_level_is_data_not_enum(self):
        # A development authority (authority/zone/ward) and a revenue
        # deployment (state/district/taluk/village) share one schema.
        col = Jurisdiction.__table__.c.level
        assert {fk.column.table.name for fk in col.foreign_keys} == {"jurisdiction_level"}

    def test_boundary_geometry_is_optional(self):
        assert Jurisdiction.__table__.c.geometry.nullable


class TestGeographicLineageSchema:
    def test_identifiers_are_versioned_and_scoped_to_parcels(self):
        table = ParcelIdentifier.__table__
        assert {"scheme", "value", "source", "valid_from", "valid_to", "confidence"} <= set(
            table.c.keys()
        )
        assert {fk.column.table.name for fk in table.c.parcel_id.foreign_keys} == {"parcel"}

    def test_lineage_records_split_merge_and_renumber_events(self):
        table = ParcelLineage.__table__
        assert set(table.c.relation.type.enums) == {"split", "merge", "renumber"}
        assert {"predecessor_parcel_id", "successor_parcel_id", "effective_on"} <= set(
            table.c.keys()
        )

    def test_context_tables_keep_source_and_context_only_classification(self):
        assert ContextSource.__table__.c.license.nullable is False
        assert GeographicUnit.__table__.c.source_id.nullable is False
        assert ParcelGeographicLink.__table__.c.context_only.nullable is False
        assert ContextObservation.__table__.c.context_only.nullable is False

    def test_geographic_links_join_parcels_to_geographic_units(self):
        table = ParcelGeographicLink.__table__
        assert {fk.column.table.name for fk in table.c.parcel_id.foreign_keys} == {"parcel"}
        assert {fk.column.table.name for fk in table.c.geographic_unit_id.foreign_keys} == {
            "geographic_unit"
        }


class TestAuditLog:
    def test_hash_chain_columns_are_mandatory(self):
        table = AuditLog.__table__
        assert not table.c.prev_hash.nullable
        assert not table.c.row_hash.nullable

    def test_audit_rows_record_actor_action_and_object(self):
        cols = set(AuditLog.__table__.c.keys())
        assert {"actor", "action", "object_type", "object_id", "created_at"} <= cols


class TestImageryScene:
    def test_content_hash_is_mandatory_and_unique(self):
        col = ImageryScene.__table__.c.sha256
        assert not col.nullable
        assert col.unique

    def test_sidecar_is_preserved_verbatim_with_its_own_hash(self):
        cols = set(ImageryScene.__table__.c.keys())
        assert {"sidecar_raw", "sidecar_sha256", "stac_item", "captured_at"} <= cols


class TestAlertSchema:
    def test_tier_and_status_are_constrained(self):
        table = Alert.__table__
        assert set(table.c.tier.type.enums) == {"GREEN", "AMBER", "RED", "LEGACY"}
        assert set(table.c.status.type.enums) == {"OPEN", "UNDER_REVIEW", "ESCALATED", "CLOSED"}

    def test_detection_run_link_is_optional_for_manual_alerts(self):
        assert Alert.__table__.c.detection_run_id.nullable

    def test_detection_run_records_reproducibility_fields(self):
        cols = set(DetectionRun.__table__.c.keys())
        assert {"model_version", "aoi_jurisdiction_id", "params", "started_at"} <= cols


class TestCaseSchema:
    def test_case_traces_to_alert_parcel_and_jurisdiction(self):
        table = CaseRow.__table__
        for column, target in (
            ("alert_id", "alert"),
            ("parcel_id", "parcel"),
            ("jurisdiction_id", "jurisdiction"),
        ):
            assert {fk.column.table.name for fk in table.c[column].foreign_keys} == {target}

    def test_case_events_are_sequenced_per_case(self):
        constraint_columns = {
            tuple(c.name for c in constraint.columns)
            for constraint in CaseEventRow.__table__.constraints
            if constraint.name == "uq_case_event_seq"
        }
        assert ("case_id", "seq") in constraint_columns


class TestEvidenceSchema:
    def test_media_carries_capture_time_hash(self):
        assert not Media.__table__.c.sha256_at_capture.nullable

    def test_packet_certificate_workflow_states(self):
        col = EvidencePacket.__table__.c.certificate_status
        assert set(col.type.enums) == {"DRAFT", "PENDING_CERTIFICATION", "CERTIFIED"}
