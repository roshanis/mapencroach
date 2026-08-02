"""In-memory data store for the API layer.

Design note: this dict-based store exists so the API/auth/case-engine
wiring can be built and tested without standing up PostGIS. It exposes
the shape a persistent backend needs to support — jurisdiction tree,
parcels, alerts, cases, audit chain — behind plain attributes. A
PostGIS-backed implementation (SQLAlchemy models already exist in
mapencroach.db.models) is meant to replace this class behind the same
interface later; callers should depend only on the attributes/methods
documented here, not on dict internals.

Concurrency: FastAPI runs sync `def` endpoints in a threadpool, so one
Store instance is shared across concurrently-executing requests.
`record_audit`, `next_alert_id`, and `next_case_id` serialize themselves on
`self.lock` (a re-entrant `threading.RLock`); callers doing a
read-modify-write across a mutation and its audit entry should hold
`store.lock` for the whole critical section rather than relying on the
individual methods alone.
"""

import threading
from collections.abc import Callable
from dataclasses import dataclass, field, replace
from datetime import UTC, date, datetime
from typing import Any

from mapencroach.audit.chain import AuditEntry, append_entry
from mapencroach.context.shrug import ShrugImportManifest
from mapencroach.domain.alerts import AlertTier, severity_score
from mapencroach.domain.case_engine import Case, CaseState, transition
from mapencroach.domain.geography import (
    ContextObservation,
    GeographicLink,
    ParcelAlias,
    ParcelContext,
)
from mapencroach.domain.jurisdiction import JurisdictionTree
from mapencroach.imagery.capture import CaptureAttempt, ImageryProvider
from mapencroach.imagery.providers import build_provider
from mapencroach.imagery.registry import SceneRegistry
from mapencroach.imagery.schedule import due_weeks

_PARCEL_SIZE_DEG = 0.001  # ~110m square at this latitude


def _utc_now() -> datetime:
    """Default `Store.clock`: real wall-clock time, UTC.

    Centralizing "now" behind a store attribute (rather than reading
    `datetime.now()` inline in the watchlist handlers) is what lets tests
    pin "today" deterministically -- swap `store.clock` for a fixed
    callable and every started_on/due_weeks computation in the request
    follows it, including across a week boundary.
    """
    return datetime.now(UTC)


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
class WatchEntryRecord:
    """A RED alert under weekly-snapshot watch, plus its capture history.

    `in_flight` records weeks a capture run has claimed but not yet
    written a `CaptureAttempt` for. It exists so `POST
    /watchlist/{id}/captures` can release `store.lock` while it does
    provider I/O (never holding the lock across network calls) without a
    second concurrent run re-selecting and double-attempting the same
    week -- see that handler in `api/app.py`. It is bookkeeping only, not
    part of the public WatchEntry JSON shape, so like the store's other
    internal-only fields it is excluded from repr/compare.
    """

    alert_id: str
    parcel_id: str
    started_on: date
    watched_by: str
    captures: list[CaptureAttempt] = field(default_factory=list)
    in_flight: set[str] = field(default_factory=set, repr=False, compare=False)

    def to_dict(self, today: date) -> dict[str, Any]:
        """Render the WatchEntry JSON shape (see the HTTP API contract).

        `due_weeks` is derived fresh from `started_on`/`captures` against
        the caller-supplied `today` rather than cached, so it's always
        consistent with whatever the store's clock currently says.
        """
        attempted = {c.week for c in self.captures}
        due = due_weeks(self.started_on, today, attempted)
        return {
            "alert_id": self.alert_id,
            "parcel_id": self.parcel_id,
            "started_on": self.started_on.isoformat(),
            "cadence": "weekly",
            "watched_by": self.watched_by,
            "captures": [c.to_dict() for c in self.captures],
            "due_weeks": [week.key for week in due],
        }


@dataclass
class Store:
    """Mutable in-memory data store shared across a single app instance."""

    jurisdiction_rows: list[tuple[str, str | None]] = field(default_factory=list)
    parcels: dict[str, dict[str, Any]] = field(default_factory=dict)
    alerts: dict[str, dict[str, Any]] = field(default_factory=dict)
    cases: dict[str, CaseRecord] = field(default_factory=dict)
    parcel_contexts: dict[str, ParcelContext] = field(default_factory=dict)
    audit_chain: list[AuditEntry] = field(default_factory=list)
    watchlist: dict[str, WatchEntryRecord] = field(default_factory=dict)

    root_jurisdiction_id: str = "state"
    district_a_id: str = "dist-a"
    district_b_id: str = "dist-b"

    _next_alert_seq: int = 0
    _next_case_seq: int = 0

    # Weekly-snapshot watch state. `scene_registry` is the hash-on-ingest
    # evidence anchor and must stay a single shared instance for the life
    # of the store -- a per-request registry would defeat both dedup and
    # hash-chain continuity. `imagery_provider` is env-selected via
    # `build_provider()` (falls back to the deterministic demo provider
    # with no credentials configured) and can be swapped for a fake in
    # tests that need to force provider_error/no_usable_scene outcomes
    # without touching the network. `clock` centralizes "now" so watch
    # start dates and due-week math are deterministic under test control
    # (see `_utc_now`).
    scene_registry: SceneRegistry = field(default_factory=SceneRegistry)
    imagery_provider: ImageryProvider = field(default_factory=build_provider)
    clock: Callable[[], datetime] = field(default_factory=lambda: _utc_now)

    def __post_init__(self) -> None:
        self._tree: JurisdictionTree | None = None
        if self.jurisdiction_rows:
            self._tree = JurisdictionTree(self.jurisdiction_rows)
        # Sync endpoints run in FastAPI's threadpool, so every mutating
        # operation on this shared instance must be serialized. Re-entrant
        # because record_audit is itself called from within other locked
        # store methods (and from app.py handlers that hold the lock across
        # a read-modify-write).
        self.lock = threading.RLock()

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
        """Append a hash-chained audit entry.

        Locked so concurrent requests can't both read the same
        `audit_chain[-1]` and append with the same prev_hash, which would
        fork the chain instead of extending it.
        """
        with self.lock:
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
        """Allocate the next alert id. Locked so concurrent callers can't
        read-then-increment the same sequence value and collide."""
        with self.lock:
            self._next_alert_seq += 1
            return f"alert-{self._next_alert_seq}"

    def next_case_id(self) -> str:
        """Allocate the next case id. Locked for the same reason as
        `next_alert_id`."""
        with self.lock:
            self._next_case_seq += 1
            return f"case-{self._next_case_seq}"

    def context_for_parcel(self, parcel_id: str) -> ParcelContext:
        """Return canonical identifiers plus any linked context for a parcel."""
        parcel = self.parcels[parcel_id]
        aliases = tuple(
            ParcelAlias(
                scheme=scheme,
                value=parcel[key],
                source="Illustrative demo parcel register",
                valid_from=None,
                valid_to=None,
                match_method="authoritative_identifier",
                confidence=1.0,
            )
            for scheme, key in (("survey_no", "survey_no"), ("ULPIN", "ulpin"))
            if parcel.get(key)
        )
        stored = self.parcel_contexts.get(parcel_id)
        if stored is not None:
            return replace(stored, aliases=aliases)
        return ParcelContext(
            parcel_id=parcel_id,
            canonical_id=parcel_id,
            aliases=aliases,
            lineage=(),
            geographic_links=(),
            observations=(),
            sources=(),
        )

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

        context_manifest = ShrugImportManifest.demo(
            source_id="shrug-compatible-demo",
            module="SHRUG-compatible planning indicators",
            version="Illustrative demo v1",
        )
        context_source = context_manifest.to_source()
        store.parcel_contexts["parcel-1"] = ParcelContext(
            parcel_id="parcel-1",
            canonical_id="parcel-1",
            aliases=(),
            lineage=(),
            geographic_links=(
                GeographicLink(
                    scheme="SHRUG_SHRID2",
                    geographic_unit_id="demo-hrda-001",
                    name="Haridwar context unit (illustrative)",
                    level="village_or_town",
                    match_method="centroid_within_demo_geometry",
                    confidence=0.78,
                    source_id=context_source.id,
                ),
            ),
            observations=(
                ContextObservation(
                    key="tree_cover_change",
                    label="Tree-cover trend",
                    value=-3.4,
                    unit="percentage points",
                    period="2015-2021",
                    trend="falling",
                    source_id=context_source.id,
                ),
                ContextObservation(
                    key="night_light_mean",
                    label="Night-light intensity",
                    value=4.2,
                    unit="illustrative index",
                    period="2021",
                    trend="rising",
                    source_id=context_source.id,
                ),
                ContextObservation(
                    key="road_access",
                    label="Road access",
                    value="Connected",
                    unit="illustrative category",
                    period="2021",
                    trend=None,
                    source_id=context_source.id,
                ),
                ContextObservation(
                    key="canal_presence",
                    label="Canal presence",
                    value=True,
                    unit="illustrative flag",
                    period="2021",
                    trend=None,
                    source_id=context_source.id,
                ),
                ContextObservation(
                    key="population_pressure",
                    label="Settlement pressure",
                    value="Elevated",
                    unit="illustrative category",
                    period="2011-2021",
                    trend="rising",
                    source_id=context_source.id,
                ),
            ),
            sources=(context_source,),
        )

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
