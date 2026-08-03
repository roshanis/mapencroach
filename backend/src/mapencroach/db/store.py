"""SQLAlchemy-backed store implementing the same interface as api.store.Store.

The API layer depends only on the store interface (mapping-style reads
plus explicit mutation methods), so this class is a drop-in replacement
for the in-memory store: PostGIS in production, plain SQLite in tests —
GeoJSONGeometry makes the geometry columns portable between the two.

Reads return plain-dict snapshots (the same shapes the in-memory store
holds); mutations are real writes. Schema creation is create_all via
init_db — Alembic migrations arrive with the first live PostGIS
deployment, when there is a database whose history must be preserved.
"""

import json
import os
import re
from datetime import UTC, datetime
from types import MappingProxyType
from typing import Any

from sqlalchemy import Engine, create_engine, select
from sqlalchemy.orm import Session, sessionmaker

from mapencroach.api.store import JURISDICTION_NAMES, CaseRecord, Store
from mapencroach.audit.chain import GENESIS_HASH, AuditEntry, compute_row_hash
from mapencroach.db import models
from mapencroach.domain.case_engine import Case, CaseEvent, CaseState, transition
from mapencroach.domain.geography import ParcelAlias, ParcelContext
from mapencroach.domain.jurisdiction import JurisdictionTree

_DEFAULT_LEVELS = "state,district,taluk,village"

_ID_SEQ = re.compile(r"^[a-z]+-(\d+)$")


def jurisdiction_levels() -> list[str]:
    """Depth-ordered level names for this deployment.

    MAPENCROACH_JURISDICTION_LEVELS is a comma-separated list, shallowest
    first — e.g. "authority,zone,ward" for a development authority.
    """
    raw = os.environ.get("MAPENCROACH_JURISDICTION_LEVELS", _DEFAULT_LEVELS)
    return [name.strip() for name in raw.split(",") if name.strip()]


def _utc(value: datetime) -> datetime:
    """SQLite drops tzinfo on storage; every stored timestamp is UTC by contract."""
    return value if value.tzinfo is not None else value.replace(tzinfo=UTC)


def init_db(engine: Engine) -> None:
    models.Base.metadata.create_all(engine)


def database_is_empty(engine: Engine) -> bool:
    with Session(engine) as session:
        return session.execute(select(models.Jurisdiction.id).limit(1)).first() is None


def seed_demo_database(engine: Engine) -> None:
    """Populate the database with exactly the in-memory demo dataset.

    Copying from Store.seed_demo() keeps a single source of truth for the
    demo: both stores serve byte-identical API responses.
    """
    mem = Store.seed_demo()
    levels = jurisdiction_levels()

    parent_of = dict(mem.jurisdiction_rows)
    depth_of: dict[str, int] = {}

    def _depth(node_id: str) -> int:
        if node_id not in depth_of:
            parent = parent_of[node_id]
            depth_of[node_id] = 0 if parent is None else _depth(parent) + 1
        return depth_of[node_id]

    with Session(engine) as session:
        needed_depths = sorted({_depth(node_id) for node_id, _ in mem.jurisdiction_rows})
        for depth in needed_depths:
            name = levels[depth] if depth < len(levels) else f"level-{depth}"
            session.add(models.JurisdictionLevel(name=name, depth=depth))

        for node_id, parent_id in mem.jurisdiction_rows:
            depth = _depth(node_id)
            session.add(
                models.Jurisdiction(
                    id=node_id,
                    parent_id=parent_id,
                    name=JURISDICTION_NAMES.get(node_id, node_id),
                    level=levels[depth] if depth < len(levels) else f"level-{depth}",
                )
            )

        for parcel in mem.parcels.values():
            session.add(
                models.Parcel(
                    id=parcel["id"],
                    survey_no=parcel["survey_no"],
                    ulpin=parcel["ulpin"],
                    owning_department=parcel["owning_department"],
                    land_category=parcel["land_category"],
                    boundary_grade=parcel["boundary_grade"],
                    jurisdiction_id=parcel["jurisdiction_id"],
                    geometry=parcel["geometry"],
                )
            )
            for tag in parcel.get("tags", []):
                session.add(models.ParcelTag(parcel_id=parcel["id"], tag=tag))

        for parcel_id, context in mem.parcel_contexts.items():
            session.add(
                models.ParcelContextSnapshot(
                    parcel_id=parcel_id, context=json.dumps(context.to_dict())
                )
            )

        for alert in mem.alerts.values():
            session.add(
                models.Alert(
                    id=alert["id"],
                    parcel_id=alert["parcel_id"],
                    tier=alert["tier"],
                    severity_score=alert["severity_score"],
                    area_m2=alert["area_m2"],
                    status=alert["status"],
                    detected_at=datetime.fromisoformat(alert["detected_at"]),
                )
            )

        for record in mem.cases.values():
            case = record.case
            session.add(
                models.CaseRow(
                    id=case.case_id,
                    alert_id=record.alert_id,
                    parcel_id=record.parcel_id,
                    jurisdiction_id=record.jurisdiction_id,
                    state=case.state.value,
                    paused_state=case.paused_state.value if case.paused_state else None,
                    opened_at=case.events[0].occurred_at if case.events else datetime.now(UTC),
                )
            )
            for seq, event in enumerate(case.events):
                session.add(
                    models.CaseEventRow(
                        case_id=case.case_id,
                        seq=seq,
                        from_state=event.from_state.value,
                        to_state=event.to_state.value,
                        actor=event.actor,
                        occurred_at=event.occurred_at,
                        artifacts=json.dumps(dict(event.artifacts)),
                        note=event.note,
                    )
                )

        for entry in mem.audit_chain:
            session.add(
                models.AuditLog(
                    actor=str(entry.payload.get("actor", "")),
                    action=str(entry.payload.get("action", "")),
                    object_type=str(entry.payload.get("object_type", "")),
                    object_id=str(entry.payload.get("object_id", "")),
                    payload=json.dumps(entry.payload, sort_keys=True),
                    prev_hash=entry.prev_hash,
                    row_hash=entry.row_hash,
                )
            )

        session.commit()


def create_database_store(db_url: str, demo: bool = False) -> "DatabaseStore":
    """Engine + schema + (optionally) demo seed, in one call for app wiring."""
    engine = create_engine(db_url)
    init_db(engine)
    if demo and database_is_empty(engine):
        seed_demo_database(engine)
    return DatabaseStore(engine)


class DatabaseStore:
    """Persistent store; see module docstring for the interface contract."""

    def __init__(self, engine: Engine) -> None:
        self._engine = engine
        self._session_factory = sessionmaker(engine)
        self._tree: JurisdictionTree | None = None
        self._rows: list[tuple[str, str | None]] | None = None

    # -- jurisdictions -------------------------------------------------

    @property
    def jurisdiction_rows(self) -> list[tuple[str, str | None]]:
        if self._rows is None:
            with self._session_factory() as session:
                rows = session.execute(
                    select(models.Jurisdiction.id, models.Jurisdiction.parent_id)
                ).all()
            if rows:
                self._rows = [(row[0], row[1]) for row in rows]
        if self._rows is None:
            raise RuntimeError("jurisdiction tree not initialized")
        return self._rows

    @property
    def tree(self) -> JurisdictionTree:
        if self._tree is None:
            self._tree = JurisdictionTree(self.jurisdiction_rows)
        return self._tree

    @property
    def root_jurisdiction_id(self) -> str:
        roots = [node_id for node_id, parent_id in self.jurisdiction_rows if parent_id is None]
        return roots[0]

    def _root_children(self) -> list[str]:
        root = self.root_jurisdiction_id
        return sorted(
            node_id for node_id, parent_id in self.jurisdiction_rows if parent_id == root
        )

    @property
    def district_a_id(self) -> str:
        return self._root_children()[0]

    @property
    def district_b_id(self) -> str:
        return self._root_children()[1]

    @property
    def dist_a_scope(self) -> set[str]:
        return self.tree.scope_ids(self.district_a_id)

    @property
    def dist_b_scope(self) -> set[str]:
        return self.tree.scope_ids(self.district_b_id)

    # -- parcels -------------------------------------------------------

    def _parcel_dict(self, session: Session, row: models.Parcel) -> dict[str, Any]:
        tags = (
            session.execute(
                select(models.ParcelTag.tag)
                .where(models.ParcelTag.parcel_id == row.id)
                .order_by(models.ParcelTag.id)
            )
            .scalars()
            .all()
        )
        return {
            "id": row.id,
            "survey_no": row.survey_no,
            "ulpin": row.ulpin,
            "owning_department": row.owning_department,
            "land_category": row.land_category,
            "boundary_grade": row.boundary_grade,
            "jurisdiction_id": row.jurisdiction_id,
            "geometry": row.geometry,
            "tags": list(tags),
        }

    @property
    def parcels(self) -> dict[str, dict[str, Any]]:
        with self._session_factory() as session:
            rows = session.execute(select(models.Parcel)).scalars().all()
            return {row.id: self._parcel_dict(session, row) for row in rows}

    def set_boundary_grade(self, parcel_id: str, grade: str) -> dict[str, Any]:
        with self._session_factory() as session:
            row = session.get(models.Parcel, parcel_id)
            if row is None:
                raise KeyError(parcel_id)
            row.boundary_grade = grade
            session.commit()
            return self._parcel_dict(session, row)

    def add_parcel_tag(self, parcel_id: str, tag: str) -> tuple[dict[str, Any], bool]:
        with self._session_factory() as session:
            row = session.get(models.Parcel, parcel_id)
            if row is None:
                raise KeyError(parcel_id)
            existing = session.execute(
                select(models.ParcelTag).where(
                    models.ParcelTag.parcel_id == parcel_id, models.ParcelTag.tag == tag
                )
            ).first()
            if existing is not None:
                return self._parcel_dict(session, row), False
            session.add(models.ParcelTag(parcel_id=parcel_id, tag=tag))
            session.commit()
            return self._parcel_dict(session, row), True

    def remove_parcel_tag(self, parcel_id: str, tag: str) -> dict[str, Any] | None:
        with self._session_factory() as session:
            row = session.get(models.Parcel, parcel_id)
            if row is None:
                raise KeyError(parcel_id)
            existing = (
                session.execute(
                    select(models.ParcelTag).where(
                        models.ParcelTag.parcel_id == parcel_id, models.ParcelTag.tag == tag
                    )
                )
                .scalars()
                .first()
            )
            if existing is None:
                return None
            session.delete(existing)
            session.commit()
            return self._parcel_dict(session, row)

    def context_for_parcel(self, parcel_id: str) -> ParcelContext:
        with self._session_factory() as session:
            parcel = session.get(models.Parcel, parcel_id)
            if parcel is None:
                raise KeyError(parcel_id)
            aliases = tuple(
                ParcelAlias(
                    scheme=scheme,
                    value=value,
                    source="Illustrative demo parcel register",
                    valid_from=None,
                    valid_to=None,
                    match_method="authoritative_identifier",
                    confidence=1.0,
                )
                for scheme, value in (
                    ("survey_no", parcel.survey_no),
                    ("ULPIN", parcel.ulpin),
                )
                if value
            )
            snapshot = session.get(models.ParcelContextSnapshot, parcel_id)
        if snapshot is not None:
            stored = ParcelContext.from_dict(json.loads(snapshot.context))
            return ParcelContext(
                parcel_id=stored.parcel_id,
                canonical_id=stored.canonical_id,
                aliases=aliases,
                lineage=stored.lineage,
                geographic_links=stored.geographic_links,
                observations=stored.observations,
                sources=stored.sources,
            )
        return ParcelContext(
            parcel_id=parcel_id,
            canonical_id=parcel_id,
            aliases=aliases,
            lineage=(),
            geographic_links=(),
            observations=(),
            sources=(),
        )

    # -- alerts --------------------------------------------------------

    @staticmethod
    def _alert_dict(row: models.Alert) -> dict[str, Any]:
        return {
            "id": row.id,
            "parcel_id": row.parcel_id,
            "tier": row.tier,
            "severity_score": row.severity_score,
            "area_m2": row.area_m2,
            "status": row.status,
            "detected_at": _utc(row.detected_at).isoformat(),
        }

    @property
    def alerts(self) -> dict[str, dict[str, Any]]:
        with self._session_factory() as session:
            rows = session.execute(select(models.Alert)).scalars().all()
            return {row.id: self._alert_dict(row) for row in rows}

    def _next_id(self, prefix: str, existing: list[str]) -> str:
        highest = 0
        for value in existing:
            match = _ID_SEQ.match(value)
            if match and value.startswith(f"{prefix}-"):
                highest = max(highest, int(match.group(1)))
        return f"{prefix}-{highest + 1}"

    def next_alert_id(self) -> str:
        with self._session_factory() as session:
            ids = session.execute(select(models.Alert.id)).scalars().all()
        return self._next_id("alert", list(ids))

    def next_case_id(self) -> str:
        with self._session_factory() as session:
            ids = session.execute(select(models.CaseRow.id)).scalars().all()
        return self._next_id("case", list(ids))

    def save_alert(self, alert: dict[str, Any]) -> None:
        with self._session_factory() as session:
            session.add(
                models.Alert(
                    id=alert["id"],
                    parcel_id=alert["parcel_id"],
                    tier=alert["tier"],
                    severity_score=alert["severity_score"],
                    area_m2=alert["area_m2"],
                    status=alert["status"],
                    detected_at=datetime.fromisoformat(alert["detected_at"]),
                )
            )
            session.commit()

    # -- cases ---------------------------------------------------------

    def _case_record(self, session: Session, row: models.CaseRow) -> CaseRecord:
        event_rows = (
            session.execute(
                select(models.CaseEventRow)
                .where(models.CaseEventRow.case_id == row.id)
                .order_by(models.CaseEventRow.seq)
            )
            .scalars()
            .all()
        )
        case = Case(
            case_id=row.id,
            state=CaseState(row.state),
            events=[
                CaseEvent(
                    from_state=CaseState(e.from_state),
                    to_state=CaseState(e.to_state),
                    actor=e.actor,
                    artifacts=MappingProxyType(json.loads(e.artifacts)),
                    note=e.note,
                    occurred_at=_utc(e.occurred_at),
                )
                for e in event_rows
            ],
            paused_state=CaseState(row.paused_state) if row.paused_state else None,
        )
        return CaseRecord(
            case=case,
            alert_id=row.alert_id,
            parcel_id=row.parcel_id,
            jurisdiction_id=row.jurisdiction_id,
        )

    @property
    def cases(self) -> dict[str, CaseRecord]:
        with self._session_factory() as session:
            rows = session.execute(select(models.CaseRow)).scalars().all()
            return {row.id: self._case_record(session, row) for row in rows}

    def transition_case(
        self,
        case_id: str,
        to_state: CaseState,
        actor: str,
        occurred_at: datetime,
        artifacts: dict[str, str] | None,
        note: str,
    ) -> tuple[CaseRecord, CaseEvent]:
        with self._session_factory() as session:
            row = session.get(models.CaseRow, case_id)
            if row is None:
                raise KeyError(case_id)
            record = self._case_record(session, row)
            # The domain engine validates and computes the event; raises
            # InvalidTransition/MissingArtifact with nothing persisted.
            event = transition(
                record.case,
                to_state,
                actor=actor,
                occurred_at=occurred_at,
                artifacts=artifacts,
                note=note,
            )
            row.state = record.case.state.value
            row.paused_state = (
                record.case.paused_state.value if record.case.paused_state else None
            )
            session.add(
                models.CaseEventRow(
                    case_id=case_id,
                    seq=len(record.case.events) - 1,
                    from_state=event.from_state.value,
                    to_state=event.to_state.value,
                    actor=event.actor,
                    occurred_at=event.occurred_at,
                    artifacts=json.dumps(dict(event.artifacts)),
                    note=event.note,
                )
            )
            session.commit()
            return record, event

    # -- audit ---------------------------------------------------------

    @property
    def audit_chain(self) -> list[AuditEntry]:
        with self._session_factory() as session:
            rows = (
                session.execute(select(models.AuditLog).order_by(models.AuditLog.id))
                .scalars()
                .all()
            )
        return [
            AuditEntry(
                payload=json.loads(row.payload) if row.payload else {},
                prev_hash=row.prev_hash,
                row_hash=row.row_hash,
            )
            for row in rows
        ]

    def record_audit(self, *, actor: str, action: str, object_type: str, object_id: str) -> None:
        payload = {
            "actor": actor,
            "action": action,
            "object_type": object_type,
            "object_id": object_id,
        }
        with self._session_factory() as session:
            last = (
                session.execute(select(models.AuditLog).order_by(models.AuditLog.id.desc()))
                .scalars()
                .first()
            )
            prev_hash = last.row_hash if last is not None else GENESIS_HASH
            session.add(
                models.AuditLog(
                    actor=actor,
                    action=action,
                    object_type=object_type,
                    object_id=object_id,
                    payload=json.dumps(payload, sort_keys=True),
                    prev_hash=prev_hash,
                    row_hash=compute_row_hash(payload, prev_hash),
                )
            )
            session.commit()
