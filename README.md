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

## Tests

```bash
cd backend && .venv/bin/pytest --cov && .venv/bin/ruff check .   # 200 tests
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
| `backend/src/mapencroach/cadastral/` | Topology QA + file ingestion (accept / quarantine / reject) |
| `backend/src/mapencroach/audit/` | Tamper-evident hash chain |
| `backend/src/mapencroach/imagery/` | Hash-on-ingest scene registry (STAC) |
| `backend/src/mapencroach/api/` | FastAPI: JWT auth, RBAC, jurisdiction-scoped endpoints |
| `web/` | Next.js + MapLibre admin console |
| `PLAN.md` / `PLAN.html` | Implementation plan v2.0 (Builder's Edition) |
| `agents-build-log.md` | Agent build log |
