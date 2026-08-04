"""FastAPI application factory.

Every mutating endpoint appends an audit entry to the store's hash chain
before returning, so the chain is a complete record of who changed what
and when. All read endpoints are jurisdiction-scoped: a caller only ever
sees rows whose jurisdiction_id lies within JurisdictionTree.scope_ids of
their own jurisdiction_id. Parcels outside scope 404 rather than 403 so
we don't leak that they exist.
"""

import base64
import math
import os
import re
from datetime import UTC, datetime, timedelta
from typing import Annotated, Any

from fastapi import Depends, FastAPI, HTTPException, Query, Response, status
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, StringConstraints, field_validator

from mapencroach.api.auth import (
    Role,
    User,
    create_token,
    current_user,
    require_roles,
    signing_secret,
    using_default_secret,
)
from mapencroach.api.store import JURISDICTION_NAMES, CaseRecord, Store
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
from mapencroach.imagery.registry import DuplicateScene, SceneRecord

_VALID_GRADES = {"A", "B", "C"}

# Lowercase slug, hyphen-separated, 1-39 chars, no leading hyphen.
_TAG_PATTERN = re.compile(r"[a-z0-9][a-z0-9-]{0,38}")

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
        "stac_item": record.stac_item,
    }


def create_app(store: Store | None = None) -> FastAPI:
    """Build the FastAPI app.

    If no store is supplied, one is created automatically: seeded with
    demo data when MAPENCROACH_DEMO=1, otherwise empty. `uvicorn
    "mapencroach.api.app:create_app" --factory` picks this up with no
    extra wiring.
    """
    demo_mode = os.environ.get("MAPENCROACH_DEMO") == "1"
    if not demo_mode and using_default_secret():
        raise RuntimeError(
            "MAPENCROACH_JWT_SECRET is not set (or is the insecure development "
            "default). Refusing to start outside demo mode: anyone who has read "
            "the public repo could mint a valid data_admin token. Set "
            "MAPENCROACH_JWT_SECRET to a strong secret, or set MAPENCROACH_DEMO=1 "
            "for a local demo."
        )
    if store is None:
        store = Store.seed_demo() if demo_mode else Store()

    app = FastAPI(title="mapencroach API")
    app.state.store = store

    cors_origins = [
        origin.strip()
        for origin in os.environ.get(
            "MAPENCROACH_CORS_ORIGINS", "http://localhost:3000"
        ).split(",")
        if origin.strip()
    ]
    app.add_middleware(
        CORSMiddleware,
        allow_origins=cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    def get_store() -> Store:
        return app.state.store

    StoreDep = Annotated[Store, Depends(get_store)]
    CurrentUser = Annotated[User, Depends(current_user)]

    # ------------------------------------------------------------------
    # Parcels
    # ------------------------------------------------------------------

    @app.get("/parcels")
    def list_parcels(store: StoreDep, user: CurrentUser) -> dict[str, Any]:
        scope = _user_scope(store, user)
        features = [
            _parcel_to_feature(p)
            for p in store.parcels.values()
            if p["jurisdiction_id"] in scope
        ]
        return {"type": "FeatureCollection", "features": features}

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
        tags: list[str] = parcel.setdefault("tags", [])
        if normalized not in tags:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="tag not found")

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

        @app.post("/demo/login")
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
                secret=signing_secret(),
                expires_at=datetime.now(UTC) + timedelta(hours=8),
            )
            return {
                "token": token,
                "persona": _enrich_persona(persona, store),
                "expires_in_hours": 8,
            }

    # ------------------------------------------------------------------
    # Alerts
    # ------------------------------------------------------------------

    @app.get("/alerts")
    def list_alerts(
        store: StoreDep,
        user: CurrentUser,
        tier: str | None = Query(default=None),
        status_filter: str | None = Query(default=None, alias="status"),
    ) -> list[dict[str, Any]]:
        scope = _user_scope(store, user)
        results = []
        for alert in store.alerts.values():
            parcel = store.parcels.get(alert["parcel_id"])
            if parcel is None or parcel["jurisdiction_id"] not in scope:
                continue
            if tier is not None and alert["tier"] != tier:
                continue
            if status_filter is not None and alert["status"] != status_filter:
                continue
            results.append(dict(alert))
        return results

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
        store.alerts[alert_id] = alert
        store.record_audit(
            actor=user.sub, action="alert.create", object_type="alert", object_id=alert_id
        )
        return alert

    # ------------------------------------------------------------------
    # Cases
    # ------------------------------------------------------------------

    @app.get("/cases")
    def list_cases(store: StoreDep, user: CurrentUser) -> list[dict[str, Any]]:
        scope = _user_scope(store, user)
        results = []
        for record in store.cases.values():
            if record.jurisdiction_id not in scope:
                continue
            events = record.case.events
            results.append(
                {
                    "id": record.case.case_id,
                    "alert_id": record.alert_id,
                    "parcel_id": record.parcel_id,
                    "state": record.case.state.value,
                    "state_since": events[-1].occurred_at.isoformat() if events else None,
                }
            )
        return results

    @app.get("/cases/{case_id}")
    def get_case(case_id: str, store: StoreDep, user: CurrentUser) -> dict[str, Any]:
        record = store.cases.get(case_id)
        scope = _user_scope(store, user)
        if record is None or record.jurisdiction_id not in scope:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="case not found")

        return _case_to_detail(record)

    @app.post("/cases/{case_id}/transitions", status_code=status.HTTP_201_CREATED)
    def transition_case(
        case_id: str,
        body: TransitionRequest,
        store: StoreDep,
        user: Annotated[User, Depends(require_roles(Role.CASE_OFFICER))],
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
