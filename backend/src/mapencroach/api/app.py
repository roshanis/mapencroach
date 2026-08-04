"""FastAPI application factory.

Every mutating endpoint appends an audit entry to the store's hash chain
before returning, so the chain is a complete record of who changed what
and when. All read endpoints are jurisdiction-scoped: a caller only ever
sees rows whose jurisdiction_id lies within JurisdictionTree.scope_ids of
their own jurisdiction_id. Parcels outside scope 404 rather than 403 so
we don't leak that they exist. List endpoints (/parcels, /alerts, /cases)
are paginated with `limit`/`offset` query params and report the unpaginated,
scope-filtered total via the X-Total-Count response header; their JSON body
shape is unchanged (a plain array, or for /parcels a GeoJSON
FeatureCollection) so existing clients don't need an envelope migration.
Case transitions into a state the domain reserves for legal authority
(hearing held, order issued, or the case ending) require Role.LEGAL_OFFICER
or Role.SYSTEM_ADMIN; ordinary triage/survey/notice transitions stay with
Role.CASE_OFFICER. Weekly-snapshot watch entries (/alerts/{id}/watch,
/watchlist*) follow the same jurisdiction-scoping and 404-not-403 rule as
alerts, and can only be created for RED-tier alerts; capture runs are
idempotent per ISO week (mapencroach.imagery.schedule.due_weeks) and never
hold store.lock across imagery provider I/O. Retained scene bytes are
served back through /watchlist/{alert_id}/weeks/{week}/image and
/cases/{case_id}/imagery/{week}/image -- week-keyed rather than
scene-keyed, since serving is scoped through the parent resource (watch
entry / case) and there is no scene->alert reverse index. Both routes
never hold store.lock while streaming bytes, audit every read via
store.record_audit, and answer conditional GETs (If-None-Match) with 304
since content-addressed bytes can never go stale. A case may also be
handed to another jurisdiction via POST /cases/{id}/transfer (open to
Role.CASE_OFFICER or Role.DATA_ADMIN, not gated as legal authority since
it does not change case state); the target jurisdiction just needs to be
a real node in the tree and different from the case's current one.
Role.DATA_ADMIN can additionally ingest scenes directly via
POST /imagery/scenes, independent of the watch-list/backfill capture
flows above; ingestion dedupes on sha256 (409 on an exact repeat).

Durability: when `create_app()` is called with no explicit `store` (the
real-deployment path -- every test passes one), the store it builds via
`mapencroach.persistence.build_store` hydrates prior watchlist/scene-
registry/audit state from disk (if any) and persists it on every
watch-list/imagery mutation and every scene read, via `store.persist_now()`
called after the relevant `store.lock` block has already been released
(never while the lock is held). See `mapencroach.persistence` for what is
and is not persisted, and its cross-process concurrency caveats.
"""

import base64
import math
import os
import re
from collections.abc import Mapping
from datetime import UTC, date, datetime, timedelta
from typing import Annotated, Any

from fastapi import Body, Depends, FastAPI, HTTPException, Query, Request, Response, status
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, ConfigDict, Field, StringConstraints, field_validator

from mapencroach.api.auth import (
    Role,
    User,
    create_token,
    current_user,
    require_roles,
    validate_secret_config,
)
from mapencroach.api.store import JURISDICTION_NAMES, CaseRecord, Store, WatchEntryRecord
from mapencroach.domain.alerts import AlertTier, severity_score
from mapencroach.domain.case_engine import (
    Case,
    CaseState,
    InvalidTransition,
    MissingArtifact,
    allowed_transitions,
    required_artifacts_for,
    transition,
)
from mapencroach.imagery.capture import CaptureAttempt, CaptureStatus, capture_week
from mapencroach.imagery.registry import DuplicateScene, SceneRecord
from mapencroach.imagery.schedule import WeekRef, due_weeks, weeks_from
from mapencroach.imagery.stac_search import StacClient, StacSearchError, geometry_bbox
from mapencroach.persistence import build_store

_VALID_GRADES = {"A", "B", "C"}

# Demo persona tokens are short-lived: long enough to run a demo session,
# short enough that a leaked one stops mattering quickly.
_DEMO_TOKEN_HOURS = 2

# Lowercase slug, hyphen-separated, 1-39 chars, no leading hyphen.
_TAG_PATTERN = re.compile(r"[a-z0-9][a-z0-9-]{0,38}")

# List endpoint pagination: generous enough for the demo dataset, capped so a
# caller can't force an unbounded response by omitting `limit`.
_DEFAULT_PAGE_SIZE = 200
_MAX_PAGE_SIZE = 1000
LimitQuery = Annotated[int, Query(ge=1, le=_MAX_PAGE_SIZE)]
OffsetQuery = Annotated[int, Query(ge=0)]

# Case states the domain reserves for legal authority (a hearing actually
# held, an order issued, or the case ending) rather than routine
# triage/survey/notice administration. Scheduling a hearing, requesting a
# survey, or serving notice stays with the case officer; only these
# outcomes require Role.LEGAL_OFFICER (or Role.SYSTEM_ADMIN).
_LEGAL_AUTHORITY_STATES: frozenset[CaseState] = frozenset(
    {
        CaseState.HEARING_HELD,
        CaseState.ORDER_ISSUED,
        CaseState.CLOSED,
        CaseState.DISMISSED_FALSE_POSITIVE,
        CaseState.LEGACY_REFERRED,
        CaseState.STAYED_BY_COURT,
    }
)

# Demo identities for the persona switcher. Only served when
# MAPENCROACH_DEMO=1, so production never exposes a token-minting surface.
_DEMO_PERSONAS: list[dict[str, str]] = [
    {
        "id": "vc-hrda",
        "name": "Vice Chairman, HRDA",
        "role": "viewer",
        "jurisdiction_id": "state",
        "description": "Sees the whole authority's estate. Read-only: no case "
        "actions, no tagging - the console enforces it.",
    },
    {
        "id": "eo-haridwar",
        "name": "Enforcement Officer, Haridwar",
        "role": "case_officer",
        "jurisdiction_id": "dist-a",
        "description": "Runs encroachment cases for Haridwar-side parcels. "
        "Cannot see - or even confirm the existence of - Roorkee parcels.",
    },
    {
        "id": "survey-roorkee",
        "name": "Survey Officer, Roorkee",
        "role": "survey_officer",
        "jurisdiction_id": "dist-b",
        "description": "Upgrades boundary grades after ground survey on the "
        "Roorkee side. Cannot transition cases.",
    },
    {
        "id": "co-roorkee-city",
        "name": "Case Officer, Roorkee City",
        "role": "case_officer",
        "jurisdiction_id": "taluk-b1",
        "description": "Taluk-level officer: the narrowest scope in the demo. "
        "Sees only Roorkee City parcels - not even the rest of Roorkee "
        "division exists for this login.",
    },
    {
        "id": "admin-hq",
        "name": "Data Administrator, HRDA HQ",
        "role": "data_admin",
        "jurisdiction_id": "state",
        "description": "Manages parcel records and tags authority-wide, but "
        "cannot move a case through the legal chain.",
    },
]


# What each demo role can and cannot do — rendered on the personas page.
_ROLE_CAPABILITIES: dict[str, list[str]] = {
    "viewer": [
        "See every parcel, alert and case in scope",
        "Cannot act on cases",
        "Cannot edit tags or boundary grades",
    ],
    "case_officer": [
        "Move cases through due process",
        "Create alerts and tag parcels",
        "Cannot see other jurisdictions' parcels (even that they exist)",
        "Cannot upgrade boundary grades",
    ],
    "survey_officer": [
        "Upgrade boundary grades after ground survey",
        "Cannot transition cases",
    ],
    "data_admin": [
        "Manage parcel records and tags in scope",
        "Cannot move cases through the legal chain",
    ],
}


def _enrich_persona(persona: dict[str, str], store: Store) -> dict[str, Any]:
    """Add live, store-derived context to a persona for the console UI."""
    scope = store.tree.scope_ids(persona["jurisdiction_id"])
    visible = sum(1 for p in store.parcels.values() if p["jurisdiction_id"] in scope)
    return {
        **persona,
        "jurisdiction_name": JURISDICTION_NAMES.get(
            persona["jurisdiction_id"], persona["jurisdiction_id"]
        ),
        "visible_parcels": visible,
        "capabilities": _ROLE_CAPABILITIES.get(persona["role"], []),
    }


_NonBlankStr = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)]


class BoundaryGradePatch(BaseModel):
    grade: str
    # The survey reference is the audit trail's evidence of record -- a
    # whitespace-only value is functionally a missing reference and must be
    # rejected rather than silently persisted.
    survey_reference: _NonBlankStr


class AlertCreate(BaseModel):
    parcel_id: str
    tier: AlertTier
    # allow_inf_nan=False rejects Infinity/-Infinity/NaN at parse time. Without
    # it, `ge=0` lets Infinity through (it JSON-serializes as null downstream,
    # poisoning the store) and NaN comparisons are unreliable.
    area_m2: float = Field(ge=0, allow_inf_nan=False)
    detected_at: datetime

    @field_validator("area_m2", mode="before")
    @classmethod
    def _area_m2_reject_non_finite(cls, value: Any) -> Any:
        # FastAPI's default RequestValidationError handler embeds the raw
        # offending value as the error's "input", and Starlette's
        # JSONResponse renders with allow_nan=False -- so an Infinity/NaN
        # float surviving into that error would crash the response instead
        # of returning a clean 422. Normalizing to None here before
        # allow_inf_nan=False rejects it means the eventual error carries a
        # JSON-safe `null`, not a raw non-finite float.
        if isinstance(value, float) and not math.isfinite(value):
            return None
        return value


class TagCreate(BaseModel):
    tag: str


class PersonaLogin(BaseModel):
    persona_id: str


class TransitionRequest(BaseModel):
    to_state: str
    artifacts: dict[str, str] | None = None
    note: str = ""


class CaseTransferRequest(BaseModel):
    to_jurisdiction_id: _NonBlankStr
    # The handover justification is part of the legal record -- a
    # whitespace-only value is functionally missing and must be rejected.
    reason: _NonBlankStr


class SceneIngest(BaseModel):
    scene_id: _NonBlankStr
    captured_at: datetime
    sensor: _NonBlankStr
    resolution_m: float = Field(gt=0)
    cloud_pct: float = Field(ge=0, le=100)
    source: _NonBlankStr
    href: _NonBlankStr
    data_base64: str

    @field_validator("data_base64")
    @classmethod
    def _data_base64_must_be_valid_and_non_empty(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("data_base64 must not be empty")
        try:
            decoded = base64.b64decode(value, validate=True)
        except ValueError as exc:
            raise ValueError("data_base64 must be valid base64") from exc
        if not decoded:
            raise ValueError("data_base64 must not be empty")
        return value


def _parcel_to_feature(parcel: dict[str, Any]) -> dict[str, Any]:
    return {
        "type": "Feature",
        "geometry": parcel["geometry"],
        "properties": {
            "id": parcel["id"],
            "survey_no": parcel["survey_no"],
            "ulpin": parcel["ulpin"],
            "owning_department": parcel["owning_department"],
            "land_category": parcel["land_category"],
            "boundary_grade": parcel["boundary_grade"],
            "jurisdiction_id": parcel["jurisdiction_id"],
            "jurisdiction_name": JURISDICTION_NAMES.get(
                parcel["jurisdiction_id"], parcel["jurisdiction_id"]
            ),
            "tags": list(parcel.get("tags", [])),
        },
    }


def _user_scope(store: Store, user: User) -> set[str]:
    return store.tree.scope_ids(user.jurisdiction_id)


# Weekly-snapshot watch mutations (watch/unwatch/capture-run): case-officer
# tier or above, the same "case officer or higher" tier as ordinary case
# transitions (routine transitions use this exact role set in
# transition_case below).
_WATCH_ROLES = (Role.CASE_OFFICER, Role.LEGAL_OFFICER, Role.SYSTEM_ADMIN)

# Case-imagery backfill is scoped to Jan 2026 forward by default: Sentinel-2
# resolves 10m from 2017 on, but the product scope for this feature starts
# 2026-01-01. Read from the environment on every call (not cached at app
# start) so tests can set it via monkeypatch same as MAPENCROACH_JWT_SECRET.
_DEFAULT_IMAGERY_BACKFILL_FLOOR = date(2026, 1, 1)


def _imagery_backfill_floor() -> date:
    raw = os.environ.get("MAPENCROACH_IMAGERY_BACKFILL_FLOOR")
    if not raw:
        return _DEFAULT_IMAGERY_BACKFILL_FLOOR
    return date.fromisoformat(raw)


def _weeks_needing_backfill(
    lower_bound: date, started_on: date, attempted: set[str]
) -> list[WeekRef]:
    """Weeks strictly earlier than `started_on`'s week, back to `lower_bound`,
    that have no CaptureAttempt yet -- ascending, closest-to-floor first.

    Mirrors `due_weeks` (weeks_from minus already-attempted) but for the
    backward-looking range a case-imagery backfill still owes, rather than
    the forward range a watch entry's regular capture run owes.
    """
    if started_on <= lower_bound:
        return []
    last_day_before_coverage = started_on - timedelta(days=1)
    return [
        week
        for week in weeks_from(lower_bound, last_day_before_coverage)
        if week.key not in attempted
    ]


class CaseImageryBackfillRequest(BaseModel):
    """Body for POST /cases/{case_id}/imagery/backfill -- both fields optional."""

    model_config = ConfigDict(populate_by_name=True)

    from_date: date | None = Field(default=None, alias="from")
    max_weeks: int = Field(default=26, ge=1, le=52)


def _resolve_watch_entry(store: Store, user: User, alert_id: str) -> WatchEntryRecord:
    """Look up a watch entry, 404ing (never 403) if it doesn't exist or the
    caller's jurisdiction scope doesn't cover its parcel -- watch entries
    are scoped exactly like alerts, so out-of-scope must not leak that the
    entry exists."""
    entry = store.watchlist.get(alert_id)
    scope = _user_scope(store, user)
    if entry is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="watch entry not found")
    parcel = store.parcels.get(entry.parcel_id)
    if parcel is None or parcel["jurisdiction_id"] not in scope:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="watch entry not found")
    return entry


# Scene image serving: content-addressed bytes can never go stale, so a
# successful response is cacheable forever. `private` because these are
# jurisdiction-scoped evidence images, not something a shared/public cache
# should hold.
_SCENE_IMAGE_CACHE_CONTROL = "private, max-age=31536000, immutable"


def _parse_week_or_422(week: str) -> WeekRef:
    """Parse a `WeekRef.key`-format path segment, 422ing on anything that
    isn't a well-formed, existing ISO week."""
    try:
        return WeekRef.parse(week)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=f"malformed week key {week!r}: {exc}",
        ) from exc


def _find_capture(captures: list[CaptureAttempt], week_key: str) -> CaptureAttempt:
    for attempt in captures:
        if attempt.week == week_key:
            return attempt
    raise HTTPException(
        status_code=status.HTTP_404_NOT_FOUND,
        detail=f"no capture attempt recorded for week {week_key!r}",
    )


def _require_captured_scene(
    store: Store, captures: list[CaptureAttempt], week_key: str
) -> SceneRecord:
    """Resolve `week_key` to a retained `SceneRecord`, or 404 with a detail
    naming exactly which of the (non-scoping) 404 causes applied: no
    capture attempt for the week, the week's status isn't CAPTURED, the
    scene isn't on record after all, or its bytes were never retained.
    None of these leak anything about resources outside the caller's
    scope -- that check has already happened by the time this runs."""
    attempt = _find_capture(captures, week_key)
    if attempt.status != CaptureStatus.CAPTURED or attempt.scene_id is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"week {week_key!r} capture status is {attempt.status.value!r}, not captured",
        )
    try:
        record = store.scene_registry.get(attempt.scene_id)
    except KeyError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"scene {attempt.scene_id!r} is not on record",
        ) from exc
    if not record.retained:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"week {week_key!r} has a hash on record but the image was not retained",
        )
    return record


def _scene_image_response(
    store: Store, user: User, request: Request, record: SceneRecord
) -> Response:
    """Render the 200/304 response for a retained scene, auditing the read.

    Reading evidence is an auditable act regardless of whether it lands as
    a full 200 or a conditional 304 -- either way the caller accessed the
    scene. The audit write happens before the (possibly slow) blob read,
    and neither holds `store.lock`: `record_audit` only takes it for the
    brief hash-chain append, and streaming the bytes back happens outside
    any lock entirely.
    """
    etag = f'"{record.sha256}"'
    store.record_audit(
        actor=user.sub, action="scene.read", object_type="scene", object_id=record.scene_id
    )
    store.persist_now()
    if request.headers.get("if-none-match") == etag:
        return Response(
            status_code=status.HTTP_304_NOT_MODIFIED,
            headers={"ETag": etag, "Cache-Control": _SCENE_IMAGE_CACHE_CONTROL},
        )
    data = store.scene_registry.load(record.scene_id)
    return Response(
        content=data,
        media_type=record.media_type,
        headers={"ETag": etag, "Cache-Control": _SCENE_IMAGE_CACHE_CONTROL},
    )


def _transition_options(case: Case) -> tuple[list[str], dict[str, list[str]]]:
    """Allowed next states plus the evidence each one requires."""
    allowed: list[CaseState] = sorted(allowed_transitions(case), key=lambda s: s.value)
    return (
        [s.value for s in allowed],
        {s.value: list(required_artifacts_for(case, s)) for s in allowed},
    )


def _case_to_detail(record: CaseRecord) -> dict[str, Any]:
    """The GET /cases/{id} payload shape, reused by every endpoint that
    returns a full case (e.g. transfer) so callers see a consistent view."""
    events = [
        {
            "from_state": e.from_state.value,
            "to_state": e.to_state.value,
            "actor": e.actor,
            "occurred_at": e.occurred_at.isoformat(),
            "artifacts": dict(e.artifacts),
            "note": e.note,
        }
        for e in record.case.events
    ]
    allowed, required = _transition_options(record.case)
    return {
        "id": record.case.case_id,
        "alert_id": record.alert_id,
        "parcel_id": record.parcel_id,
        # The case's CURRENT jurisdiction, distinct from the parcel's own
        # jurisdiction once the case has been transferred (see
        # /cases/{id}/transfer) -- callers need this to know who owns the
        # case now, not just where the underlying parcel sits.
        "jurisdiction_id": record.jurisdiction_id,
        "state": record.case.state.value,
        "events": events,
        "allowed_transitions": allowed,
        "required_artifacts": required,
    }


def _unfreeze(value: Any) -> Any:
    """Recursively convert `SceneRecord.stac_item`'s deep-frozen
    `MappingProxyType`/`tuple` structure (see
    `mapencroach.imagery.registry._deep_freeze`) back into plain
    dict/list. Pydantic's `dict[str, Any]` response model can't serialize
    a `mappingproxy` on its own -- this is what lets the frozen,
    tamper-proof stac_item still round-trip as ordinary JSON."""
    if isinstance(value, Mapping):
        return {k: _unfreeze(v) for k, v in value.items()}
    if isinstance(value, list | tuple):
        return [_unfreeze(v) for v in value]
    return value


def _scene_to_dict(record: SceneRecord) -> dict[str, Any]:
    """Scene payload shape returned by imagery endpoints -- deliberately
    excludes the raw bytes, which the client already has."""
    return {
        "scene_id": record.scene_id,
        "sha256": record.sha256,
        "captured_at": record.captured_at.isoformat(),
        "sensor": record.sensor,
        "resolution_m": record.resolution_m,
        "cloud_pct": record.cloud_pct,
        "source": record.source,
        "stac_item": _unfreeze(record.stac_item),
    }


def create_app(
    store: Store | None = None, stac_client: StacClient | None = None
) -> FastAPI:
    """Build the FastAPI app.

    If no store is supplied, one is created automatically: seeded with
    demo data when MAPENCROACH_DEMO=1, otherwise empty. `uvicorn
    "mapencroach.api.app:create_app" --factory` picks this up with no
    extra wiring. The STAC client (Sentinel-2 scene discovery on
    /parcels/{id}/scenes) defaults to Earth Search; override the catalog
    with MAPENCROACH_STAC_URL or inject a client in tests.

    Fails closed at startup (raises RuntimeError) rather than booting an
    insecure server: outside demo mode a real MAPENCROACH_JWT_SECRET is
    required, and MAPENCROACH_CORS_ORIGINS may not be "*" while credentialed
    requests are allowed. See `mapencroach.api.auth.validate_secret_config`
    for the secret rules.
    """
    demo_mode = os.environ.get("MAPENCROACH_DEMO") == "1"
    if store is None:
        # Real-deployment path only -- every test passes an explicit
        # `store`, so this is the one place persistence gets wired in.
        # `build_store` hydrates prior watchlist/scene-registry/audit
        # state (if any) and raises loudly on a corrupt state file rather
        # than silently booting empty; see `mapencroach.persistence`.
        store = build_store(demo=demo_mode)
    if stac_client is None:
        stac_url = os.environ.get("MAPENCROACH_STAC_URL")
        stac_client = StacClient(stac_url) if stac_url else StacClient()

    jwt_secret = validate_secret_config(demo_mode)

    app = FastAPI(title="mapencroach API")
    app.state.store = store
    app.state.jwt_secret = jwt_secret
    app.state.stac = stac_client

    cors_origins = [
        origin.strip()
        for origin in os.environ.get(
            "MAPENCROACH_CORS_ORIGINS", "http://localhost:3000"
        ).split(",")
        if origin.strip()
    ]
    if "*" in cors_origins:
        # allow_credentials=True + a wildcard origin lets any site ride a
        # logged-in browser's cookies/auth header at every endpoint - the
        # combination CORSMiddleware itself refuses to honor, so failing
        # fast here is more honest than shipping a CORS policy that
        # silently never matches.
        raise RuntimeError(
            "MAPENCROACH_CORS_ORIGINS may not include '*': this API allows "
            "credentialed requests, and a wildcard origin combined with "
            "credentials turns every authenticated endpoint into a CSRF "
            "surface. List explicit origins instead."
        )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=cors_origins,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PATCH", "DELETE"],
        allow_headers=["Authorization", "Content-Type"],
    )

    def get_store() -> Store:
        return app.state.store

    StoreDep = Annotated[Store, Depends(get_store)]
    CurrentUser = Annotated[User, Depends(current_user)]

    @app.get("/health")
    def health() -> dict[str, str]:
        """Liveness/readiness probe for container orchestration. Unauthenticated
        by design - it reports process health, not application data."""
        return {"status": "ok"}

    # ------------------------------------------------------------------
    # Parcels
    # ------------------------------------------------------------------

    @app.get("/parcels")
    def list_parcels(
        store: StoreDep,
        user: CurrentUser,
        response: Response,
        limit: LimitQuery = _DEFAULT_PAGE_SIZE,
        offset: OffsetQuery = 0,
    ) -> dict[str, Any]:
        scope = _user_scope(store, user)
        matched = [p for p in store.parcels.values() if p["jurisdiction_id"] in scope]
        response.headers["X-Total-Count"] = str(len(matched))
        page = matched[offset : offset + limit]
        return {"type": "FeatureCollection", "features": [_parcel_to_feature(p) for p in page]}

    @app.get("/parcels/{parcel_id}")
    def get_parcel(parcel_id: str, store: StoreDep, user: CurrentUser) -> dict[str, Any]:
        parcel = store.parcels.get(parcel_id)
        scope = _user_scope(store, user)
        if parcel is None or parcel["jurisdiction_id"] not in scope:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="parcel not found")
        return _parcel_to_feature(parcel)

    @app.get("/parcels/{parcel_id}/context")
    def get_parcel_context(
        parcel_id: str, store: StoreDep, user: CurrentUser
    ) -> dict[str, Any]:
        parcel = store.parcels.get(parcel_id)
        scope = _user_scope(store, user)
        if parcel is None or parcel["jurisdiction_id"] not in scope:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="parcel not found")
        return store.context_for_parcel(parcel_id).to_dict()

    @app.get("/parcels/{parcel_id}/scenes")
    def list_parcel_scenes(
        parcel_id: str,
        store: StoreDep,
        user: CurrentUser,
        days: Annotated[int, Query(ge=1, le=730)] = 90,
        max_cloud_pct: Annotated[float, Query(ge=0, le=100)] = 40.0,
        limit: Annotated[int, Query(ge=1, le=50)] = 8,
    ) -> dict[str, Any]:
        """Sentinel-2 scene candidates over a parcel, newest first.

        Discovery only: nothing is ingested into the scene registry
        until bytes are downloaded and hashed.
        """
        parcel = store.parcels.get(parcel_id)
        scope = _user_scope(store, user)
        if parcel is None or parcel["jurisdiction_id"] not in scope:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="parcel not found")

        # Buffer ~550m beyond the parcel so thumbnails carry recognizable
        # surroundings; scene footprints (110km tiles) dwarf it anyway.
        bbox = geometry_bbox(parcel["geometry"], buffer_deg=0.005)
        end = datetime.now(UTC)
        start = end - timedelta(days=days)
        try:
            scenes = app.state.stac.search(
                bbox, start=start, end=end, max_cloud_pct=max_cloud_pct, limit=limit
            )
        except StacSearchError as exc:
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=f"imagery catalog unavailable: {exc}",
            ) from exc

        return {
            "parcel_id": parcel_id,
            "bbox": list(bbox),
            "days": days,
            "max_cloud_pct": max_cloud_pct,
            "scenes": [c.to_api_dict() for c in scenes],
        }

    @app.patch("/parcels/{parcel_id}/boundary-grade")
    def patch_boundary_grade(
        parcel_id: str,
        body: BoundaryGradePatch,
        store: StoreDep,
        user: Annotated[User, Depends(require_roles(Role.SURVEY_OFFICER, Role.DATA_ADMIN))],
    ) -> dict[str, Any]:
        parcel = store.parcels.get(parcel_id)
        scope = _user_scope(store, user)
        if parcel is None or parcel["jurisdiction_id"] not in scope:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="parcel not found")

        if body.grade not in _VALID_GRADES:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail=f"invalid grade {body.grade!r}, must be one of {sorted(_VALID_GRADES)}",
            )

        with store.lock:
            old_grade = parcel["boundary_grade"]
            parcel["boundary_grade"] = body.grade
            store.record_audit(
                actor=user.sub,
                action="parcel.boundary_grade.update",
                object_type="parcel",
                object_id=parcel_id,
                extra={
                    "survey_reference": body.survey_reference,
                    "from_grade": old_grade,
                    "to_grade": body.grade,
                },
            )
        return _parcel_to_feature(parcel)

    @app.post("/parcels/{parcel_id}/tags", status_code=status.HTTP_201_CREATED)
    def add_parcel_tag(
        parcel_id: str,
        body: TagCreate,
        response: Response,
        store: StoreDep,
        user: Annotated[User, Depends(require_roles(Role.CASE_OFFICER, Role.DATA_ADMIN))],
    ) -> dict[str, Any]:
        parcel = store.parcels.get(parcel_id)
        scope = _user_scope(store, user)
        if parcel is None or parcel["jurisdiction_id"] not in scope:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="parcel not found")

        tag = body.tag.strip().lower()
        if not _TAG_PATTERN.fullmatch(tag):
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail="tags are 1-39 chars of lowercase letters, digits and hyphens, "
                "starting with a letter or digit",
            )

        with store.lock:
            tags: list[str] = parcel.setdefault("tags", [])
            if tag in tags:
                response.status_code = status.HTTP_200_OK
                return _parcel_to_feature(parcel)

            tags.append(tag)
            store.record_audit(
                actor=user.sub,
                action="parcel.tag.add",
                object_type="parcel",
                object_id=f"{parcel_id}:{tag}",
            )
        return _parcel_to_feature(parcel)

    @app.delete("/parcels/{parcel_id}/tags/{tag}")
    def remove_parcel_tag(
        parcel_id: str,
        tag: str,
        store: StoreDep,
        user: Annotated[User, Depends(require_roles(Role.CASE_OFFICER, Role.DATA_ADMIN))],
    ) -> dict[str, Any]:
        parcel = store.parcels.get(parcel_id)
        scope = _user_scope(store, user)
        if parcel is None or parcel["jurisdiction_id"] not in scope:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="parcel not found")

        normalized = tag.strip().lower()
        with store.lock:
            tags: list[str] = parcel.setdefault("tags", [])
            if normalized not in tags:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND, detail="tag not found"
                )

            tags.remove(normalized)
            store.record_audit(
                actor=user.sub,
                action="parcel.tag.remove",
                object_type="parcel",
                object_id=f"{parcel_id}:{normalized}",
            )
        return _parcel_to_feature(parcel)

    # ------------------------------------------------------------------
    # Demo personas (registered only in demo mode)
    # ------------------------------------------------------------------

    if demo_mode:

        @app.get("/demo/personas")
        def list_personas(store: StoreDep) -> list[dict[str, Any]]:
            return [_enrich_persona(p, store) for p in _DEMO_PERSONAS]

        @app.post(
            "/demo/login",
            description=(
                "DEMO ONLY - never exposed outside MAPENCROACH_DEMO=1. Mints a "
                f"working, {_DEMO_TOKEN_HOURS}-hour bearer token for the chosen "
                "persona with no credentials whatsoever; this is the product "
                "demo's persona switcher, not an authentication flow."
            ),
        )
        def demo_login(body: PersonaLogin, store: StoreDep) -> dict[str, Any]:
            persona = next(
                (p for p in _DEMO_PERSONAS if p["id"] == body.persona_id), None
            )
            if persona is None:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND, detail="unknown persona"
                )
            token = create_token(
                sub=persona["id"],
                role=Role(persona["role"]),
                jurisdiction_id=persona["jurisdiction_id"],
                secret=app.state.jwt_secret,
                expires_at=datetime.now(UTC) + timedelta(hours=_DEMO_TOKEN_HOURS),
            )
            return {
                "token": token,
                "persona": _enrich_persona(persona, store),
                "expires_in_hours": _DEMO_TOKEN_HOURS,
            }

    # ------------------------------------------------------------------
    # Alerts
    # ------------------------------------------------------------------

    @app.get("/alerts")
    def list_alerts(
        store: StoreDep,
        user: CurrentUser,
        response: Response,
        tier: str | None = Query(default=None),
        status_filter: str | None = Query(default=None, alias="status"),
        limit: LimitQuery = _DEFAULT_PAGE_SIZE,
        offset: OffsetQuery = 0,
    ) -> list[dict[str, Any]]:
        scope = _user_scope(store, user)
        matched = []
        for alert in store.alerts.values():
            parcel = store.parcels.get(alert["parcel_id"])
            if parcel is None or parcel["jurisdiction_id"] not in scope:
                continue
            if tier is not None and alert["tier"] != tier:
                continue
            if status_filter is not None and alert["status"] != status_filter:
                continue
            matched.append(dict(alert))
        response.headers["X-Total-Count"] = str(len(matched))
        return matched[offset : offset + limit]

    @app.post("/alerts", status_code=status.HTTP_201_CREATED)
    def create_alert(
        body: AlertCreate,
        store: StoreDep,
        user: Annotated[User, Depends(require_roles(Role.CASE_OFFICER, Role.DATA_ADMIN))],
    ) -> dict[str, Any]:
        parcel = store.parcels.get(body.parcel_id)
        scope = _user_scope(store, user)
        if parcel is None or parcel["jurisdiction_id"] not in scope:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="parcel not found")

        score = severity_score(
            body.area_m2, parcel["land_category"], parcel["boundary_grade"], False
        )
        alert_id = store.next_alert_id()
        alert = {
            "id": alert_id,
            "parcel_id": body.parcel_id,
            "tier": body.tier.value,
            "severity_score": score,
            "area_m2": body.area_m2,
            "status": "OPEN",
            "detected_at": body.detected_at.isoformat(),
        }
        with store.lock:
            store.alerts[alert_id] = alert
            store.record_audit(
                actor=user.sub, action="alert.create", object_type="alert", object_id=alert_id
            )
        return alert

    # ------------------------------------------------------------------
    # Cases
    # ------------------------------------------------------------------

    @app.get("/cases")
    def list_cases(
        store: StoreDep,
        user: CurrentUser,
        response: Response,
        limit: LimitQuery = _DEFAULT_PAGE_SIZE,
        offset: OffsetQuery = 0,
    ) -> list[dict[str, Any]]:
        scope = _user_scope(store, user)
        matched = []
        for record in store.cases.values():
            if record.jurisdiction_id not in scope:
                continue
            events = record.case.events
            matched.append(
                {
                    "id": record.case.case_id,
                    "alert_id": record.alert_id,
                    "parcel_id": record.parcel_id,
                    "state": record.case.state.value,
                    "state_since": events[-1].occurred_at.isoformat() if events else None,
                }
            )
        response.headers["X-Total-Count"] = str(len(matched))
        return matched[offset : offset + limit]

    @app.get("/cases/{case_id}")
    def get_case(case_id: str, store: StoreDep, user: CurrentUser) -> dict[str, Any]:
        record = store.cases.get(case_id)
        scope = _user_scope(store, user)
        if record is None or record.jurisdiction_id not in scope:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="case not found")

        return _case_to_detail(record)

    @app.post("/cases/{case_id}/transfer")
    def transfer_case(
        case_id: str,
        body: CaseTransferRequest,
        store: StoreDep,
        user: Annotated[User, Depends(require_roles(Role.CASE_OFFICER, Role.DATA_ADMIN))],
    ) -> dict[str, Any]:
        record = store.cases.get(case_id)
        scope = _user_scope(store, user)
        if record is None or record.jurisdiction_id not in scope:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="case not found")

        # Non-raising membership check: scope_ids(root) is every node in the
        # tree, so `in` never throws for an unknown id the way scope_ids of
        # the (possibly bogus) target itself would.
        known_jurisdiction_ids = store.tree.scope_ids(store.root_jurisdiction_id)
        to_jurisdiction_id = body.to_jurisdiction_id
        if to_jurisdiction_id not in known_jurisdiction_ids:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"unknown jurisdiction {to_jurisdiction_id!r}",
            )

        from_jurisdiction_id = record.jurisdiction_id
        if to_jurisdiction_id == from_jurisdiction_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="case is already in that jurisdiction",
            )

        # Cross-scope handover is the point of this endpoint: the target may
        # lie outside the caller's own scope (dist-a officer -> dist-b), and
        # the caller may lose visibility on the case immediately afterwards.
        with store.lock:
            record.jurisdiction_id = to_jurisdiction_id
            store.record_audit(
                actor=user.sub,
                action="case.transfer",
                object_type="case",
                object_id=case_id,
                extra={
                    "from_jurisdiction_id": from_jurisdiction_id,
                    "to_jurisdiction_id": to_jurisdiction_id,
                    "reason": body.reason,
                },
            )
        return _case_to_detail(record)

    @app.post("/cases/{case_id}/transitions", status_code=status.HTTP_201_CREATED)
    def transition_case(
        case_id: str,
        body: TransitionRequest,
        store: StoreDep,
        user: Annotated[
            User,
            Depends(require_roles(Role.CASE_OFFICER, Role.LEGAL_OFFICER, Role.SYSTEM_ADMIN)),
        ],
    ) -> dict[str, Any]:
        record = store.cases.get(case_id)
        scope = _user_scope(store, user)
        if record is None or record.jurisdiction_id not in scope:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="case not found")

        try:
            to_state = type(record.case.state)(body.to_state)
        except ValueError as exc:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail=f"unknown case state {body.to_state!r}",
            ) from exc

        if to_state in _LEGAL_AUTHORITY_STATES and user.role not in (
            Role.LEGAL_OFFICER,
            Role.SYSTEM_ADMIN,
        ):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=(
                    f"transitioning a case to {to_state.value!r} requires legal "
                    f"authority; role {user.role.value!r} is not permitted"
                ),
            )

        with store.lock:
            try:
                event = transition(
                    record.case,
                    to_state,
                    actor=user.sub,
                    occurred_at=datetime.now(UTC),
                    artifacts=body.artifacts,
                    note=body.note,
                )
            except (InvalidTransition, MissingArtifact) as exc:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT, detail=str(exc)
                ) from exc

            store.record_audit(
                actor=user.sub,
                action="case.transition",
                object_type="case",
                object_id=case_id,
            )

        allowed, required = _transition_options(record.case)
        return {
            "id": record.case.case_id,
            "from_state": event.from_state.value,
            "to_state": event.to_state.value,
            "actor": event.actor,
            "occurred_at": event.occurred_at.isoformat(),
            "artifacts": dict(event.artifacts),
            "note": event.note,
            "allowed_transitions": allowed,
            "required_artifacts": required,
        }

    # ------------------------------------------------------------------
    # Weekly-snapshot watch-list
    # ------------------------------------------------------------------

    @app.post("/alerts/{alert_id}/watch", status_code=status.HTTP_201_CREATED)
    def create_watch(
        alert_id: str,
        store: StoreDep,
        user: Annotated[User, Depends(require_roles(*_WATCH_ROLES))],
    ) -> dict[str, Any]:
        scope = _user_scope(store, user)
        with store.lock:
            alert = store.alerts.get(alert_id)
            parcel = store.parcels.get(alert["parcel_id"]) if alert is not None else None
            if alert is None or parcel is None or parcel["jurisdiction_id"] not in scope:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND, detail="alert not found"
                )

            if alert_id in store.watchlist:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT, detail="alert is already watched"
                )

            if AlertTier(alert["tier"]) != AlertTier.RED:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                    detail="only RED-tier alerts can be watched",
                )

            started_on = store.clock().date()
            entry = WatchEntryRecord(
                alert_id=alert_id,
                parcel_id=alert["parcel_id"],
                started_on=started_on,
                watched_by=user.sub,
            )
            store.watchlist[alert_id] = entry
            store.record_audit(
                actor=user.sub, action="watch.create", object_type="watch", object_id=alert_id
            )
            result = entry.to_dict(started_on)
        store.persist_now()
        return result

    @app.delete("/alerts/{alert_id}/watch", status_code=status.HTTP_204_NO_CONTENT)
    def delete_watch(
        alert_id: str,
        store: StoreDep,
        user: Annotated[User, Depends(require_roles(*_WATCH_ROLES))],
    ) -> Response:
        with store.lock:
            _resolve_watch_entry(store, user, alert_id)
            del store.watchlist[alert_id]
            store.record_audit(
                actor=user.sub, action="watch.delete", object_type="watch", object_id=alert_id
            )
        store.persist_now()
        return Response(status_code=status.HTTP_204_NO_CONTENT)

    @app.get("/watchlist")
    def list_watchlist(
        store: StoreDep,
        user: CurrentUser,
        response: Response,
        limit: LimitQuery = _DEFAULT_PAGE_SIZE,
        offset: OffsetQuery = 0,
    ) -> list[dict[str, Any]]:
        scope = _user_scope(store, user)
        today = store.clock().date()
        matched = []
        for entry in store.watchlist.values():
            parcel = store.parcels.get(entry.parcel_id)
            if parcel is None or parcel["jurisdiction_id"] not in scope:
                continue
            matched.append(entry)
        response.headers["X-Total-Count"] = str(len(matched))
        page = matched[offset : offset + limit]
        return [entry.to_dict(today) for entry in page]

    @app.get("/watchlist/{alert_id}")
    def get_watchlist_entry(alert_id: str, store: StoreDep, user: CurrentUser) -> dict[str, Any]:
        entry = _resolve_watch_entry(store, user, alert_id)
        return entry.to_dict(store.clock().date())

    @app.post("/watchlist/{alert_id}/captures", status_code=status.HTTP_201_CREATED)
    def run_watchlist_captures(
        alert_id: str,
        store: StoreDep,
        user: Annotated[User, Depends(require_roles(*_WATCH_ROLES))],
    ) -> list[dict[str, Any]]:
        # Phase 1 (locked): resolve scope, decide which weeks are due, and
        # reserve them in `entry.in_flight` so a concurrent capture run for
        # the same alert can't also pick them up. This is the only part
        # that touches shared store state before provider I/O runs.
        with store.lock:
            entry = _resolve_watch_entry(store, user, alert_id)
            attempted_at = store.clock()
            already = {c.week for c in entry.captures} | entry.in_flight
            due = due_weeks(entry.started_on, attempted_at.date(), already)
            if not due:
                return []
            entry.in_flight.update(week.key for week in due)
            provider = store.imagery_provider
            registry = store.scene_registry
            geometry = store.parcels[entry.parcel_id]["geometry"]

        # Phase 2 (unlocked): the actual provider fetches. Deliberately
        # outside the lock -- these may be real network calls (Copernicus)
        # and holding a process-wide lock across network I/O would stall
        # every other request for as long as the slowest fetch takes. The
        # `in_flight` reservation taken above is what keeps this safe: no
        # other request can have claimed the same (alert, week) pair while
        # this runs, so there's nothing to interleave destructively even
        # though the lock is released.
        try:
            results = [
                capture_week(
                    provider,
                    registry,
                    geometry=geometry,
                    week=week,
                    attempted_at=attempted_at,
                )
                for week in due
            ]
        finally:
            with store.lock:
                entry.in_flight.difference_update(week.key for week in due)

        # Phase 3 (locked): persist results and audit the run. Guard
        # against the entry having been unwatched while phase 2 was
        # in-flight -- if so, there is nothing left to record against.
        with store.lock:
            if store.watchlist.get(alert_id) is not entry:
                return []
            entry.captures.extend(results)
            store.record_audit(
                actor=user.sub,
                action="watch.capture_run",
                object_type="watch",
                object_id=alert_id,
            )

        store.persist_now()
        return [result.to_dict() for result in results]

    @app.get("/watchlist/{alert_id}/weeks/{week}/image")
    def get_watchlist_scene_image(
        alert_id: str,
        week: str,
        request: Request,
        store: StoreDep,
        user: CurrentUser,
    ) -> Response:
        week_ref = _parse_week_or_422(week)
        entry = _resolve_watch_entry(store, user, alert_id)
        record = _require_captured_scene(store, entry.captures, week_ref.key)
        return _scene_image_response(store, user, request, record)

    # ------------------------------------------------------------------
    # Case-level imagery backfill
    # ------------------------------------------------------------------
    #
    # There is one imagery timeline per alert, stored as the same
    # WatchEntryRecord the watch-list endpoints above use (keyed by
    # alert_id). A case reaches its timeline via CaseRecord.alert_id.
    # Backfill extends that record backwards by moving `started_on`
    # earlier and capturing the newly-in-scope earlier weeks; it never
    # creates a second, case_id-keyed record. If no record exists yet,
    # backfilling one creates it (started_on = today), so the alert then
    # also appears in GET /watchlist -- one timeline, one registry.

    @app.get("/cases/{case_id}/imagery")
    def get_case_imagery(case_id: str, store: StoreDep, user: CurrentUser) -> dict[str, Any]:
        record = store.cases.get(case_id)
        scope = _user_scope(store, user)
        if record is None or record.jurisdiction_id not in scope:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="case not found")

        alert = store.alerts.get(record.alert_id)
        alert_tier = alert["tier"] if alert is not None else None
        watchable = alert_tier == AlertTier.RED.value

        floor = _imagery_backfill_floor()
        today = store.clock().date()
        entry = store.watchlist.get(record.alert_id)

        if entry is not None:
            captures = sorted(entry.captures, key=lambda c: c.week)
            attempted = {c.week for c in captures}
            started_on: date | None = entry.started_on
            due = due_weeks(entry.started_on, today, attempted)
            remaining = _weeks_needing_backfill(floor, entry.started_on, attempted)
        else:
            captures = []
            started_on = None
            due = []
            remaining = _weeks_needing_backfill(floor, today, set())

        return {
            "case_id": record.case.case_id,
            "alert_id": record.alert_id,
            "parcel_id": record.parcel_id,
            "alert_tier": alert_tier,
            "watchable": watchable,
            "started_on": started_on.isoformat() if started_on is not None else None,
            "cadence": "weekly",
            "captures": [c.to_dict() for c in captures],
            "due_weeks": [week.key for week in due],
            "backfill_floor": floor.isoformat(),
            "remaining_backfill_weeks": len(remaining),
        }

    @app.post("/cases/{case_id}/imagery/backfill", status_code=status.HTTP_201_CREATED)
    def backfill_case_imagery(
        case_id: str,
        store: StoreDep,
        user: Annotated[User, Depends(require_roles(*_WATCH_ROLES))],
        body: Annotated[
            CaseImageryBackfillRequest, Body(default_factory=CaseImageryBackfillRequest)
        ],
    ) -> dict[str, Any]:
        floor = _imagery_backfill_floor()
        scope = _user_scope(store, user)

        # Phase 1 (locked): resolve+scope the case, validate the request,
        # get-or-create the alert's WatchEntryRecord, and reserve the
        # weeks this call will attempt in `entry.in_flight` -- reusing the
        # exact same reservation field POST /watchlist/{id}/captures uses,
        # so a backfill and a forward capture run (or two concurrent
        # backfills) for the same alert can never double-attempt a week.
        with store.lock:
            record = store.cases.get(case_id)
            if record is None or record.jurisdiction_id not in scope:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND, detail="case not found"
                )

            alert = store.alerts.get(record.alert_id)
            if alert is None or AlertTier(alert["tier"]) != AlertTier.RED:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                    detail="only RED-tier alerts can be backfilled",
                )

            effective_from = body.from_date if body.from_date is not None else floor
            if effective_from < floor:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                    detail=(
                        f"from date {effective_from.isoformat()} is earlier than the "
                        f"imagery backfill floor {floor.isoformat()}"
                    ),
                )

            entry = store.watchlist.get(record.alert_id)
            created_entry = False
            if entry is None:
                entry = WatchEntryRecord(
                    alert_id=record.alert_id,
                    parcel_id=record.parcel_id,
                    started_on=store.clock().date(),
                    watched_by=user.sub,
                )
                store.watchlist[record.alert_id] = entry
                created_entry = True

            already = {c.week for c in entry.captures} | entry.in_flight
            needed = _weeks_needing_backfill(effective_from, entry.started_on, already)
            this_round = needed[-body.max_weeks :] if needed else []
            remaining_after = len(needed) - len(this_round)

            entry.in_flight.update(week.key for week in this_round)
            attempted_at = store.clock()
            provider = store.imagery_provider
            registry = store.scene_registry
            geometry = store.parcels[entry.parcel_id]["geometry"]

        # Phase 2 (unlocked): the actual provider fetches, released for the
        # same reason as POST /watchlist/{id}/captures -- never hold
        # store.lock across provider I/O.
        try:
            results: list[CaptureAttempt] = [
                capture_week(
                    provider,
                    registry,
                    geometry=geometry,
                    week=week,
                    attempted_at=attempted_at,
                )
                for week in this_round
            ]
        finally:
            if this_round:
                with store.lock:
                    entry.in_flight.difference_update(week.key for week in this_round)

        # Phase 3 (locked): apply results in memory, move started_on back
        # to cover the newly-attempted weeks, and audit the run. Guard
        # against the entry having been unwatched while phase 2 was
        # in-flight -- if so, there is nothing left to record against.
        # Persisting to disk (if configured) happens after this block
        # exits, never while `store.lock` is held.
        with store.lock:
            if store.watchlist.get(record.alert_id) is not entry:
                mutated = False
                response_body = {
                    "attempted": [],
                    "started_on": entry.started_on.isoformat(),
                    "remaining_backfill_weeks": remaining_after,
                }
            else:
                if results:
                    entry.captures = sorted(entry.captures + results, key=lambda c: c.week)
                    # started_on is a plain calendar date (see WatchEntryRecord),
                    # not week-aligned -- when this round reached all the way
                    # back to `effective_from` (remaining_after == 0), snap to
                    # that exact requested date rather than the Monday of its
                    # ISO week, so a full backfill to the floor reports
                    # started_on == the floor exactly, as the contract shows.
                    # A partial round (more weeks still owed) instead advances
                    # started_on to the Monday of the earliest week actually
                    # attempted this round. Either way, `min` keeps the update
                    # monotonically backward-only, which is what makes two
                    # concurrent backfills converge on the correct final value
                    # regardless of which one's phase 3 runs last.
                    candidate = effective_from if remaining_after == 0 else this_round[0].start
                    entry.started_on = min(entry.started_on, candidate)

                mutated = created_entry or bool(results)
                if mutated:
                    store.record_audit(
                        actor=user.sub,
                        action="watch.backfill",
                        object_type="watch",
                        object_id=record.alert_id,
                    )

                response_body = {
                    "attempted": [result.to_dict() for result in results],
                    "started_on": entry.started_on.isoformat(),
                    "remaining_backfill_weeks": remaining_after,
                }

        if mutated:
            store.persist_now()
        return response_body

    @app.get("/cases/{case_id}/imagery/{week}/image")
    def get_case_scene_image(
        case_id: str,
        week: str,
        request: Request,
        store: StoreDep,
        user: CurrentUser,
    ) -> Response:
        # Scoped through the case exactly like GET /cases/{case_id}/imagery
        # above: out-of-scope must stay indistinguishable from missing, so
        # this reuses that same check and that same 404 detail rather than
        # anything week-specific.
        week_ref = _parse_week_or_422(week)
        record_case = store.cases.get(case_id)
        scope = _user_scope(store, user)
        if record_case is None or record_case.jurisdiction_id not in scope:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="case not found")

        entry = store.watchlist.get(record_case.alert_id)
        if entry is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"no capture attempt recorded for week {week_ref.key!r}",
            )

        record = _require_captured_scene(store, entry.captures, week_ref.key)
        return _scene_image_response(store, user, request, record)

    # ------------------------------------------------------------------
    # Jurisdictions
    # ------------------------------------------------------------------

    @app.get("/jurisdictions")
    def list_jurisdictions(store: StoreDep, user: CurrentUser) -> list[dict[str, Any]]:
        # Deliberately NOT jurisdiction-scoped: this is administrative
        # reference data (the full tree), needed so a caller can pick a
        # handover target outside their own scope -- e.g. the case-transfer
        # UI must be able to list dist-b's taluks for a dist-a officer.
        return [
            {
                "id": jurisdiction_id,
                "name": JURISDICTION_NAMES.get(jurisdiction_id, jurisdiction_id),
                "parent_id": parent_id,
            }
            for jurisdiction_id, parent_id in store.jurisdiction_rows
        ]

    # ------------------------------------------------------------------
    # Imagery
    # ------------------------------------------------------------------

    @app.post("/imagery/scenes", status_code=status.HTTP_201_CREATED)
    def ingest_scene(
        body: SceneIngest,
        store: StoreDep,
        user: Annotated[User, Depends(require_roles(Role.DATA_ADMIN))],
    ) -> dict[str, Any]:
        data = base64.b64decode(body.data_base64)
        try:
            record = store.scene_registry.register(
                data,
                scene_id=body.scene_id,
                captured_at=body.captured_at,
                sensor=body.sensor,
                resolution_m=body.resolution_m,
                cloud_pct=body.cloud_pct,
                source=body.source,
                href=body.href,
            )
        except DuplicateScene as exc:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT, detail=str(exc)
            ) from exc

        store.record_audit(
            actor=user.sub,
            action="imagery.scene.ingest",
            object_type="scene",
            object_id=record.scene_id,
            extra={"scene_id": record.scene_id, "sha256": record.sha256},
        )
        store.persist_now()
        return _scene_to_dict(record)

    @app.get("/imagery/scenes/{scene_id}")
    def get_scene(scene_id: str, store: StoreDep, user: CurrentUser) -> dict[str, Any]:
        try:
            record = store.scene_registry.get(scene_id)
        except KeyError:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="scene not found"
            ) from None
        return _scene_to_dict(record)

    return app
