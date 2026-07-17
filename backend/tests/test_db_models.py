from geoalchemy2 import Geometry

from mapencroach.db.models import (
    AuditLog,
    Base,
    ContextObservation,
    ContextSource,
    GeographicUnit,
    Jurisdiction,
    Parcel,
    ParcelGeographicLink,
    ParcelIdentifier,
    ParcelLineage,
)


class TestSchemaRegistration:
    def test_expected_tables_are_registered(self):
        assert {
            "parcel",
            "jurisdiction",
            "audit_log",
            "parcel_identifier",
            "parcel_lineage",
            "context_source",
            "geographic_unit",
            "parcel_geographic_link",
            "context_observation",
        } <= set(Base.metadata.tables)


class TestParcel:
    def test_geometry_is_multipolygon_wgs84(self):
        geom = Parcel.__table__.c.geometry
        assert isinstance(geom.type, Geometry)
        assert geom.type.geometry_type == "MULTIPOLYGON"
        assert geom.type.srid == 4326

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
