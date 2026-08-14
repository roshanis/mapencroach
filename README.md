# mapencroach

Encroachment intelligence and case management platform for Indian state governments.
Satellite imagery flags *probable unauthorized change* on government land; officers verify,
notify, and enforce through a legally defensible workflow. Full plan: [PLAN.md](PLAN.md).

## Quick start (demo, no database needed)

**1. Backend API** (seeded with 42 demo parcels across three unrelated
authorities in three states — see
[Three authorities](#three-authorities-in-the-demo-seed)):

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
NEXT_PUBLIC_API_URL=http://localhost:8000 MAPENCROACH_API_TOKEN=<token-from-step-2> npm run dev
```

`MAPENCROACH_API_TOKEN` is read only on the server. Do not use
`NEXT_PUBLIC_API_TOKEN`: any `NEXT_PUBLIC_*` value is inlined into the browser
bundle, so a bearer token set there is readable by every visitor. The console
warns and ignores it if set. In the browser the console authenticates with the
token cookie set at sign-in.

Open http://localhost:3000 for the product landing page, then enter the command
map at http://localhost:3000/console. Alert queue, parcel profiles, and case
detail remain linked from the operational console. The parcel workflow includes
matched historical-imagery comparison and role-gated boundary review; the case
workflow includes a clearly marked training notice draft and an unsigned,
print-ready evidence packet.
Omit both env vars to run the UI on built-in fixture data with no backend at all.

Google Maps is the production map provider when both
`NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` and `NEXT_PUBLIC_GOOGLE_MAP_ID` are set. The
console falls back to MapLibre when either value is absent or Google cannot
load; never commit the API key, and restrict it to approved web referrers and
the Maps JavaScript API.

## Three authorities in the demo seed

The seed spans three unrelated governments in three states, so jurisdiction
scoping can be demonstrated across real boundaries rather than only between
divisions of one body:

```
mapencroach demo deployment          <- deployment root, no officer is scoped here
├── Haridwar–Roorkee Development Authority   (Uttarakhand)  30 parcels
│   ├── Haridwar Division  → Haridwar City, Kankhal, Laksar
│   └── Roorkee Division   → Roorkee City, Bahadarabad, Narsan
├── Government of Kerala
│   └── Alappuzha District → Ambalapuzha Taluk               5 parcels
└── Government of Maharashtra
    └── Pune District      → Haveli Taluk, Mulshi Taluk      7 parcels
```

Each is a sibling of the others, not nested inside one: they sit in different
states under different governments, and modelling any as a taluk of HRDA would
put a false claim about Indian administrative geography in front of every
officer. The `deployment` root exists only because the tree is single-rooted by
construction; **no persona is scoped to it**, since a login spanning Uttarakhand,
Kerala and Maharashtra would frame the map on all of India and corresponds to no
real officer.

Two consequences worth knowing:

- **Authority-wide is not deployment-wide.** A token scoped to `state` sees all
  30 HRDA parcels and none of Kerala's. Anything that means "every jurisdiction
  that exists" must use the tree's own root (`tree.root_id`), not an authority.
- **Cases cannot be transferred across authorities.** Handover between districts
  of one authority is the point of `POST /cases/{id}/transfer`; handing an HRDA
  case to Kerala is refused with 409, because it would move the case to a
  government with no power over the land and delete it from the only officers
  who can act on it. `GET /jurisdictions` is scoped to the caller's authority to
  match — it feeds the console's transfer-target picker, so every option it
  offers must be one the API will actually accept.

Kerala and Maharashtra each carry their own case, so those logins have a real
due-process rail to work rather than only alerts — and they sit at different
steps on purpose: Ambalapuzha at `INSPECTED`, where the **evidence** guard
refuses a show-cause notice with no notice document or dispatch proof, and Pune
at `SHOW_CAUSE_ISSUED`, where the **sequence** guard refuses a jump straight to
an order. The console groups the persona switcher by authority, so the three
governments read as separate rather than as one long list.

Parcel geometry traces the real ground. Ambalapuzha: the Vembanad/Punnamada
backwater on its east, the Alappuzha–Changanassery canal through the middle,
Kuttanad's below-sea-level paddy to the south-east, the temple town on NH-66,
and the coastal strip on the Arabian Sea. Pune: the Mula-Mutha riverbed and the
Khadakwasla canal system in Haveli, the hill reserved forests, and in Mulshi the
reservoir backwater and the Hinjawadi IT-belt fringe.

The console's built-in fixture mode (no backend) is a separate illustrative
dataset with `PCL-…` parcel ids and mirrors none of this seed, the Kerala and
Maharashtra authorities included.

## Real Sentinel-2 scenes over a parcel

The API discovers real Sentinel-2 imagery for any parcel via the public
[Earth Search](https://earth-search.aws.element84.com/v1) STAC catalog
(AWS open data, free, no account needed):

```bash
curl -H "Authorization: Bearer <token>" \
  "http://localhost:8000/parcels/parcel-9/scenes?days=90&max_cloud_pct=40&limit=8"
```

Each scene includes a browsable `thumbnail_href` and a `visual_href`
(10 m true-colour COG). Discovery is separate from ingestion: a scene
only enters the hash-on-ingest registry once its bytes are downloaded
and sha256-hashed (`mapencroach.imagery.stac_search.ingest_candidate`).
Point at a different STAC catalog with `MAPENCROACH_STAC_URL`.

## H3 spatial index (Uber H3)

H3 hexagons are an analytical/index layer only — the exact parcel geometry
remains the legal authority for every case decision. Resolutions are matched
to Indian parcel sizes:

```
GET /parcels/{id}/h3?res=13      cell cover of a parcel (res 13 ≈ 44 m² cells)
GET /alerts/h3-summary?res=9     in-scope alert density for dashboard heatmaps
```

Created alerts carry an `h3_cell` (res 12, ~20 m across): two detections in
the same cell are almost certainly the same encroachment, making it a natural
spatial dedup key. Rollups use the H3 hierarchy, so fine cells aggregate to
village (res 9) or taluk (res 7) views for free. The console's existing H3
grid control (`web/src/lib/h3-grid.ts`) renders the same cell scheme
client-side.

## Tests

```bash
cd backend && .venv/bin/pytest --cov && .venv/bin/ruff check .
cd web && npm test && npm run lint && npm run build
```

## Weekly imagery snapshots

A RED alert can be put under a weekly-snapshot watch, and a red-flagged case
can backfill its imagery history to a floor date so the record shows *when* a
change appeared rather than only that it exists now:

```
POST   /alerts/{id}/watch             start watching a RED alert
POST   /watchlist/{id}/captures       run the weeks that are due
GET    /cases/{id}/imagery            a case's weekly timeline
POST   /cases/{id}/imagery/backfill   fill earlier weeks, chunked
```

Each week is an explicit row: captured (sha256-anchored on ingest, via the same
registry that backs court exhibits) or empty *with the reason it is empty* —
cloud percentage or no coverage. Gaps are recorded facts, not missing rows,
because an evidence timeline with unexplained holes is worse than one that
documents them. Monsoon weeks over Haridwar–Roorkee routinely have no usable
optical scene.

Captured scenes are retained and can be fetched back:

```
GET /watchlist/{alert_id}/weeks/{week}/image
GET /cases/{case_id}/imagery/{week}/image
```

Bytes go to a blob store keyed by their own sha256, so storage cannot disagree
with the registry about which bytes are which. Writes and reads both re-hash and
refuse on mismatch, so a scene corrupted on disk fails the read rather than
being served as evidence. `MAPENCROACH_BLOB_ROOT` sets the location (default
`data/scenes`, gitignored). Retention is opt-in at the registry level, so a week
may legitimately hold a hash with no image — the console distinguishes that from
an image it simply could not load, and only says "not retained" when the server
actually reports the bytes are absent.

Two limits worth knowing before relying on this:

- **Nothing runs on a schedule.** Captures happen when the endpoint is called.
  Point a cron or external scheduler at it; the console's buttons are explicit
  user-triggered actions and say so.
- **Sentinel-2 retrieval is unverified against the live Copernicus service.**
  It is written to the documented API and tested against mocked HTTP only.
  Without `COPERNICUS_CLIENT_ID` / `COPERNICUS_CLIENT_SECRET` the app uses a
  deterministic synthetic provider, which is what demo mode runs on.

`MAPENCROACH_IMAGERY_BACKFILL_FLOOR` (default `2026-01-01`) bounds how far back
a backfill may reach. A request for an earlier date is refused rather than
quietly clamped, so returned coverage always matches what was asked for.

### Running captures on a schedule

There is no in-process scheduler. `mapencroach-capture` is the entry point a
cron or systemd timer drives:

```bash
mapencroach-capture --api-url https://<your-api> --max-weeks 4   # weekly, via the API
mapencroach-capture --dry-run                                    # report only, change nothing
```

Exit status is non-zero when any entry hit a provider error, so a failed run
surfaces instead of passing silently.

Prefer the `--api-url` form. Watch entries, capture history, the scene index and
the audit chain persist to `MAPENCROACH_STATE_PATH` (default `data/state.json`)
as a whole document, and the in-process lock does not reach across processes —
so running the CLI in direct mode beside a live API makes two writers, and the
last one to save wins. A week captured by one can disappear from the record kept
by the other, even though the bytes are safely in the blob store. Driving the
API keeps a single writer.

State loading fails closed: a corrupt, truncated, or tampered state file (one
whose audit chain no longer verifies) stops startup rather than continuing with
an empty timeline.

## Backing services (PostGIS, Keycloak, MinIO, TiTiler)

```bash
docker compose up -d
```

These are the services the platform is being built toward, not a running
integration: the API still keeps everything in memory, and `db/models.py`
defines the schema without an engine bound to it. Bring the stack up when
working on persistence, object storage, or tiling — the demo above and both
test suites need none of it.

## Deploy a shareable demo

See [DEPLOY.md](DEPLOY.md) — console on Vercel, API on Render (demo data only).

## Layout

| Path | What |
|------|------|
| `backend/src/mapencroach/domain/` | Jurisdiction tree (row-level scoping, multi-authority), case state machine (due process encoded), alert severity |
| `backend/src/mapencroach/cadastral/` | Topology QA + file ingestion (accept / quarantine / reject) |
| `backend/src/mapencroach/audit/` | Tamper-evident hash chain |
| `backend/src/mapencroach/hexgrid/` | Uber H3 indexing: parcel cell covers, alert dedup keys, density rollups |
| `backend/src/mapencroach/imagery/` | Hash-on-ingest scene registry (STAC), ISO-week capture scheduling, Sentinel-2 / demo providers |
| `backend/src/mapencroach/api/` | FastAPI: JWT auth, RBAC, jurisdiction-scoped endpoints |
| `web/` | Next.js console with Google Maps and a MapLibre fallback |
| `PLAN.md` / `PLAN.html` | Implementation plan v2.0 (Builder's Edition) |
| `agents-build-log.md` | Agent build log |
