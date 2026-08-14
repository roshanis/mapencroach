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

Durability: this class has no opinion of its own about surviving a
restart -- `state_persister` (see its docstring below) is `None` by
default, so a bare `Store()`/`Store.seed_demo()` is exactly as ephemeral
as it always was. `mapencroach.persistence` is where an actual
`StatePersister` gets built and wired in for a real deployment; see that
module for what is (and, just as importantly, is not) persisted.
"""

import threading
from collections.abc import Callable, Mapping
from dataclasses import dataclass, field, replace
from datetime import UTC, date, datetime, timedelta
from typing import Any, Protocol

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
from mapencroach.imagery.blobstore import build_blob_store
from mapencroach.imagery.capture import CaptureAttempt, ImageryProvider
from mapencroach.imagery.providers import build_provider
from mapencroach.imagery.registry import SceneRegistry
from mapencroach.imagery.schedule import due_weeks

_PARCEL_SIZE_DEG = 0.001  # ~110m square at this latitude


class StatePersister(Protocol):
    """Structural interface for whatever persists a `Store`'s
    evidence-bearing state to disk (see `mapencroach.persistence`).

    Defined here rather than imported from `mapencroach.persistence` so
    this module -- and `Store` itself -- has no dependency on how (or
    whether) persistence is implemented; persistence is opt-in wiring
    layered on top of `Store`, never a thing `Store` needs to know about
    beyond "something with a `save` method, or nothing at all".
    """

    def save(self, store: "Store") -> None: ...


def _utc_now() -> datetime:
    """Default `Store.clock`: real wall-clock time, UTC.

    Centralizing "now" behind a store attribute (rather than reading
    `datetime.now()` inline in the watchlist handlers) is what lets tests
    pin "today" deterministically -- swap `store.clock` for a fixed
    callable and every started_on/due_weeks computation in the request
    follows it, including across a week boundary.
    """
    return datetime.now(UTC)


def _default_scene_registry() -> SceneRegistry:
    """Build the store's shared `SceneRegistry`, wired to retain bytes.

    This is the one place in the app that opts a registry into blob
    storage -- `SceneRegistry()` on its own still defaults to
    `blob_store=None` (hash-on-ingest bookkeeping only, nothing
    retrievable later), which is what every other constructor call
    (including most of the registry's own test suite) continues to get.
    """
    return SceneRegistry(blob_store=build_blob_store())


def _ago(now: datetime, days: float, hour: int, minute: int = 0) -> datetime:
    """`now` shifted back `days` days, with the wall-clock time pinned to
    `hour`/`minute` so seeded events don't all land at the same hour.

    Seed demo timestamps are computed relative to `now` (captured once at
    seed time) rather than fixed absolute dates, so the demo never reads as
    stale no matter when the process boots.
    """
    return (now - timedelta(days=days)).replace(hour=hour, minute=minute, second=0, microsecond=0)


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
#
# The demo carries three unrelated authorities in three states: the
# Haridwar-Roorkee corridor in Uttarakhand, Ambalapuzha taluk in
# Alappuzha (Kerala), and Pune district (Maharashtra). They are siblings
# under a deployment-level root rather than nested inside one another,
# because none of them contains the others -- modelling any as a taluk of
# HRDA would put a false statement about Indian administrative geography
# into the record every officer sees.
JURISDICTION_NAMES: dict[str, str] = {
    "deployment": "mapencroach demo deployment",
    "state": "Haridwar–Roorkee Development Authority",
    "dist-a": "Haridwar Division",
    "dist-b": "Roorkee Division",
    "taluk-a1": "Haridwar City",
    "taluk-a2": "Kankhal",
    "taluk-a3": "Laksar",
    "taluk-b1": "Roorkee City",
    "taluk-b2": "Bahadarabad",
    "taluk-b3": "Narsan",
    "state-kl": "Government of Kerala",
    "dist-alappuzha": "Alappuzha District",
    "taluk-ambalapuzha": "Ambalapuzha Taluk",
    "state-mh": "Government of Maharashtra",
    "dist-pune": "Pune District",
    "taluk-haveli": "Haveli Taluk",
    "taluk-mulshi": "Mulshi Taluk",
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

    # The demo's *primary* authority (HRDA), not the tree's root -- the
    # seeded tree also carries a second, unrelated authority in Kerala, so
    # this id's scope is a strict subset of the tree. Anything that means
    # "every jurisdiction that exists" must use `tree.root_id` instead.
    primary_authority_id: str = "state"
    district_a_id: str = "dist-a"
    district_b_id: str = "dist-b"

    # Top-level authorities in the tree, if it is partitioned into more
    # than one. Empty (the default) means a single authority, where every
    # transfer is internal by construction -- exactly the pre-existing
    # behaviour. When populated, `authority_of` uses it to keep cases from
    # being handed to a government that has no relationship to them.
    authority_ids: set[str] = field(default_factory=set)

    _next_alert_seq: int = 0
    _next_case_seq: int = 0

    # Weekly-snapshot watch state. `scene_registry` is the hash-on-ingest
    # evidence anchor and must stay a single shared instance for the life
    # of the store -- a per-request registry would defeat both dedup and
    # hash-chain continuity. It is built (via `_default_scene_registry`)
    # with a real `BlobStore` attached, so captures made through this
    # store actually retain their bytes and can be served back later --
    # `SceneRegistry()` on its own still defaults to no retention.
    # `imagery_provider` is env-selected via
    # `build_provider()` (falls back to the deterministic demo provider
    # with no credentials configured) and can be swapped for a fake in
    # tests that need to force provider_error/no_usable_scene outcomes
    # without touching the network. `clock` centralizes "now" so watch
    # start dates and due-week math are deterministic under test control
    # (see `_utc_now`).
    scene_registry: SceneRegistry = field(default_factory=_default_scene_registry)
    imagery_provider: ImageryProvider = field(default_factory=build_provider)
    clock: Callable[[], datetime] = field(default_factory=lambda: _utc_now)

    # Durability is opt-in and OFF by default: plain `Store()` /
    # `Store.seed_demo()` construction (every existing test, every
    # ephemeral demo) never touches disk, exactly as before this field
    # existed. Something external (see `mapencroach.persistence.build_store`,
    # wired in automatically by `create_app()`'s no-store "real deploy"
    # path) opts a given store into persistence by setting this field --
    # at that point `persist_now()` below stops being a no-op.
    state_persister: StatePersister | None = field(default=None, repr=False, compare=False)

    def __post_init__(self) -> None:
        self._tree: JurisdictionTree | None = None
        if self.jurisdiction_rows:
            self._tree = JurisdictionTree(self.jurisdiction_rows)
        # Sync endpoints run in FastAPI's threadpool, so every mutating
        # operation on this shared instance must be serialized -- without a
        # lock, concurrent requests can interleave append_entry's non-atomic
        # read-prev-hash-then-append (corrupting the hash chain) or the id
        # counters' non-atomic increment (handing out duplicate ids). Public
        # (`store.lock`, not `_lock`) and re-entrant because app.py handlers
        # routinely hold it across a read-modify-write that itself calls
        # `record_audit` (which also takes it), and `record_audit` is in
        # turn called from within other locked store methods.
        self.lock = threading.RLock()

    @property
    def tree(self) -> JurisdictionTree:
        if self._tree is None:
            raise RuntimeError("jurisdiction tree not initialized")
        return self._tree

    def authority_of(self, jurisdiction_id: str) -> str | None:
        """Which top-level authority `jurisdiction_id` belongs to.

        Returns None when `authority_ids` is empty -- a tree holding a
        single authority has no boundary to enforce, so callers see the
        pre-existing "everything is one authority" behaviour unchanged.

        Raises KeyError for an unknown id; callers are expected to have
        already checked membership against `tree.root_id`'s scope.
        """
        for authority_id in sorted(self.authority_ids):
            if self.tree.is_within(authority_id, jurisdiction_id):
                return authority_id
        return None

    @property
    def dist_a_scope(self) -> set[str]:
        return self.tree.scope_ids(self.district_a_id)

    @property
    def dist_b_scope(self) -> set[str]:
        return self.tree.scope_ids(self.district_b_id)

    def record_audit(
        self,
        *,
        actor: str,
        action: str,
        object_type: str,
        object_id: str,
        extra: Mapping[str, Any] | None = None,
    ) -> None:
        """Append a hash-chained audit entry.

        `extra` merges additional, action-specific fields (e.g. a boundary
        grade change's survey reference and from/to grades) into the
        payload -- callers that need to record more than the bare
        actor/action/object identity pass it rather than dropping that
        context on the floor.

        Locked so concurrent requests can't both read the same
        `audit_chain[-1]` and append with the same prev_hash, which would
        fork the chain instead of extending it.
        """
        payload: dict[str, Any] = {
            "actor": actor,
            "action": action,
            "object_type": object_type,
            "object_id": object_id,
            "at": datetime.now(UTC).isoformat(),
        }
        if extra:
            payload.update(extra)
        with self.lock:
            append_entry(self.audit_chain, payload)

    def persist_now(self) -> None:
        """Flush the evidence-bearing state (watchlist, scene registry
        index, audit chain) to disk via `state_persister`, if one is
        configured. A no-op otherwise -- see the `state_persister` field
        docstring for why plain `Store()` construction never reaches this.

        Callers (the watch-list/imagery HTTP handlers in `api/app.py`) are
        expected to call this *after* releasing `store.lock`, not from
        within a locked block: `state_persister.save` takes the lock
        itself only long enough to snapshot the state to serialize, then
        releases it before doing any file I/O, matching the same
        never-hold-the-lock-across-I/O discipline the capture endpoints
        use for provider calls.
        """
        if self.state_persister is not None:
            self.state_persister.save(self)

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
        """Build a demo store spanning two unrelated authorities.

        Primary: the Haridwar–Roorkee Development Authority (HRDA) corridor
        in Uttarakhand -- 2 districts -> 6 named taluks, 30 parcels (5 per
        taluk), 10 alerts across every tier/status, 5 cases including two
        paused states. parcel-1..8 / alert-1..4 / case-1..2 are the original
        demo protagonists and must not change.

        Secondary: Ambalapuzha taluk in Alappuzha, Kerala -- 5 parcels and
        2 alerts on backwater, canal, paddy, town and coastal land. It hangs
        off its own state, sibling to HRDA under a deployment-level root, so
        neither authority's officers can see the other's parcels.

        New jurisdictions/parcels/alerts must be *appended*: alert and case
        ids are handed out sequentially, so inserting ahead of the existing
        specs would renumber the protagonists above.
        """
        rows: list[tuple[str, str | None]] = [
            # Deployment root. Not a real administrative body -- it exists
            # because the tree is single-rooted by construction and the two
            # authorities below it are genuine peers, neither containing
            # the other. No demo persona is scoped here: a login spanning
            # Uttarakhand and Kerala would frame the map on all of India
            # and represents no real officer.
            ("deployment", None),
            ("state", "deployment"),
            ("dist-a", "state"),
            ("dist-b", "state"),
            ("taluk-a1", "dist-a"),
            ("taluk-a2", "dist-a"),
            ("taluk-a3", "dist-a"),
            ("taluk-b1", "dist-b"),
            ("taluk-b2", "dist-b"),
            ("taluk-b3", "dist-b"),
            ("state-kl", "deployment"),
            ("dist-alappuzha", "state-kl"),
            ("taluk-ambalapuzha", "dist-alappuzha"),
            ("state-mh", "deployment"),
            ("dist-pune", "state-mh"),
            ("taluk-haveli", "dist-pune"),
            ("taluk-mulshi", "dist-pune"),
        ]
        store = cls(
            jurisdiction_rows=rows, authority_ids={"state", "state-kl", "state-mh"}
        )

        # Captured once so every seeded timestamp below is relative to "now"
        # at seed/startup time -- the demo should never read as stale no
        # matter how long it's been running.
        now = datetime.now(UTC)

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
            # --- taluk-ambalapuzha (Ambalapuzha, Alappuzha district, Kerala) ---
            # Coordinates trace the real taluk: the Vembanad/Punnamada
            # backwater on its east, the Alappuzha-Changanassery canal
            # through its middle, Kuttanad's below-sea-level paddy to the
            # south-east, the temple town on NH-66, and the Arabian Sea
            # coastal strip on its west.
            ("parcel-31", "AMB-201", "taluk-ambalapuzha", "waterbody", "A", 76.398, 9.452),
            ("parcel-32", "AMB-202", "taluk-ambalapuzha", "irrigation", "A", 76.372, 9.401),
            ("parcel-33", "AMB-203", "taluk-ambalapuzha", "revenue", "B", 76.412, 9.372),
            ("parcel-34", "AMB-204", "taluk-ambalapuzha", "municipal", "B", 76.353, 9.379),
            ("parcel-35", "AMB-205", "taluk-ambalapuzha", "housing", "C", 76.331, 9.345),
            # --- taluk-haveli (Haveli, Pune district, Maharashtra) ---
            # Haveli wraps Pune city. The Mula-Mutha riverbed and the
            # Khadakwasla canal system are where Pune's encroachment
            # disputes actually sit, and the hill reserved forests
            # (Vetal/Taljai) are the other standing pressure.
            ("parcel-36", "PN-301", "taluk-haveli", "waterbody", "A", 73.878, 18.552),
            ("parcel-37", "PN-302", "taluk-haveli", "irrigation", "B", 73.790, 18.462),
            ("parcel-38", "PN-303", "taluk-haveli", "municipal", "B", 73.807, 18.507),
            ("parcel-39", "PN-304", "taluk-haveli", "forest", "C", 73.822, 18.497),
            # --- taluk-mulshi (Mulshi, Pune district) ---
            # West of the city: the Mulshi reservoir backwater, and the
            # Hinjawadi/Bhugaon fringe where the IT belt meets it.
            ("parcel-40", "PN-305", "taluk-mulshi", "waterbody", "A", 73.505, 18.497),
            ("parcel-41", "PN-306", "taluk-mulshi", "industrial", "C", 73.738, 18.591),
            ("parcel-42", "PN-307", "taluk-mulshi", "housing", "B", 73.755, 18.520),
        ]
        # Kerala parcels are listed explicitly because the
        # category->department fallback below is Uttarakhand-specific;
        # a Kerala backwater is not held by an Uttarakhand department.
        _KERALA_DEPARTMENTS = {
            "parcel-31": "Irrigation Department, Kerala",
            "parcel-32": "Irrigation Department, Kerala",
            "parcel-33": "Revenue Department, Kerala",
            "parcel-34": "Ambalapuzha Grama Panchayat",
            "parcel-35": "Kerala State Housing Board",
        }
        _MAHARASHTRA_DEPARTMENTS = {
            "parcel-36": "Water Resources Department, Maharashtra",
            "parcel-37": "Water Resources Department, Maharashtra",
            "parcel-38": "Pune Municipal Corporation",
            "parcel-39": "Forest Department, Maharashtra",
            "parcel-40": "Water Resources Department, Maharashtra",
            "parcel-41": "Maharashtra Industrial Development Corporation",
            "parcel-42": "Pune Metropolitan Region Development Authority",
        }
        _OWNING_DEPARTMENTS = {
            **_KERALA_DEPARTMENTS,
            **_MAHARASHTRA_DEPARTMENTS,
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
        # ULPIN carries the state and district it was issued under, so it
        # cannot be one fixed prefix once the demo spans two states.
        _ULPIN_CODES = {
            "taluk-ambalapuzha": ("KL", "AL"),
            "taluk-haveli": ("MH", "PN"),
            "taluk-mulshi": ("MH", "PN"),
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
            state_code, district_code = _ULPIN_CODES.get(jurisdiction_id, ("UK", "HR"))
            store.parcels[parcel_id] = {
                "id": parcel_id,
                "survey_no": survey_no,
                "ulpin": f"{state_code}{i:010d}{district_code}",
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

        # detected_days_ago/hour vary per alert so the console shows a mix of
        # ages instead of a single stale-looking date; the urgent RED alert
        # (parcel-1) is kept the freshest.
        alert_specs = [
            ("parcel-1", AlertTier.RED, 6000.0, "OPEN", 2, 8, 20),
            ("parcel-3", AlertTier.AMBER, 3000.0, "OPEN", 6, 13, 45),
            # CLOSED (not RESOLVED) so the console's status filter matches.
            ("parcel-5", AlertTier.GREEN, 500.0, "CLOSED", 19, 7, 10),
            ("parcel-7", AlertTier.LEGACY, 8000.0, "OPEN", 21, 16, 30),
            ("parcel-9", AlertTier.RED, 4500.0, "UNDER_REVIEW", 4, 11, 5),
            ("parcel-12", AlertTier.AMBER, 2000.0, "ESCALATED", 9, 18, 50),
            ("parcel-15", AlertTier.GREEN, 700.0, "OPEN", 14, 9, 40),
            ("parcel-20", AlertTier.AMBER, 2500.0, "OPEN", 11, 15, 15),
            ("parcel-23", AlertTier.RED, 5200.0, "OPEN", 3, 20, 0),
            ("parcel-26", AlertTier.LEGACY, 9000.0, "UNDER_REVIEW", 17, 6, 25),
            # Ambalapuzha. Appended, never inserted -- alert ids are issued
            # in this order and alert-1..4 are pinned demo protagonists.
            # parcel-31 is Grade A backwater, so it scores RED: reclamation
            # of Vembanad-system water is the encroachment Alappuzha
            # actually litigates.
            ("parcel-31", AlertTier.RED, 5600.0, "OPEN", 5, 10, 35),
            ("parcel-33", AlertTier.AMBER, 2800.0, "OPEN", 12, 14, 55),
            # Pune. Appended for the same reason as Ambalapuzha above.
            # parcel-36 is Mula-Mutha riverbed on a Grade A boundary --
            # riverbed filling is the encroachment Pune actually litigates.
            ("parcel-36", AlertTier.RED, 7200.0, "OPEN", 6, 9, 15),
            ("parcel-39", AlertTier.AMBER, 3400.0, "UNDER_REVIEW", 13, 17, 5),
            ("parcel-40", AlertTier.GREEN, 900.0, "OPEN", 20, 8, 50),
        ]
        alert_ids: list[str] = []
        for parcel_id, tier, area_m2, status, days_ago, hour, minute in alert_specs:
            parcel = store.parcels[parcel_id]
            alert_id = store.next_alert_id()
            score = severity_score(
                area_m2, parcel["land_category"], parcel["boundary_grade"], False
            )
            detected_at = _ago(now, days_ago, hour, minute)
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
        _advance(
            case1,
            CaseState.TRIAGED,
            "system",
            _ago(now, 12, 9, 10),
            {"triage_note": "high severity RED alert"},
        )
        _advance(
            case1,
            CaseState.INSPECTION_ASSIGNED,
            "system",
            _ago(now, 10, 14, 0),
            {"inspector_id": "inspector-1"},
        )
        _advance(
            case1,
            CaseState.INSPECTED,
            "inspector-1",
            _ago(now, 7, 11, 30),
            {"inspection_report": "report-001.pdf"},
        )
        _advance(
            case1,
            CaseState.SHOW_CAUSE_ISSUED,
            "system",
            _ago(now, 3, 16, 20),
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
        _advance(
            case2,
            CaseState.TRIAGED,
            "system",
            _ago(now, 75, 9, 0),
            {"triage_note": "minor green alert"},
        )
        _advance(
            case2,
            CaseState.INSPECTION_ASSIGNED,
            "system",
            _ago(now, 72, 13, 20),
            {"inspector_id": "inspector-2"},
        )
        _advance(
            case2,
            CaseState.INSPECTED,
            "inspector-2",
            _ago(now, 68, 10, 45),
            {"inspection_report": "report-002.pdf"},
        )
        _advance(
            case2,
            CaseState.SHOW_CAUSE_ISSUED,
            "system",
            _ago(now, 63, 15, 0),
            {"notice_document": "notice-002.pdf", "dispatch_proof": "dispatch-002.pdf"},
        )
        _advance(case2, CaseState.RESPONSE_WINDOW, "system", _ago(now, 58, 9, 30), {})
        _advance(
            case2,
            CaseState.HEARING_SCHEDULED,
            "system",
            _ago(now, 55, 11, 15),
            {"hearing_date": _ago(now, 52, 10, 0).date().isoformat()},
        )
        _advance(
            case2,
            CaseState.HEARING_HELD,
            "legal-officer-1",
            _ago(now, 50, 14, 40),
            {"hearing_record": "hearing-002.pdf"},
        )
        _advance(
            case2,
            CaseState.ORDER_ISSUED,
            "legal-officer-1",
            _ago(now, 47, 10, 0),
            {"reasoned_order": "order-002.pdf"},
        )
        _advance(
            case2,
            CaseState.ACTION_TAKEN,
            "system",
            _ago(now, 46, 16, 0),
            {"action_report": "action-002.pdf"},
        )
        _advance(
            case2,
            CaseState.CLOSED,
            "system",
            _ago(now, 45, 12, 0),
            {"closure_note": "resolved, case closed"},
        )
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
        _advance(
            case3,
            CaseState.TRIAGED,
            "system",
            _ago(now, 24, 10, 0),
            {"triage_note": "red alert, SIDCUL-side"},
        )
        _advance(
            case3,
            CaseState.INSPECTION_ASSIGNED,
            "system",
            _ago(now, 22, 15, 30),
            {"inspector_id": "inspector-3"},
        )
        _advance(
            case3,
            CaseState.INSPECTED,
            "inspector-3",
            _ago(now, 19, 9, 15),
            {"inspection_report": "report-003.pdf"},
        )
        _advance(
            case3,
            CaseState.SHOW_CAUSE_ISSUED,
            "system",
            _ago(now, 15, 13, 45),
            {"notice_document": "notice-003.pdf", "dispatch_proof": "dispatch-003.pdf"},
        )
        _advance(
            case3,
            CaseState.STAYED_BY_COURT,
            "legal-officer-1",
            _ago(now, 6, 11, 0),
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
        _advance(
            case4,
            CaseState.TRIAGED,
            "system",
            _ago(now, 20, 9, 20),
            {"triage_note": "amber alert, Kankhal"},
        )
        _advance(
            case4,
            CaseState.INSPECTION_ASSIGNED,
            "system",
            _ago(now, 18, 14, 10),
            {"inspector_id": "inspector-2"},
        )
        _advance(
            case4,
            CaseState.INSPECTED,
            "inspector-2",
            _ago(now, 15, 10, 50),
            {"inspection_report": "report-004.pdf"},
        )
        _advance(
            case4,
            CaseState.SURVEY_REQUESTED,
            "inspector-2",
            _ago(now, 8, 16, 5),
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
        _advance(
            case5,
            CaseState.TRIAGED,
            "system",
            _ago(now, 16, 8, 45),
            {"triage_note": "red alert, canal land"},
        )
        _advance(
            case5,
            CaseState.INSPECTION_ASSIGNED,
            "system",
            _ago(now, 14, 12, 30),
            {"inspector_id": "inspector-1"},
        )
        _advance(
            case5,
            CaseState.INSPECTED,
            "inspector-1",
            _ago(now, 11, 9, 0),
            {"inspection_report": "report-005.pdf"},
        )
        _advance(
            case5,
            CaseState.SHOW_CAUSE_ISSUED,
            "system",
            _ago(now, 9, 15, 20),
            {"notice_document": "notice-005.pdf", "dispatch_proof": "dispatch-005.pdf"},
        )
        _advance(case5, CaseState.RESPONSE_WINDOW, "system", _ago(now, 2, 10, 0), {})
        store.cases[case5.case_id] = CaseRecord(
            case=case5,
            alert_id="alert-9",
            parcel_id="parcel-23",
            jurisdiction_id=store.parcels["parcel-23"]["jurisdiction_id"],
        )
        store.record_audit(
            actor="system", action="case.seed", object_type="case", object_id=case5.case_id
        )

        # Case 6: alert-11 (parcel-31, Ambalapuzha) — the second authority's
        # own case, so Kerala is a working jurisdiction rather than a map
        # pin: an Ambalapuzha login has a case queue, a due-process rail and
        # the policy guards to demonstrate, exactly as an HRDA login does.
        #
        # Deliberately parked at INSPECTED rather than mirroring an HRDA
        # case's state. The parcel is Grade A backwater and the next step
        # is a show-cause notice, so the case sits at the point where the
        # evidence guard actually bites -- attempting that transition
        # without a notice document and dispatch proof is refused, which is
        # the demo's whole argument.
        case6 = Case(case_id=store.next_case_id(), state=CaseState.NEW)
        _advance(
            case6,
            CaseState.TRIAGED,
            "system",
            _ago(now, 4, 10, 15),
            {"triage_note": "RED alert: filling on Vembanad-system backwater, Grade A boundary"},
        )
        _advance(
            case6,
            CaseState.INSPECTION_ASSIGNED,
            "system",
            _ago(now, 3, 15, 40),
            {"inspector_id": "inspector-3"},
        )
        _advance(
            case6,
            CaseState.INSPECTED,
            "inspector-3",
            _ago(now, 1, 11, 5),
            {"inspection_report": "report-006.pdf"},
        )
        store.cases[case6.case_id] = CaseRecord(
            case=case6,
            alert_id="alert-11",
            parcel_id="parcel-31",
            jurisdiction_id=store.parcels["parcel-31"]["jurisdiction_id"],
        )
        store.record_audit(
            actor="system", action="case.seed", object_type="case", object_id=case6.case_id
        )

        # Case 7: alert-13 (parcel-36, Haveli) — Pune's own case, so the
        # third authority is a working jurisdiction rather than a map pin,
        # on the same reasoning as case-6 above.
        #
        # Taken one step further than case-6, to SHOW_CAUSE_ISSUED: from
        # there the refused move is a *sequence* violation (jumping to an
        # order) rather than a missing artifact, so the two new authorities
        # between them demonstrate different guards rather than repeating
        # the same one.
        case7 = Case(case_id=store.next_case_id(), state=CaseState.NEW)
        _advance(
            case7,
            CaseState.TRIAGED,
            "system",
            _ago(now, 5, 9, 30),
            {"triage_note": "RED alert: filling in the Mula-Mutha riverbed, Grade A boundary"},
        )
        _advance(
            case7,
            CaseState.INSPECTION_ASSIGNED,
            "system",
            _ago(now, 4, 14, 10),
            {"inspector_id": "inspector-4"},
        )
        _advance(
            case7,
            CaseState.INSPECTED,
            "inspector-4",
            _ago(now, 2, 10, 25),
            {"inspection_report": "report-007.pdf"},
        )
        _advance(
            case7,
            CaseState.SHOW_CAUSE_ISSUED,
            "system",
            _ago(now, 1, 16, 0),
            {"notice_document": "notice-007.pdf", "dispatch_proof": "dispatch-007.pdf"},
        )
        store.cases[case7.case_id] = CaseRecord(
            case=case7,
            alert_id="alert-13",
            parcel_id="parcel-36",
            jurisdiction_id=store.parcels["parcel-36"]["jurisdiction_id"],
        )
        store.record_audit(
            actor="system", action="case.seed", object_type="case", object_id=case7.case_id
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
