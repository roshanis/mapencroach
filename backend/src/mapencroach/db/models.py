"""Schema v1: jurisdiction tree, parcels, alerts, cases, imagery, evidence, audit log.

Enums use native_enum=False (CHECK constraints) so the schema stays
portable between PostGIS and test databases; geometry columns use
GeoJSONGeometry for the same reason (PostGIS geometry on PostgreSQL,
GeoJSON text elsewhere).
"""

import datetime

from sqlalchemy import (
    Boolean,
    Date,
    DateTime,
    Enum,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

from mapencroach.db.types import GeoJSONGeometry


class Base(DeclarativeBase):
    pass


class JurisdictionLevel(Base):
    """Per-deployment hierarchy vocabulary, ordered by depth.

    A revenue deployment seeds state/district/taluk/village; a development
    authority seeds authority/zone/ward. Keeping levels as data instead of
    an enum is what lets one schema serve both.
    """

    __tablename__ = "jurisdiction_level"

    name: Mapped[str] = mapped_column(String(64), primary_key=True)
    depth: Mapped[int] = mapped_column(Integer, nullable=False, unique=True)


class Jurisdiction(Base):
    __tablename__ = "jurisdiction"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    parent_id: Mapped[str | None] = mapped_column(ForeignKey("jurisdiction.id"), nullable=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    level: Mapped[str] = mapped_column(ForeignKey("jurisdiction_level.name"), nullable=False)
    # Optional boundary so zone/ward polygons (requisition §3.4) are drawable.
    geometry = mapped_column(GeoJSONGeometry("MULTIPOLYGON", 4326), nullable=True)


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
    geometry = mapped_column(GeoJSONGeometry("MULTIPOLYGON", 4326), nullable=False)


class ParcelTag(Base):
    """Officer-applied working labels on a parcel (e.g. court-monitored)."""

    __tablename__ = "parcel_tag"
    __table_args__ = (UniqueConstraint("parcel_id", "tag", name="uq_parcel_tag"),)

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    parcel_id: Mapped[str] = mapped_column(ForeignKey("parcel.id"), nullable=False)
    tag: Mapped[str] = mapped_column(String(40), nullable=False)


class ParcelH3(Base):
    """H3 cells covering a parcel, per resolution — the portable spatial index.

    A cell id is just a string, so cell-window lookups ("parcels in this
    hex") cost one indexed equality query on SQLite and PostGIS alike.
    Derived data: rebuilt from parcel geometry at any time; the geometry
    stays the legal authority.
    """

    __tablename__ = "parcel_h3"
    __table_args__ = (
        UniqueConstraint("parcel_id", "resolution", "cell", name="uq_parcel_h3"),
        Index("ix_parcel_h3_res_cell", "resolution", "cell"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    parcel_id: Mapped[str] = mapped_column(ForeignKey("parcel.id"), nullable=False)
    resolution: Mapped[int] = mapped_column(Integer, nullable=False)
    cell: Mapped[str] = mapped_column(String(16), nullable=False)


class ParcelContextSnapshot(Base):
    """Read-model for GET /parcels/{id}/context: the ParcelContext dict as JSON.

    The normalized context tables below remain the ingest target; this
    snapshot is what the API serves, refreshed whenever context is
    (re)imported for a parcel.
    """

    __tablename__ = "parcel_context_snapshot"

    parcel_id: Mapped[str] = mapped_column(ForeignKey("parcel.id"), primary_key=True)
    context: Mapped[str] = mapped_column(Text, nullable=False)  # ParcelContext.to_dict() JSON


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
    geometry = mapped_column(GeoJSONGeometry("MULTIPOLYGON", 4326), nullable=True)


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


class ImageryScene(Base):
    """A registered satellite/drone scene; hashes anchor the evidence chain.

    sidecar_raw preserves the delivered Cartosat metadata file (.txt/.xml)
    byte-for-byte — courts get the original, never our parse of it.
    """

    __tablename__ = "imagery_scene"

    scene_id: Mapped[str] = mapped_column(String(200), primary_key=True)
    sha256: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    cog_sha256: Mapped[str | None] = mapped_column(String(64))
    captured_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    sensor: Mapped[str] = mapped_column(String(100), nullable=False)
    resolution_m: Mapped[float] = mapped_column(Float, nullable=False)
    cloud_pct: Mapped[float] = mapped_column(Float, nullable=False)
    source: Mapped[str] = mapped_column(String(100), nullable=False)
    href: Mapped[str] = mapped_column(Text, nullable=False)
    stac_item: Mapped[str] = mapped_column(Text, nullable=False)  # STAC item JSON
    sidecar_raw: Mapped[str | None] = mapped_column(Text)
    sidecar_sha256: Mapped[str | None] = mapped_column(String(64))
    # RMSE (meters) against ground control points after orthorectification;
    # recorded per scene so accuracy claims in court are measured, not asserted.
    ortho_rmse_m: Mapped[float | None] = mapped_column(Float)
    ingested_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class GroundControlPoint(Base):
    """A DGPS-surveyed geodetic reference point (requisition §3.3).

    GCPs anchor orthorectification QC: each scene's residual error is
    measured against these, giving an honest per-scene accuracy figure
    instead of the requisition's impossible "zero-margin" claim.
    """

    __tablename__ = "ground_control_point"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    geometry = mapped_column(GeoJSONGeometry("POINT", 4326), nullable=False)
    elevation_m: Mapped[float | None] = mapped_column(Float)
    accuracy_m: Mapped[float] = mapped_column(Float, nullable=False)
    surveyed_on: Mapped[datetime.date] = mapped_column(Date, nullable=False)
    source: Mapped[str] = mapped_column(String(200), nullable=False)


class BaselineDeclaration(Base):
    """The declared legal baseline for an AOI: date + pinned, hashed scene set.

    Everything before the baseline is legacy (LEGACY tier, political/legal
    routing); the detection engine only ever asserts post-baseline change.
    Declarations are append-only — a new declaration supersedes, never
    edits, and each is anchored in the audit chain.
    """

    __tablename__ = "baseline_declaration"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    aoi_jurisdiction_id: Mapped[str] = mapped_column(
        ForeignKey("jurisdiction.id"), nullable=False
    )
    baseline_date: Mapped[datetime.date] = mapped_column(Date, nullable=False)
    declared_by: Mapped[str] = mapped_column(String(64), nullable=False)
    declared_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    scene_ids: Mapped[str] = mapped_column(Text, nullable=False)  # JSON list
    scene_hashes: Mapped[str] = mapped_column(Text, nullable=False)  # JSON list
    note: Mapped[str] = mapped_column(Text, nullable=False, default="")


class DetectionRun(Base):
    """One execution of the change-screening pipeline; every alert traces to a run."""

    __tablename__ = "detection_run"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    model_version: Mapped[str] = mapped_column(String(100), nullable=False)
    aoi_jurisdiction_id: Mapped[str] = mapped_column(
        ForeignKey("jurisdiction.id"), nullable=False
    )
    params: Mapped[str | None] = mapped_column(Text)  # JSON
    status: Mapped[str] = mapped_column(
        Enum("RUNNING", "SUCCEEDED", "FAILED", name="detection_run_status", native_enum=False),
        nullable=False,
    )
    started_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    finished_at: Mapped[datetime.datetime | None] = mapped_column(DateTime(timezone=True))


class DetectionCandidate(Base):
    """A single-run change observation on a parcel.

    Candidates are not alerts: the persistence rule (PLAN §2.4) requires
    the same parcel to recur across runs before an alert exists, so
    one-off satellite artifacts die here instead of wasting an officer's
    trust.
    """

    __tablename__ = "detection_candidate"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    detection_run_id: Mapped[int] = mapped_column(
        ForeignKey("detection_run.id"), nullable=False
    )
    parcel_id: Mapped[str] = mapped_column(ForeignKey("parcel.id"), nullable=False)
    observed_on: Mapped[datetime.date] = mapped_column(Date, nullable=False)
    changed_area_m2: Mapped[float] = mapped_column(Float, nullable=False)
    stats: Mapped[str] = mapped_column(Text, nullable=False)  # screening stats JSON
    change_geometry: Mapped[str | None] = mapped_column(Text)  # GeoJSON (WGS84)
    promoted_alert_id: Mapped[str | None] = mapped_column(ForeignKey("alert.id"))


class Alert(Base):
    __tablename__ = "alert"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    parcel_id: Mapped[str] = mapped_column(ForeignKey("parcel.id"), nullable=False)
    # Nullable: officers may raise alerts manually; automated ones trace to a run.
    detection_run_id: Mapped[int | None] = mapped_column(ForeignKey("detection_run.id"))
    tier: Mapped[str] = mapped_column(
        Enum("GREEN", "AMBER", "RED", "LEGACY", name="alert_tier", native_enum=False),
        nullable=False,
    )
    severity_score: Mapped[float] = mapped_column(Float, nullable=False)
    area_m2: Mapped[float] = mapped_column(Float, nullable=False)
    status: Mapped[str] = mapped_column(
        Enum("OPEN", "UNDER_REVIEW", "ESCALATED", "CLOSED", name="alert_status",
             native_enum=False),
        nullable=False,
    )
    detected_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    # Shadow-mode alerts exist for precision measurement only and stay
    # invisible to officers until detection go-live (PLAN §5 field reality).
    shadow: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    # High-res confirmation outcome + Phase D enrichment flags, as JSON.
    confirmation: Mapped[str | None] = mapped_column(Text)
    enrichment: Mapped[str | None] = mapped_column(Text)
    # Field-verification verdict on a shadow alert (precision measurement), JSON.
    disposition: Mapped[str | None] = mapped_column(Text)


class CaseRow(Base):
    """Case header; the authoritative history lives in append-only case_event rows."""

    __tablename__ = "case"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    alert_id: Mapped[str] = mapped_column(ForeignKey("alert.id"), nullable=False)
    parcel_id: Mapped[str] = mapped_column(ForeignKey("parcel.id"), nullable=False)
    jurisdiction_id: Mapped[str] = mapped_column(ForeignKey("jurisdiction.id"), nullable=False)
    state: Mapped[str] = mapped_column(String(40), nullable=False)
    paused_state: Mapped[str | None] = mapped_column(String(40))
    opened_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    sla_due: Mapped[datetime.datetime | None] = mapped_column(DateTime(timezone=True))


class CaseEventRow(Base):
    """Append-only transition log — the case engine's audit trail, never updated."""

    __tablename__ = "case_event"
    __table_args__ = (UniqueConstraint("case_id", "seq", name="uq_case_event_seq"),)

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    case_id: Mapped[str] = mapped_column(ForeignKey("case.id"), nullable=False)
    seq: Mapped[int] = mapped_column(Integer, nullable=False)
    from_state: Mapped[str] = mapped_column(String(40), nullable=False)
    to_state: Mapped[str] = mapped_column(String(40), nullable=False)
    actor: Mapped[str] = mapped_column(String(64), nullable=False)
    occurred_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    artifacts: Mapped[str] = mapped_column(Text, nullable=False)  # JSON name -> reference
    note: Mapped[str] = mapped_column(Text, nullable=False, default="")


class Inspection(Base):
    __tablename__ = "inspection"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    case_id: Mapped[str] = mapped_column(ForeignKey("case.id"), nullable=False)
    inspector_id: Mapped[str] = mapped_column(String(64), nullable=False)
    started_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    ended_at: Mapped[datetime.datetime | None] = mapped_column(DateTime(timezone=True))
    gps_track: Mapped[str | None] = mapped_column(Text)  # GeoJSON LineString
    form: Mapped[str | None] = mapped_column(Text)  # guided inspection form JSON


class Media(Base):
    """A photo/video captured in the field; hashed on-device before upload."""

    __tablename__ = "media"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    inspection_id: Mapped[int | None] = mapped_column(ForeignKey("inspection.id"))
    case_id: Mapped[str | None] = mapped_column(ForeignKey("case.id"))
    sha256_at_capture: Mapped[str] = mapped_column(String(64), nullable=False)
    captured_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    gps_lat: Mapped[float | None] = mapped_column(Float)
    gps_lon: Mapped[float | None] = mapped_column(Float)
    device_id: Mapped[str | None] = mapped_column(String(100))
    storage_href: Mapped[str] = mapped_column(Text, nullable=False)


GIS_LAYER_KINDS = (
    "khasra",
    "plot_boundary",
    "property",
    "master_plan",
    "elu",
    "plu",
    "green_belt",
    "road",
    "water_body",
    "ward",
    "building_footprint",
    "approved_plan",
    "legacy_encroachment",
)


class GisLayer(Base):
    """One imported version of an authority GIS layer (requisition §3).

    Layers are context and verification data around the canonical parcel
    register — khasra maps, master plans, ELU/PLU zoning, green belts,
    road/water networks, approved building plans. Provenance is
    mandatory: an unattributed layer is not usable in enforcement.
    """

    __tablename__ = "gis_layer"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    kind: Mapped[str] = mapped_column(
        Enum(*GIS_LAYER_KINDS, name="gis_layer_kind", native_enum=False), nullable=False
    )
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    source: Mapped[str] = mapped_column(String(300), nullable=False)  # provenance
    version: Mapped[str] = mapped_column(String(100), nullable=False)
    imported_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class GisFeature(Base):
    __tablename__ = "gis_feature"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    layer_id: Mapped[int] = mapped_column(ForeignKey("gis_layer.id"), nullable=False)
    source_feature_id: Mapped[str] = mapped_column(String(100), nullable=False)
    # Generic geometry: polygons for zones/plans, lines for roads/canals.
    geometry = mapped_column(GeoJSONGeometry("GEOMETRY", 4326), nullable=False)
    attributes: Mapped[str] = mapped_column(Text, nullable=False, default="{}")  # JSON


class Survey(Base):
    """A ground survey (DGPS/ETS) result attached to a parcel.

    Surveys are how boundary grades improve: each upload compounds the
    map's quality permanently (PLAN persona P4).
    """

    __tablename__ = "survey"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    parcel_id: Mapped[str] = mapped_column(ForeignKey("parcel.id"), nullable=False)
    surveyor_id: Mapped[str] = mapped_column(String(64), nullable=False)
    survey_ref: Mapped[str] = mapped_column(String(100), nullable=False)
    method: Mapped[str] = mapped_column(
        Enum("DGPS", "ETS", "drone_rtk", name="survey_method", native_enum=False),
        nullable=False,
    )
    accuracy_m: Mapped[float] = mapped_column(Float, nullable=False)
    surveyed_on: Mapped[datetime.date] = mapped_column(Date, nullable=False)
    resulting_grade: Mapped[str] = mapped_column(String(1), nullable=False)
    uploaded_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class EvidencePacket(Base):
    """Assembled, hash-manifested evidence for a case; the PDF lives in WORM storage."""

    __tablename__ = "evidence_packet"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    case_id: Mapped[str] = mapped_column(ForeignKey("case.id"), nullable=False)
    manifest: Mapped[str] = mapped_column(Text, nullable=False)  # JSON of member hashes
    certificate_status: Mapped[str] = mapped_column(
        Enum("DRAFT", "PENDING_CERTIFICATION", "CERTIFIED",
             name="evidence_certificate_status", native_enum=False),
        nullable=False,
    )
    issued_by: Mapped[str | None] = mapped_column(String(64))
    issued_at: Mapped[datetime.datetime | None] = mapped_column(DateTime(timezone=True))
    storage_href: Mapped[str | None] = mapped_column(Text)
