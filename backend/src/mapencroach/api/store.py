"""In-memory data store for the API layer.

Design note: this dict-based store exists so the API/auth/case-engine
wiring can be built and tested without standing up PostGIS. It exposes
the shape a persistent backend needs to support — jurisdiction tree,
parcels, alerts, cases, audit chain — behind plain attributes. A
PostGIS-backed implementation (SQLAlchemy models already exist in
mapencroach.db.models) is meant to replace this class behind the same
interface later; callers should depend only on the attributes/methods
documented here, not on dict internals.
"""

from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any

from mapencroach.audit.chain import AuditEntry, append_entry
from mapencroach.domain.alerts import AlertTier, severity_score
from mapencroach.domain.case_engine import Case, CaseState, transition
from mapencroach.domain.jurisdiction import JurisdictionTree

# Bhopal-area anchor for synthetic demo parcels.
_BHOPAL_LON = 77.40
_BHOPAL_LAT = 23.25
_PARCEL_SIZE_DEG = 0.001  # ~110m square at this latitude


def _square_polygon(center_lon: float, center_lat: float, half_size: float) -> dict[str, Any]:
    return {
        "type": "Polygon",
        "coordinates": [
            [
                [center_lon - half_size, center_lat - half_size],
                [center_lon + half_size, center_lat - half_size],
                [center_lon + half_size, center_lat + half_size],
                [center_lon - half_size, center_lat + half_size],
                [center_lon - half_size, center_lat - half_size],
            ]
        ],
    }


@dataclass
class CaseRecord:
    """A case plus the alert/parcel it traces back to (for jurisdiction scoping)."""

    case: Case
    alert_id: str
    parcel_id: str
    jurisdiction_id: str


@dataclass
class Store:
    """Mutable in-memory data store shared across a single app instance."""

    jurisdiction_rows: list[tuple[str, str | None]] = field(default_factory=list)
    parcels: dict[str, dict[str, Any]] = field(default_factory=dict)
    alerts: dict[str, dict[str, Any]] = field(default_factory=dict)
    cases: dict[str, CaseRecord] = field(default_factory=dict)
    audit_chain: list[AuditEntry] = field(default_factory=list)

    root_jurisdiction_id: str = "state"
    district_a_id: str = "dist-a"
    district_b_id: str = "dist-b"

    _next_alert_seq: int = 0
    _next_case_seq: int = 0

    def __post_init__(self) -> None:
        self._tree: JurisdictionTree | None = None
        if self.jurisdiction_rows:
            self._tree = JurisdictionTree(self.jurisdiction_rows)

    @property
    def tree(self) -> JurisdictionTree:
        if self._tree is None:
            raise RuntimeError("jurisdiction tree not initialized")
        return self._tree

    @property
    def dist_a_scope(self) -> set[str]:
        return self.tree.scope_ids(self.district_a_id)

    @property
    def dist_b_scope(self) -> set[str]:
        return self.tree.scope_ids(self.district_b_id)

    def record_audit(self, *, actor: str, action: str, object_type: str, object_id: str) -> None:
        append_entry(
            self.audit_chain,
            {
                "actor": actor,
                "action": action,
                "object_type": object_type,
                "object_id": object_id,
            },
        )

    def next_alert_id(self) -> str:
        self._next_alert_seq += 1
        return f"alert-{self._next_alert_seq}"

    def next_case_id(self) -> str:
        self._next_case_seq += 1
        return f"case-{self._next_case_seq}"

    @classmethod
    def seed_demo(cls) -> "Store":
        """Build a demo store: state -> 2 districts -> taluks, 8 parcels, 4 alerts, 2 cases."""
        rows: list[tuple[str, str | None]] = [
            ("state", None),
            ("dist-a", "state"),
            ("dist-b", "state"),
            ("taluk-a1", "dist-a"),
            ("taluk-a2", "dist-a"),
            ("taluk-b1", "dist-b"),
            ("taluk-b2", "dist-b"),
        ]
        store = cls(jurisdiction_rows=rows)

        parcel_specs = [
            ("parcel-1", "SN-101", "taluk-a1", "waterbody", "A"),
            ("parcel-2", "SN-102", "taluk-a1", "revenue", "B"),
            ("parcel-3", "SN-103", "taluk-a2", "forest", "C"),
            ("parcel-4", "SN-104", "taluk-a2", "municipal", "A"),
            ("parcel-5", "SN-105", "taluk-b1", "housing", "B"),
            ("parcel-6", "SN-106", "taluk-b1", "irrigation", "A"),
            ("parcel-7", "SN-107", "taluk-b2", "industrial", "C"),
            ("parcel-8", "SN-108", "taluk-b2", "revenue", "B"),
        ]
        for i, (parcel_id, survey_no, jurisdiction_id, land_category, boundary_grade) in enumerate(
            parcel_specs
        ):
            offset = i * _PARCEL_SIZE_DEG * 3
            geometry = _square_polygon(
                _BHOPAL_LON + offset, _BHOPAL_LAT + offset, _PARCEL_SIZE_DEG / 2
            )
            store.parcels[parcel_id] = {
                "id": parcel_id,
                "survey_no": survey_no,
                "ulpin": f"UL{i:010d}IN",
                "owning_department": "Revenue Department",
                "land_category": land_category,
                "boundary_grade": boundary_grade,
                "jurisdiction_id": jurisdiction_id,
                "geometry": geometry,
            }

        store.record_audit(
            actor="system", action="parcel.seed", object_type="parcel", object_id="bulk"
        )

        alert_specs = [
            ("parcel-1", AlertTier.RED, 6000.0, "OPEN"),
            ("parcel-3", AlertTier.AMBER, 3000.0, "OPEN"),
            ("parcel-5", AlertTier.GREEN, 500.0, "RESOLVED"),
            ("parcel-7", AlertTier.LEGACY, 8000.0, "OPEN"),
        ]
        alert_ids: list[str] = []
        detected_at = datetime(2026, 1, 15, tzinfo=UTC)
        for parcel_id, tier, area_m2, status in alert_specs:
            parcel = store.parcels[parcel_id]
            alert_id = store.next_alert_id()
            score = severity_score(
                area_m2, parcel["land_category"], parcel["boundary_grade"], False
            )
            store.alerts[alert_id] = {
                "id": alert_id,
                "parcel_id": parcel_id,
                "tier": tier.value,
                "severity_score": score,
                "area_m2": area_m2,
                "status": status,
                "detected_at": detected_at.isoformat(),
            }
            alert_ids.append(alert_id)
            store.record_audit(
                actor="system", action="alert.seed", object_type="alert", object_id=alert_id
            )

        # Case 1: alert-1 (parcel-1, dist-a) advanced to SHOW_CAUSE_ISSUED with full history.
        case1_alert_id = alert_ids[0]
        case1_parcel_id = store.alerts[case1_alert_id]["parcel_id"]
        case1_id = store.next_case_id()
        case1 = Case(case_id=case1_id, state=CaseState.NEW)
        t0 = datetime(2026, 1, 16, tzinfo=UTC)
        _advance(case1, CaseState.TRIAGED, "system", t0, {"triage_note": "high severity RED alert"})
        _advance(
            case1,
            CaseState.INSPECTION_ASSIGNED,
            "system",
            t0,
            {"inspector_id": "inspector-1"},
        )
        _advance(
            case1,
            CaseState.INSPECTED,
            "inspector-1",
            t0,
            {"inspection_report": "report-001.pdf"},
        )
        _advance(
            case1,
            CaseState.SHOW_CAUSE_ISSUED,
            "system",
            t0,
            {"notice_document": "notice-001.pdf", "dispatch_proof": "dispatch-001.pdf"},
        )
        store.cases[case1_id] = CaseRecord(
            case=case1,
            alert_id=case1_alert_id,
            parcel_id=case1_parcel_id,
            jurisdiction_id=store.parcels[case1_parcel_id]["jurisdiction_id"],
        )
        store.record_audit(
            actor="system", action="case.seed", object_type="case", object_id=case1_id
        )

        # Case 2: alert-3 (parcel-5, dist-b) fast-tracked through to a closed/dismissed state.
        case2_alert_id = alert_ids[2]
        case2_parcel_id = store.alerts[case2_alert_id]["parcel_id"]
        case2_id = store.next_case_id()
        case2 = Case(case_id=case2_id, state=CaseState.NEW)
        t1 = datetime(2025, 12, 1, tzinfo=UTC)
        _advance(case2, CaseState.TRIAGED, "system", t1, {"triage_note": "minor green alert"})
        _advance(
            case2,
            CaseState.INSPECTION_ASSIGNED,
            "system",
            t1,
            {"inspector_id": "inspector-2"},
        )
        _advance(
            case2,
            CaseState.INSPECTED,
            "inspector-2",
            t1,
            {"inspection_report": "report-002.pdf"},
        )
        _advance(
            case2,
            CaseState.SHOW_CAUSE_ISSUED,
            "system",
            t1,
            {"notice_document": "notice-002.pdf", "dispatch_proof": "dispatch-002.pdf"},
        )
        _advance(case2, CaseState.RESPONSE_WINDOW, "system", t1, {})
        _advance(
            case2,
            CaseState.HEARING_SCHEDULED,
            "system",
            t1,
            {"hearing_date": "2025-12-10"},
        )
        _advance(
            case2,
            CaseState.HEARING_HELD,
            "legal-officer-1",
            t1,
            {"hearing_record": "hearing-002.pdf"},
        )
        _advance(
            case2,
            CaseState.ORDER_ISSUED,
            "legal-officer-1",
            t1,
            {"reasoned_order": "order-002.pdf"},
        )
        _advance(
            case2,
            CaseState.ACTION_TAKEN,
            "system",
            t1,
            {"action_report": "action-002.pdf"},
        )
        _advance(case2, CaseState.CLOSED, "system", t1, {"closure_note": "resolved, case closed"})
        store.cases[case2_id] = CaseRecord(
            case=case2,
            alert_id=case2_alert_id,
            parcel_id=case2_parcel_id,
            jurisdiction_id=store.parcels[case2_parcel_id]["jurisdiction_id"],
        )
        store.record_audit(
            actor="system", action="case.seed", object_type="case", object_id=case2_id
        )

        return store


def _advance(
    case: Case,
    to_state: CaseState,
    actor: str,
    occurred_at: datetime,
    artifacts: dict[str, str],
) -> None:
    transition(case, to_state, actor, occurred_at, artifacts=artifacts)
