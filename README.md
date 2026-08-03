# mapencroach

Encroachment intelligence and case management platform for Indian state governments.
Satellite imagery flags *probable unauthorized change* on government land; officers verify,
notify, and enforce through a legally defensible workflow. Full plan: [PLAN.md](PLAN.md).

## Quick start (demo, no database needed)

**1. Backend API** (seeded with 30 demo parcels across six Haridwar–Roorkee taluks):

```bash
cd backend
uv venv .venv && uv pip install -p .venv/bin/python -e ".[dev]"   # first time only
MAPENCROACH_DEMO=1 .venv/bin/uvicorn "mapencroach.api.app:create_app" --factory
```

**2. Mint a dev token** (in another terminal):

```bash
cd backend && .venv/bin/python -c "
from datetime import datetime, timedelta, UTC
from mapencroach.api.auth import create_token
print(create_token('officer-1', 'case_officer', 'state', 'dev-secret-do-not-deploy', datetime.now(UTC)+timedelta(hours=8)))"
```

**3. Web console:**

```bash
cd web
npm install                                # first time only
NEXT_PUBLIC_API_URL=http://localhost:8000 NEXT_PUBLIC_API_TOKEN=<token-from-step-2> npm run dev
```

Open http://localhost:3000 for the product landing page, then enter the command
map at http://localhost:3000/console. Alert queue, parcel profiles, and case
detail remain linked from the operational console.
Omit both env vars to run the UI on built-in fixture data with no backend at all.

Google Maps is the production map provider when both
`NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` and `NEXT_PUBLIC_GOOGLE_MAP_ID` are set. The
console falls back to MapLibre when either value is absent or Google cannot
load; never commit the API key, and restrict it to approved web referrers and
the Maps JavaScript API.

## Run against a database (persistent mode)

Set `MAPENCROACH_DB_URL` and the API swaps its in-memory store for the
SQLAlchemy/PostGIS-backed one (schema is created automatically; with
`MAPENCROACH_DEMO=1` an empty database is seeded with the demo dataset):

```bash
MAPENCROACH_DB_URL=postgresql+psycopg://mapencroach:...@localhost/mapencroach \
MAPENCROACH_DEMO=1 .venv/bin/uvicorn "mapencroach.api.app:create_app" --factory
```

Any SQLAlchemy URL works — SQLite for a quick persistent dev setup,
PostGIS in production. The jurisdiction hierarchy is data, not schema:
set `MAPENCROACH_JURISDICTION_LEVELS=authority,zone,ward` for a
development-authority deployment (default `state,district,taluk,village`).

**Production auth (Keycloak/OIDC):** set `MAPENCROACH_OIDC_JWKS_URL` to the
realm's `jwks_uri` (plus `MAPENCROACH_OIDC_ISSUER` / `MAPENCROACH_OIDC_AUDIENCE`).
Tokens must then be RS256-signed by the realm — the HS256 dev-token path is
disabled entirely. Roles map from Keycloak realm roles (exactly one
mapencroach role per user); `jurisdiction_id` comes from a user-attribute
claim.

## Imagery, detection & GIS layers

The satellite side of the platform lives in three backend packages:

- **`imagery/`** — hash-first ingestion: the delivered GeoTIFF and its
  Cartosat sidecar (.txt/.xml) are SHA-256 hashed *before* any processing,
  then converted to a Cloud-Optimized GeoTIFF and cataloged as a STAC item
  carrying every evidence hash. `GET /scenes` lists the catalog (imagery
  admins only); `GET /tiles/{scene}/{z}/{x}/{y}.png` proxies TiTiler
  (`MAPENCROACH_TITILER_URL`) behind auth.
- **`detection/`** — the change-detection engine (requires database mode).
  `run_detection()` screens every covered parcel (NDVI drop + brightness
  rise on 4-band VNIR), records per-run candidates, and raises an AMBER
  alert through the standard severity path only when change persists across
  ≥2 observation dates. Alerts start in **shadow mode** (invisible to
  officers) until a `live=True` run after precision calibration.
  `confirm_alert()` upgrades to RED when change falls outside known
  building footprints, or dismisses with a reason code; approved-plan
  deviation is measured when a plan layer exists.
- **`cadastral/layers.py`** — the HRDA verification layers (khasra, master
  plan, ELU/PLU, green belt, roads, water bodies, wards, building
  footprints, approved plans) with the same accept/quarantine/reject
  contract as parcels; road/canal layers are linear and get linear topology
  QA. `detection/enrichment.py` joins these into alert flags (green-belt
  intersection, ELU/PLU mismatch, right-of-way breach, water proximity).
  `POST /parcels/{id}/surveys` records DGPS/ETS results and promotes the
  boundary grade — surveys only ever improve the map.

## Tests

```bash
cd backend && .venv/bin/pytest --cov && .venv/bin/ruff check .   # 432 tests
cd web && npm test && npm run build                              # 24 tests
```

## Full dev stack (PostGIS, Keycloak, MinIO, TiTiler)

```bash
docker compose up -d
```

## Deploy a shareable demo

See [DEPLOY.md](DEPLOY.md) — console on Vercel, API on Render (demo data only).

## Layout

| Path | What |
|------|------|
| `backend/src/mapencroach/domain/` | Jurisdiction tree (row-level scoping), case state machine (due process encoded), alert severity |
| `backend/src/mapencroach/cadastral/` | Topology QA + parcel & GIS-layer ingestion (accept / quarantine / reject) |
| `backend/src/mapencroach/audit/` | Tamper-evident hash chain |
| `backend/src/mapencroach/imagery/` | Hash-first COG/STAC ingestion, Cartosat sidecar preservation |
| `backend/src/mapencroach/detection/` | Change screening, persistence gating, confirmation, enrichment |
| `backend/src/mapencroach/db/` | PostGIS/SQLite schema + persistent store |
| `backend/src/mapencroach/api/` | FastAPI: JWT/OIDC auth, RBAC, jurisdiction-scoped endpoints |
| `web/` | Next.js console with Google Maps and a MapLibre fallback |
| `PLAN.md` / `PLAN.html` | Implementation plan v2.0 (Builder's Edition) |
| `agents-build-log.md` | Agent build log |
