"""Schema v1: jurisdiction tree, parcels with boundary grades, audit log.

Enums use native_enum=False (CHECK constraints) so the schema stays
portable between PostGIS and test databases.
"""

import datetime

from geoalchemy2 import Geometry
from sqlalchemy import Boolean, Date, DateTime, Enum, Float, ForeignKey, String, Text, func
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


class Jurisdiction(Base):
    __tablename__ = "jurisdiction"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    parent_id: Mapped[str | None] = mapped_column(ForeignKey("jurisdiction.id"), nullable=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    level: Mapped[str] = mapped_column(
        Enum("state", "district", "taluk", "village", name="jurisdiction_level",
             native_enum=False),
        nullable=False,
    )


class Parcel(Base):
    __tablename__ = "parcel"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    survey_no: Mapped[str | None] = mapped_column(String(100))
    ulpin: Mapped[str | None] = mapped_column(String(26), unique=True)
    owning_department: Mapped[str | None] = mapped_column(String(200))
    land_category: Mapped[str] = mapped_column(
        Enum("waterbody", "forest", "revenue", "municipal", "irrigation", "housing",
             "industrial", name="land_category", native_enum=False),
        nullable=False,
    )
    # A = DGPS-verified, B = georeferenced cadastre, C = unverified digitization
    boundary_grade: Mapped[str] = mapped_column(
        Enum("A", "B", "C", name="boundary_grade", native_enum=False),
        nullable=False,
    )
    legal_status: Mapped[str | None] = mapped_column(String(100))
    jurisdiction_id: Mapped[str] = mapped_column(ForeignKey("jurisdiction.id"), nullable=False)
    geometry = mapped_column(
        Geometry(geometry_type="MULTIPOLYGON", srid=4326), nullable=False
    )


class ParcelIdentifier(Base):
    """Versioned aliases that resolve source identifiers to a canonical parcel."""

    __tablename__ = "parcel_identifier"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    parcel_id: Mapped[str] = mapped_column(ForeignKey("parcel.id"), nullable=False)
    scheme: Mapped[str] = mapped_column(String(64), nullable=False)
    value: Mapped[str] = mapped_column(String(200), nullable=False)
    source: Mapped[str] = mapped_column(String(200), nullable=False)
    valid_from: Mapped[datetime.date | None] = mapped_column(Date)
    valid_to: Mapped[datetime.date | None] = mapped_column(Date)
    match_method: Mapped[str] = mapped_column(String(100), nullable=False)
    confidence: Mapped[float] = mapped_column(Float, nullable=False)


class ParcelLineage(Base):
    """Directed parcel history across cadastral splits, merges, and renumbering."""

    __tablename__ = "parcel_lineage"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    predecessor_parcel_id: Mapped[str] = mapped_column(
        ForeignKey("parcel.id"), nullable=False
    )
    successor_parcel_id: Mapped[str] = mapped_column(ForeignKey("parcel.id"), nullable=False)
    relation: Mapped[str] = mapped_column(
        Enum("split", "merge", "renumber", name="parcel_lineage_relation", native_enum=False),
        nullable=False,
    )
    effective_on: Mapped[datetime.date | None] = mapped_column(Date)
    source: Mapped[str] = mapped_column(String(200), nullable=False)
    confidence: Mapped[float] = mapped_column(Float, nullable=False)


class ContextSource(Base):
    """Provenance and licensing metadata for context-only datasets."""

    __tablename__ = "context_source"

    id: Mapped[str] = mapped_column(String(100), primary_key=True)
    provider: Mapped[str] = mapped_column(String(200), nullable=False)
    dataset: Mapped[str] = mapped_column(String(200), nullable=False)
    version: Mapped[str] = mapped_column(String(100), nullable=False)
    vintage: Mapped[str] = mapped_column(String(100), nullable=False)
    license: Mapped[str] = mapped_column(String(300), nullable=False)
    source_url: Mapped[str] = mapped_column(Text, nullable=False)
    resolution: Mapped[str] = mapped_column(String(200), nullable=False)
    limitations: Mapped[str] = mapped_column(Text, nullable=False)
    is_demo: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)


class GeographicUnit(Base):
    """External administrative or statistical unit used only for context joins."""

    __tablename__ = "geographic_unit"

    id: Mapped[str] = mapped_column(String(100), primary_key=True)
    scheme: Mapped[str] = mapped_column(String(64), nullable=False)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    level: Mapped[str] = mapped_column(String(100), nullable=False)
    source_id: Mapped[str] = mapped_column(ForeignKey("context_source.id"), nullable=False)
    geometry = mapped_column(
        Geometry(geometry_type="MULTIPOLYGON", srid=4326), nullable=True
    )


class ParcelGeographicLink(Base):
    """A confidence-scored join, never an assertion of cadastral identity."""

    __tablename__ = "parcel_geographic_link"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    parcel_id: Mapped[str] = mapped_column(ForeignKey("parcel.id"), nullable=False)
    geographic_unit_id: Mapped[str] = mapped_column(
        ForeignKey("geographic_unit.id"), nullable=False
    )
    source_id: Mapped[str] = mapped_column(ForeignKey("context_source.id"), nullable=False)
    match_method: Mapped[str] = mapped_column(String(100), nullable=False)
    confidence: Mapped[float] = mapped_column(Float, nullable=False)
    context_only: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)


class ContextObservation(Base):
    """A parcel-linked aggregate signal kept apart from alerts and evidence."""

    __tablename__ = "context_observation"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    parcel_id: Mapped[str] = mapped_column(ForeignKey("parcel.id"), nullable=False)
    geographic_unit_id: Mapped[str] = mapped_column(
        ForeignKey("geographic_unit.id"), nullable=False
    )
    source_id: Mapped[str] = mapped_column(ForeignKey("context_source.id"), nullable=False)
    indicator_key: Mapped[str] = mapped_column(String(100), nullable=False)
    label: Mapped[str] = mapped_column(String(200), nullable=False)
    value_number: Mapped[float | None] = mapped_column(Float)
    value_text: Mapped[str | None] = mapped_column(Text)
    unit: Mapped[str] = mapped_column(String(100), nullable=False)
    period: Mapped[str] = mapped_column(String(100), nullable=False)
    trend: Mapped[str | None] = mapped_column(String(64))
    context_only: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)


class AuditLog(Base):
    __tablename__ = "audit_log"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    actor: Mapped[str] = mapped_column(String(64), nullable=False)
    action: Mapped[str] = mapped_column(String(100), nullable=False)
    object_type: Mapped[str] = mapped_column(String(64), nullable=False)
    object_id: Mapped[str] = mapped_column(String(64), nullable=False)
    payload: Mapped[str | None] = mapped_column(Text)  # canonical JSON, hashed by chain
    prev_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    row_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
