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


# Human-readable names for seed jurisdiction ids. Ids are the stable API
# surface (tokens pin them); names are presentation only.
JURISDICTION_NAMES: dict[str, str] = {
    "state": "Haridwar–Roorkee Development Authority",
    "dist-a": "Haridwar Division",
    "dist-b": "Roorkee Division",
    "taluk-a1": "Haridwar City",
    "taluk-a2": "Kankhal",
    "taluk-a3": "Laksar",
    "taluk-b1": "Roorkee City",
    "taluk-b2": "Bahadarabad",
    "taluk-b3": "Narsan",
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
        """Build a demo store for the Haridwar–Roorkee Development Authority (HRDA)
        corridor: state -> 2 districts -> 6 named taluks, 30 parcels (5 per
        taluk), 10 alerts across every tier/status, 5 cases including two
        paused states. parcel-1..8 / alert-1..4 / case-1..2 are the original
        demo protagonists and must not change."""
        rows: list[tuple[str, str | None]] = [
            ("state", None),
            ("dist-a", "state"),
            ("dist-b", "state"),
            ("taluk-a1", "dist-a"),
            ("taluk-a2", "dist-a"),
            ("taluk-a3", "dist-a"),
            ("taluk-b1", "dist-b"),
            ("taluk-b2", "dist-b"),
            ("taluk-b3", "dist-b"),
        ]
        store = cls(jurisdiction_rows=rows)

        seed_tags = {
            "parcel-1": ["court-monitored"],
            "parcel-7": ["legacy-review"],
        }
        parcel_specs = [
            # Upper Ganga Canal bank, Haridwar
            ("parcel-1", "SN-101", "taluk-a1", "waterbody", "A", 78.145, 29.938),
            # Jwalapur
            ("parcel-2", "SN-102", "taluk-a1", "revenue", "B", 78.115, 29.915),
            # Rajaji National Park fringe
            ("parcel-3", "SN-103", "taluk-a2", "forest", "C", 78.190, 29.975),
            # Haridwar city core
            ("parcel-4", "SN-104", "taluk-a2", "municipal", "A", 78.160, 29.947),
            # Roorkee residential
            ("parcel-5", "SN-105", "taluk-b1", "housing", "B", 77.892, 29.860),
            # Upper Ganga Canal, Roorkee
            ("parcel-6", "SN-106", "taluk-b1", "irrigation", "A", 77.897, 29.872),
            # SIDCUL Haridwar
            ("parcel-7", "SN-107", "taluk-b2", "industrial", "C", 78.082, 29.963),
            # Bahadarabad
            ("parcel-8", "SN-108", "taluk-b2", "revenue", "B", 78.040, 29.918),
            # --- taluk-a1 (Haridwar City) fill ---
            ("parcel-9", "SN-109", "taluk-a1", "municipal", "B", 78.135, 29.945),
            ("parcel-10", "SN-110", "taluk-a1", "housing", "A", 78.125, 29.930),
            ("parcel-11", "SN-111", "taluk-a1", "waterbody", "B", 78.152, 29.928),
            # --- taluk-a2 (Kankhal) fill ---
            ("parcel-12", "SN-112", "taluk-a2", "irrigation", "B", 78.168, 29.958),
            ("parcel-13", "SN-113", "taluk-a2", "revenue", "C", 78.178, 29.940),
            ("parcel-14", "SN-114", "taluk-a2", "forest", "B", 78.205, 29.990),
            # --- taluk-a3 (Laksar) ---
            ("parcel-15", "SN-115", "taluk-a3", "revenue", "B", 78.055, 29.852),
            ("parcel-16", "SN-116", "taluk-a3", "irrigation", "A", 78.068, 29.845),
            ("parcel-17", "SN-117", "taluk-a3", "waterbody", "C", 78.082, 29.858),
            ("parcel-18", "SN-118", "taluk-a3", "housing", "B", 78.045, 29.838),
            ("parcel-19", "SN-119", "taluk-a3", "municipal", "C", 78.060, 29.865),
            # --- taluk-b1 (Roorkee City) fill ---
            ("parcel-20", "SN-120", "taluk-b1", "municipal", "A", 77.885, 29.868),
            ("parcel-21", "SN-121", "taluk-b1", "revenue", "C", 77.905, 29.855),
            ("parcel-22", "SN-122", "taluk-b1", "industrial", "B", 77.910, 29.878),
            # --- taluk-b2 (Bahadarabad) fill ---
            ("parcel-23", "SN-123", "taluk-b2", "irrigation", "A", 78.028, 29.930),
            ("parcel-24", "SN-124", "taluk-b2", "housing", "C", 78.060, 29.942),
            ("parcel-25", "SN-125", "taluk-b2", "forest", "B", 78.095, 29.975),
            # --- taluk-b3 (Narsan) ---
            ("parcel-26", "SN-126", "taluk-b3", "revenue", "B", 77.855, 29.835),
            ("parcel-27", "SN-127", "taluk-b3", "irrigation", "B", 77.870, 29.828),
            ("parcel-28", "SN-128", "taluk-b3", "housing", "A", 77.842, 29.845),
            ("parcel-29", "SN-129", "taluk-b3", "industrial", "C", 77.882, 29.840),
            ("parcel-30", "SN-130", "taluk-b3", "waterbody", "B", 77.862, 29.850),
        ]
        _OWNING_DEPARTMENTS = {
            "parcel-1": "Irrigation Department, Uttarakhand",
            "parcel-2": "Revenue Department",
            "parcel-3": "Forest Department, Uttarakhand",
            "parcel-4": "Nagar Nigam Haridwar",
            "parcel-5": "Haridwar-Roorkee Development Authority",
            "parcel-6": "Irrigation Department, Uttarakhand",
            "parcel-7": "SIDCUL",
            "parcel-8": "Revenue Department",
        }
        _DEPARTMENT_BY_CATEGORY = {
            "waterbody": "Irrigation Department, Uttarakhand",
            "irrigation": "Irrigation Department, Uttarakhand",
            "forest": "Forest Department, Uttarakhand",
            "municipal": "Nagar Nigam Haridwar",
            "housing": "Haridwar-Roorkee Development Authority",
            "industrial": "SIDCUL",
            "revenue": "Revenue Department",
        }
        for i, (
            parcel_id,
            survey_no,
            jurisdiction_id,
            land_category,
            boundary_grade,
            center_lon,
            center_lat,
        ) in enumerate(parcel_specs):
            geometry = _square_polygon(center_lon, center_lat, _PARCEL_SIZE_DEG / 2)
            store.parcels[parcel_id] = {
                "id": parcel_id,
                "survey_no": survey_no,
                "ulpin": f"UK{i:010d}HR",
                "owning_department": _OWNING_DEPARTMENTS.get(
                    parcel_id, _DEPARTMENT_BY_CATEGORY[land_category]
                ),
                "land_category": land_category,
                "boundary_grade": boundary_grade,
                "jurisdiction_id": jurisdiction_id,
                "geometry": geometry,
                "tags": list(seed_tags.get(parcel_id, [])),
            }

        store.record_audit(
            actor="system", action="parcel.seed", object_type="parcel", object_id="bulk"
        )

        alert_specs = [
            ("parcel-1", AlertTier.RED, 6000.0, "OPEN"),
            ("parcel-3", AlertTier.AMBER, 3000.0, "OPEN"),
            # CLOSED (not RESOLVED) so the console's status filter matches.
            ("parcel-5", AlertTier.GREEN, 500.0, "CLOSED"),
            ("parcel-7", AlertTier.LEGACY, 8000.0, "OPEN"),
            ("parcel-9", AlertTier.RED, 4500.0, "UNDER_REVIEW"),
            ("parcel-12", AlertTier.AMBER, 2000.0, "ESCALATED"),
            ("parcel-15", AlertTier.GREEN, 700.0, "OPEN"),
            ("parcel-20", AlertTier.AMBER, 2500.0, "OPEN"),
            ("parcel-23", AlertTier.RED, 5200.0, "OPEN"),
            ("parcel-26", AlertTier.LEGACY, 9000.0, "UNDER_REVIEW"),
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

        # Case 3: alert-5 (parcel-9) reached show-cause, then a court stay
        # froze the chain — resumes at SHOW_CAUSE_ISSUED when vacated.
        case3 = Case(case_id=store.next_case_id(), state=CaseState.NEW)
        t2 = datetime(2026, 2, 10, tzinfo=UTC)
        _advance(case3, CaseState.TRIAGED, "system", t2, {"triage_note": "red alert, SIDCUL-side"})
        _advance(
            case3, CaseState.INSPECTION_ASSIGNED, "system", t2, {"inspector_id": "inspector-3"}
        )
        _advance(
            case3, CaseState.INSPECTED, "inspector-3", t2, {"inspection_report": "report-003.pdf"}
        )
        _advance(
            case3,
            CaseState.SHOW_CAUSE_ISSUED,
            "system",
            t2,
            {"notice_document": "notice-003.pdf", "dispatch_proof": "dispatch-003.pdf"},
        )
        _advance(
            case3,
            CaseState.STAYED_BY_COURT,
            "legal-officer-1",
            datetime(2026, 2, 24, tzinfo=UTC),
            {"stay_order_ref": "WP-1204-2026 (Uttarakhand HC)"},
        )
        store.cases[case3.case_id] = CaseRecord(
            case=case3,
            alert_id="alert-5",
            parcel_id="parcel-9",
            jurisdiction_id=store.parcels["parcel-9"]["jurisdiction_id"],
        )
        store.record_audit(
            actor="system", action="case.seed", object_type="case", object_id=case3.case_id
        )

        # Case 4: alert-6 (parcel-12) — inspection disputed the boundary, so a
        # ground survey was requested; resumes at INSPECTED with the result.
        case4 = Case(case_id=store.next_case_id(), state=CaseState.NEW)
        t3 = datetime(2026, 3, 3, tzinfo=UTC)
        _advance(case4, CaseState.TRIAGED, "system", t3, {"triage_note": "amber alert, Kankhal"})
        _advance(
            case4, CaseState.INSPECTION_ASSIGNED, "system", t3, {"inspector_id": "inspector-2"}
        )
        _advance(
            case4, CaseState.INSPECTED, "inspector-2", t3, {"inspection_report": "report-004.pdf"}
        )
        _advance(
            case4,
            CaseState.SURVEY_REQUESTED,
            "inspector-2",
            datetime(2026, 3, 12, tzinfo=UTC),
            {"survey_request_ref": "SRV-2026-014"},
        )
        store.cases[case4.case_id] = CaseRecord(
            case=case4,
            alert_id="alert-6",
            parcel_id="parcel-12",
            jurisdiction_id=store.parcels["parcel-12"]["jurisdiction_id"],
        )
        store.record_audit(
            actor="system", action="case.seed", object_type="case", object_id=case4.case_id
        )

        # Case 5: alert-9 (parcel-23) — notice served, occupier's response
        # window is running.
        case5 = Case(case_id=store.next_case_id(), state=CaseState.NEW)
        t4 = datetime(2026, 4, 1, tzinfo=UTC)
        _advance(case5, CaseState.TRIAGED, "system", t4, {"triage_note": "red alert, canal land"})
        _advance(
            case5, CaseState.INSPECTION_ASSIGNED, "system", t4, {"inspector_id": "inspector-1"}
        )
        _advance(
            case5, CaseState.INSPECTED, "inspector-1", t4, {"inspection_report": "report-005.pdf"}
        )
        _advance(
            case5,
            CaseState.SHOW_CAUSE_ISSUED,
            "system",
            t4,
            {"notice_document": "notice-005.pdf", "dispatch_proof": "dispatch-005.pdf"},
        )
        _advance(case5, CaseState.RESPONSE_WINDOW, "system", datetime(2026, 4, 8, tzinfo=UTC), {})
        store.cases[case5.case_id] = CaseRecord(
            case=case5,
            alert_id="alert-9",
            parcel_id="parcel-23",
            jurisdiction_id=store.parcels["parcel-23"]["jurisdiction_id"],
        )
        store.record_audit(
            actor="system", action="case.seed", object_type="case", object_id=case5.case_id
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
