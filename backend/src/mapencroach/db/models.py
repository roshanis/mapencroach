"""Schema v1: jurisdiction tree, parcels with boundary grades, audit log.

Enums use native_enum=False (CHECK constraints) so the schema stays
portable between PostGIS and test databases.
"""

import datetime

from geoalchemy2 import Geometry
from sqlalchemy import DateTime, Enum, ForeignKey, String, Text, func
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
