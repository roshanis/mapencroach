"""FastAPI application factory.

Every mutating endpoint appends an audit entry to the store's hash chain
before returning, so the chain is a complete record of who changed what
and when. All read endpoints are jurisdiction-scoped: a caller only ever
sees rows whose jurisdiction_id lies within JurisdictionTree.scope_ids of
their own jurisdiction_id. Parcels outside scope 404 rather than 403 so
we don't leak that they exist.
"""

import json
import os
import re
from datetime import UTC, date, datetime, timedelta
from typing import Annotated, Any

import httpx
from fastapi import Depends, FastAPI, HTTPException, Query, Response, status
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from mapencroach.api.auth import (
    Role,
    User,
    create_token,
    current_user,
    require_roles,
    signing_secret,
)
from mapencroach.api.store import JURISDICTION_NAMES, Store
from mapencroach.domain.alerts import severity_score
from mapencroach.domain.case_engine import (
    Case,
    CaseState,
    InvalidTransition,
    MissingArtifact,
    allowed_transitions,
    required_artifacts_for,
)
from mapencroach.domain.identifiers import identifier_block

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


class BoundaryGradePatch(BaseModel):
    grade: str
    survey_reference: str


class AlertCreate(BaseModel):
    parcel_id: str
    tier: str
    area_m2: float
    detected_at: datetime


class TagCreate(BaseModel):
    tag: str


class PersonaLogin(BaseModel):
    persona_id: str


class BaselineDeclare(BaseModel):
    aoi_jurisdiction_id: str
    baseline_date: str  # ISO date
    scene_ids: list[str]
    note: str = ""


class DispositionCreate(BaseModel):
    field_verified_real: bool
    note: str = ""


class RorImportRequest(BaseModel):
    csv: str
    source: str


class GcpCreate(BaseModel):
    id: str
    lat: float
    lon: float
    accuracy_m: float
    surveyed_on: str  # ISO date
    source: str
    elevation_m: float | None = None


class OrthoRmsePatch(BaseModel):
    rmse_m: float


class SurveyCreate(BaseModel):
    survey_ref: str
    method: str  # DGPS | ETS | drone_rtk
    accuracy_m: float
    surveyed_on: str  # ISO date
    resulting_grade: str


_SURVEY_METHODS = {"DGPS", "ETS", "drone_rtk"}
# Lower rank = better. Surveys compound the map's quality; they never degrade it.
_GRADE_RANK = {"A": 0, "B": 1, "C": 2}


class TransitionRequest(BaseModel):
    to_state: str
    artifacts: dict[str, str] | None = None
    note: str = ""


def _parcel_to_feature(parcel: dict[str, Any]) -> dict[str, Any]:
    identifiers = identifier_block(parcel)
    return {
        "type": "Feature",
        # Identifiers cite the parcel; this geometry is the legal authority
        # on extent (see domain/identifiers.py).
        "geometry": parcel["geometry"],
        "properties": {
            "id": parcel["id"],
            "survey_no": parcel["survey_no"],
            "ulpin": parcel["ulpin"],
            "official_identifier": identifiers["official_identifier"],
            "digipin": identifiers["digipin"],
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


def create_app(store: Store | None = None) -> FastAPI:
    """Build the FastAPI app.

    If no store is supplied, one is created automatically: seeded with
    demo data when MAPENCROACH_DEMO=1, otherwise empty. `uvicorn
    "mapencroach.api.app:create_app" --factory` picks this up with no
    extra wiring.
    """
    demo_mode = os.environ.get("MAPENCROACH_DEMO") == "1"
    if store is None:
        db_url = os.environ.get("MAPENCROACH_DB_URL")
        if db_url:
            from mapencroach.db.store import create_database_store

            store = create_database_store(db_url, demo=demo_mode)
        else:
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

        parcel = store.set_boundary_grade(parcel_id, body.grade)
        store.record_audit(
            actor=user.sub,
            action="parcel.boundary_grade.update",
            object_type="parcel",
            object_id=parcel_id,
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

        parcel, added = store.add_parcel_tag(parcel_id, tag)
        if not added:
            response.status_code = status.HTTP_200_OK
            return _parcel_to_feature(parcel)

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
        updated = store.remove_parcel_tag(parcel_id, normalized)
        if updated is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="tag not found")
        parcel = updated

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
    # Surveys (DGPS/ETS ground truth -> boundary grade promotion)
    # ------------------------------------------------------------------

    @app.post("/parcels/{parcel_id}/surveys", status_code=status.HTTP_201_CREATED)
    def upload_survey(
        parcel_id: str,
        body: SurveyCreate,
        store: StoreDep,
        user: Annotated[User, Depends(require_roles(Role.SURVEY_OFFICER, Role.DATA_ADMIN))],
    ) -> dict[str, Any]:
        parcel = store.parcels.get(parcel_id)
        scope = _user_scope(store, user)
        if parcel is None or parcel["jurisdiction_id"] not in scope:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="parcel not found")

        if body.method not in _SURVEY_METHODS:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail=f"unknown survey method {body.method!r}",
            )
        if body.resulting_grade not in _GRADE_RANK:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail=f"invalid grade {body.resulting_grade!r}",
            )
        current_grade = parcel["boundary_grade"]
        if _GRADE_RANK[body.resulting_grade] > _GRADE_RANK[current_grade]:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=(
                    f"survey grade {body.resulting_grade} would downgrade parcel "
                    f"from {current_grade}; surveys only ever improve the map"
                ),
            )

        store.save_survey(
            {
                "parcel_id": parcel_id,
                "surveyor_id": user.sub,
                "survey_ref": body.survey_ref,
                "method": body.method,
                "accuracy_m": body.accuracy_m,
                "surveyed_on": body.surveyed_on,
                "resulting_grade": body.resulting_grade,
            }
        )
        parcel = store.set_boundary_grade(parcel_id, body.resulting_grade)
        store.record_audit(
            actor=user.sub,
            action="parcel.survey.upload",
            object_type="parcel",
            object_id=f"{parcel_id}:{body.survey_ref}",
        )
        return _parcel_to_feature(parcel)

    # ------------------------------------------------------------------
    # Ground control points & ortho accuracy (requisition §3.3)
    # ------------------------------------------------------------------

    @app.post("/gcps", status_code=status.HTTP_201_CREATED)
    def register_gcp(
        body: GcpCreate,
        store: StoreDep,
        user: Annotated[User, Depends(require_roles(Role.SURVEY_OFFICER, Role.DATA_ADMIN))],
    ) -> dict[str, Any]:
        gcp = {
            "id": body.id,
            "geometry": {"type": "Point", "coordinates": [body.lon, body.lat]},
            "elevation_m": body.elevation_m,
            "accuracy_m": body.accuracy_m,
            "surveyed_on": body.surveyed_on,
            "source": body.source,
        }
        try:
            store.save_gcp(gcp)
        except ValueError as exc:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT, detail=str(exc)
            ) from exc
        store.record_audit(
            actor=user.sub, action="gcp.register", object_type="gcp", object_id=body.id
        )
        return gcp

    @app.get("/gcps")
    def list_gcps(
        store: StoreDep,
        user: Annotated[User, Depends(require_roles(Role.SURVEY_OFFICER, Role.DATA_ADMIN))],
    ) -> list[dict[str, Any]]:
        return sorted(store.gcps.values(), key=lambda g: g["id"])

    @app.patch("/scenes/{scene_id}/ortho-rmse")
    def set_ortho_rmse(
        scene_id: str,
        body: OrthoRmsePatch,
        store: StoreDep,
        user: Annotated[User, Depends(require_roles(Role.DATA_ADMIN))],
    ) -> dict[str, Any]:
        # Accuracy is measured against GCPs, never asserted: this records
        # the measurement so exhibits can state a per-scene error bound.
        try:
            scene = store.set_scene_ortho_rmse(scene_id, body.rmse_m)
        except KeyError as exc:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="scene not found"
            ) from exc
        store.record_audit(
            actor=user.sub,
            action="scene.ortho_rmse",
            object_type="imagery_scene",
            object_id=scene_id,
        )
        return _scene_listing(scene)

    # ------------------------------------------------------------------
    # GIS layers (requisition §3 verification layers)
    # ------------------------------------------------------------------

    @app.get("/layers")
    def list_layers(
        store: StoreDep,
        user: Annotated[User, Depends(require_roles(Role.DATA_ADMIN, Role.SYSTEM_ADMIN))],
    ) -> list[dict[str, Any]]:
        return [
            {key: value for key, value in layer.items() if key != "features"}
            for layer in sorted(store.gis_layers.values(), key=lambda layer: layer["id"])
        ]

    # ------------------------------------------------------------------
    # Imagery scenes & tiles
    # ------------------------------------------------------------------

    def _scene_listing(scene: dict[str, Any]) -> dict[str, Any]:
        listed = dict(scene)
        if isinstance(listed.get("stac_item"), str):
            listed["stac_item"] = json.loads(listed["stac_item"])
        # The raw sidecar is court evidence served on demand, not a listing field.
        listed.pop("sidecar_raw", None)
        return listed

    @app.get("/scenes")
    def list_scenes(
        store: StoreDep,
        user: Annotated[User, Depends(require_roles(Role.DATA_ADMIN, Role.SYSTEM_ADMIN))],
    ) -> list[dict[str, Any]]:
        # Coverage maps are Restricted-class data: knowing what is (and is
        # not) imaged is exactly what a motivated encroacher wants.
        return sorted(
            (_scene_listing(s) for s in store.scenes.values()),
            key=lambda s: s["captured_at"],
        )

    @app.get("/tiles/{scene_id}/{z}/{x}/{y}.png")
    def get_tile(
        scene_id: str,
        z: int,
        x: int,
        y: int,
        store: StoreDep,
        user: CurrentUser,
    ) -> Response:
        scene = store.scenes.get(scene_id)
        if scene is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="scene not found")
        titiler_url = os.environ.get("MAPENCROACH_TITILER_URL")
        if not titiler_url:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="tile serving is not configured (MAPENCROACH_TITILER_URL)",
            )
        upstream = httpx.get(
            f"{titiler_url.rstrip('/')}/cog/tiles/WebMercatorQuad/{z}/{x}/{y}.png",
            params={"url": scene["href"]},
            timeout=15,
        )
        if upstream.status_code != status.HTTP_200_OK:
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=f"tile backend returned {upstream.status_code}",
            )
        return Response(content=upstream.content, media_type="image/png")

    # ------------------------------------------------------------------
    # Alerts
    # ------------------------------------------------------------------

    @app.get("/alerts")
    def list_alerts(
        store: StoreDep,
        user: CurrentUser,
        tier: str | None = Query(default=None),
        status_filter: str | None = Query(default=None, alias="status"),
        include_shadow: bool = Query(default=False),
    ) -> list[dict[str, Any]]:
        # Shadow-mode alerts are precision-measurement data, not casework:
        # only imagery admins may see them, and only on request.
        show_shadow = include_shadow and user.role in (Role.DATA_ADMIN, Role.SYSTEM_ADMIN)
        scope = _user_scope(store, user)
        results = []
        for alert in store.alerts.values():
            parcel = store.parcels.get(alert["parcel_id"])
            if parcel is None or parcel["jurisdiction_id"] not in scope:
                continue
            if alert.get("shadow", False) and not show_shadow:
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
            "tier": body.tier,
            "severity_score": score,
            "area_m2": body.area_m2,
            "status": "OPEN",
            "detected_at": body.detected_at.isoformat(),
            "shadow": False,
        }
        store.save_alert(alert)
        store.record_audit(
            actor=user.sub, action="alert.create", object_type="alert", object_id=alert_id
        )
        return alert

    # ------------------------------------------------------------------
    # Baselines (the legal anchor: declared date + pinned scene hashes)
    # ------------------------------------------------------------------

    @app.post("/baselines", status_code=status.HTTP_201_CREATED)
    def declare_baseline_endpoint(
        body: BaselineDeclare,
        store: StoreDep,
        user: Annotated[User, Depends(require_roles(Role.DATA_ADMIN))],
    ) -> dict[str, Any]:
        from mapencroach.imagery.baseline import BaselineError, declare_baseline

        scope = _user_scope(store, user)
        if body.aoi_jurisdiction_id not in scope:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="AOI not found")
        try:
            return declare_baseline(
                store,
                aoi_jurisdiction_id=body.aoi_jurisdiction_id,
                baseline_date=date.fromisoformat(body.baseline_date),
                scene_ids=body.scene_ids,
                declared_by=user.sub,
                declared_at=datetime.now(UTC),
                note=body.note,
            )
        except BaselineError as exc:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(exc)
            ) from exc

    @app.get("/baselines/{aoi_jurisdiction_id}")
    def get_baseline(
        aoi_jurisdiction_id: str, store: StoreDep, user: CurrentUser
    ) -> dict[str, Any]:
        scope = _user_scope(store, user)
        if aoi_jurisdiction_id not in scope:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="AOI not found")
        declaration = store.active_baseline(aoi_jurisdiction_id)
        if declaration is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="no baseline declared"
            )
        return declaration

    # ------------------------------------------------------------------
    # Shadow-alert dispositions & detection precision (go-live gate)
    # ------------------------------------------------------------------

    @app.post("/alerts/{alert_id}/disposition", status_code=status.HTTP_201_CREATED)
    def disposition_alert(
        alert_id: str,
        body: DispositionCreate,
        store: StoreDep,
        user: Annotated[User, Depends(require_roles(Role.DATA_ADMIN))],
    ) -> dict[str, Any]:
        from mapencroach.detection.precision import (
            DispositionError,
            record_shadow_disposition,
        )

        alert = store.alerts.get(alert_id)
        scope = _user_scope(store, user)
        parcel = store.parcels.get(alert["parcel_id"]) if alert else None
        if alert is None or parcel is None or parcel["jurisdiction_id"] not in scope:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="alert not found")
        try:
            return record_shadow_disposition(
                store,
                alert_id,
                field_verified_real=body.field_verified_real,
                actor=user.sub,
                verified_at=datetime.now(UTC),
                note=body.note,
            )
        except DispositionError as exc:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT, detail=str(exc)
            ) from exc

    @app.get("/analytics/detection-precision")
    def detection_precision(
        store: StoreDep,
        user: Annotated[User, Depends(require_roles(Role.DATA_ADMIN, Role.SYSTEM_ADMIN))],
    ) -> dict[str, Any]:
        from mapencroach.detection.precision import precision_report

        scope = _user_scope(store, user)
        scoped_alerts = [
            alert
            for alert in store.alerts.values()
            if (parcel := store.parcels.get(alert["parcel_id"])) is not None
            and parcel["jurisdiction_id"] in scope
        ]
        return precision_report(scoped_alerts)

    # ------------------------------------------------------------------
    # Revenue-record (RoR) import: khasra numbers -> parcel aliases
    # ------------------------------------------------------------------

    @app.post("/parcels/ror-import")
    def ror_import(
        body: RorImportRequest,
        store: StoreDep,
        user: Annotated[User, Depends(require_roles(Role.DATA_ADMIN))],
    ) -> dict[str, Any]:
        import tempfile
        from pathlib import Path

        from mapencroach.cadastral.revenue import link_khasra, load_ror_csv

        # Personal data never enters through this endpoint: occupant names
        # are dropped at load time (DPDP minimization; include_personal is
        # deliberately not exposed over HTTP).
        with tempfile.NamedTemporaryFile(
            "w", suffix=".csv", delete=False, encoding="utf-8"
        ) as handle:
            handle.write(body.csv)
            csv_path = Path(handle.name)
        try:
            imported = load_ror_csv(csv_path)
        finally:
            csv_path.unlink(missing_ok=True)

        if imported.status == "rejected":
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail={"errors": imported.errors},
            )

        scope = _user_scope(store, user)
        scoped_parcels = [
            p for p in store.parcels.values() if p["jurisdiction_id"] in scope
        ]
        linkage = link_khasra(imported.records, scoped_parcels, source=body.source)

        persisted = 0
        for parcel_id, alias in linkage.aliases:
            store.add_parcel_aliases(parcel_id, [alias])
            persisted += 1
        store.record_audit(
            actor=user.sub,
            action="parcel.ror_import",
            object_type="parcel_identifier",
            object_id=f"{body.source}:{persisted}",
        )
        return {
            "records": len(imported.records),
            "linked": persisted,
            "ambiguous": len(linkage.ambiguous),
            "unmatched": len(linkage.unmatched),
        }

    # ------------------------------------------------------------------
    # Analytics (H3 hotspot aggregation for dashboards)
    # ------------------------------------------------------------------

    @app.get("/analytics/hotspots")
    def alert_hotspots(
        store: StoreDep,
        user: CurrentUser,
        resolution: int = Query(default=8, ge=5, le=11),
        tier: str | None = Query(default=None),
        status_filter: str | None = Query(default=None, alias="status"),
    ) -> dict[str, Any]:
        """Alerts aggregated onto Uber's H3 hexagonal grid.

        One row per hexagon that contains at least one visible alert in
        the caller's jurisdiction scope — the collector-dashboard heat
        view and the requisition's repeat-offense hotspot picture
        (include closed alerts via ?status=CLOSED or no filter). Shadow
        alerts never contribute: precision-measurement data must not
        shape enforcement attention.
        """
        from mapencroach.spatial.h3grid import cell_boundary_geojson, cell_for_geometry

        scope = _user_scope(store, user)
        buckets: dict[str, dict[str, Any]] = {}
        for alert in store.alerts.values():
            parcel = store.parcels.get(alert["parcel_id"])
            if parcel is None or parcel["jurisdiction_id"] not in scope:
                continue
            if alert.get("shadow", False):
                continue
            if tier is not None and alert["tier"] != tier:
                continue
            if status_filter is not None and alert["status"] != status_filter:
                continue
            cell = cell_for_geometry(parcel["geometry"], resolution)
            bucket = buckets.setdefault(
                cell,
                {
                    "cell": cell,
                    "alert_count": 0,
                    "red_alerts": 0,
                    "total_area_m2": 0.0,
                    "parcel_ids": set(),
                },
            )
            bucket["alert_count"] += 1
            if alert["tier"] == "RED":
                bucket["red_alerts"] += 1
            bucket["total_area_m2"] += alert["area_m2"]
            bucket["parcel_ids"].add(alert["parcel_id"])

        cells = [
            {
                "cell": bucket["cell"],
                "alert_count": bucket["alert_count"],
                "red_alerts": bucket["red_alerts"],
                "total_area_m2": round(bucket["total_area_m2"], 1),
                "parcel_count": len(bucket["parcel_ids"]),
                "boundary": cell_boundary_geojson(bucket["cell"]),
            }
            for bucket in buckets.values()
        ]
        cells.sort(key=lambda c: (-c["alert_count"], c["cell"]))
        return {"resolution": resolution, "cells": cells}

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
            "state": record.case.state.value,
            "events": events,
            "allowed_transitions": allowed,
            "required_artifacts": required,
        }

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
            record, event = store.transition_case(
                case_id,
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

    return app
