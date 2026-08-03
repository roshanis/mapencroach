# HRDA GEVD — Engineering Build Plan

How to take `mapencroach` from its current state (demo API, no raster stack) to a platform that satisfies the HRDA requisition. Companion to [HRDA-REQUIREMENTS-GAP.md](HRDA-REQUIREMENTS-GAP.md); phases are ordered by dependency, not by requisition section. Each item names the repo modules it touches.

---

## Phase A — Production foundation (everything else depends on this)

**A1. Wire the API to PostGIS.**
`api/store.py`'s docstring already declares the contract: a PostGIS-backed store replaces the dict store behind the same attributes. Do exactly that.
- Extend `db/models.py` with the missing tables from PLAN §2.2: `imagery_scene` (add `sha256`, `stac_item_id`, sidecar text), `detection_run`, `alert`, `case`, `case_event` (append-only), `inspection`, `media`, `evidence_packet`. Keep `native_enum=False` convention.
- Add Alembic migrations; add a `PostgisStore` implementing the store interface; select store by `MAPENCROACH_DEMO` env (demo mode stays, it's the training/UAT environment).
- Acceptance: full existing test suite green against both stores (parametrize the store fixture).

**A2. Real authentication.**
Keycloak is already in `docker-compose.yml`. Keep `api/auth.py`'s claim model (role + jurisdiction), but verify tokens against Keycloak's JWKS instead of the dev secret. Map Keycloak realm roles → the RBAC roles already enforced in `api/app.py`. TOTP MFA for Legal/Data-Admin/System-Admin roles is Keycloak config, not code.

**A3. Generalize the jurisdiction tree for a development authority.**
`db/models.py` hardcodes `state/district/taluk/village`; HRDA is organized as authority → planning zone → ward. Replace the level enum with an ordered `jurisdiction_level` lookup (per-deployment config). `domain/jurisdiction.py` is already level-agnostic — only the schema and seed data change. This also loads §3.4's Zone & Ward Boundaries layer as first-class jurisdiction geometry (add a `geometry` column so wards are drawable).

---

## Phase B — Imagery pipeline (requisition §2)

**B1. Scene ingestion worker.**
New module `imagery/pipeline.py` + deps `rasterio`, `rio-cogeo`, `pystac`.
- Input: Cartosat-3 GeoTIFF (PAN / MX / pan-sharpened) + sidecar `.txt`/`.xml` from USAC.
- Steps, in evidence-safe order: (1) SHA-256 the *original* delivered bytes and the sidecar verbatim — extend `imagery/registry.py:SceneRecord` with `sidecar_sha256`, `sidecar_raw`; (2) parse sidecar for ephemeris, sensor angles, acquisition timestamp into STAC properties (keep the raw file — courts get the original, not our parse); (3) convert to COG (`rio-cogeo`), hash the COG separately; (4) upload original + COG to MinIO; (5) register STAC item in pgSTAC.
- Both hashes go into the audit chain (`audit/chain.py`) at ingest.

**B2. Tile serving.**
TiTiler is already composed against MinIO. Add an authenticated `/tiles/{z}/{x}/{y}` proxy endpoint in the API (jurisdiction-scoped — coverage maps are Restricted-class data per PLAN §4.3), and a `/scenes` STAC search endpoint.

**B3. Console imagery.**
Wire `web/src/components/HistoricalImageryTimeline.tsx` to the STAC search, add a before/after slider component fed by two TiTiler layers, and an FCC band-combination toggle (MX NIR-R-G) — this delivers §2's FCC utility with zero backend math (TiTiler does band selection via query params).

**B4. Temporal stacks & baseline.**
`imagery/baseline.py`: per-AOI declared baseline date + pinned baseline scene set (ids + hashes recorded in the audit chain — this is the "indisputable paper trail" anchor). Monthly captures append to the stack; the timeline reads it chronologically.

---

## Phase C — Detection engine (the executive objective)

**C1. Parcel-clipped change screening.**
New module `detection/`:
- `detection/run.py`: for each govt parcel in the AOI, clip current + baseline MX rasters (`rasterio.mask`), compute NDVI/NDBI/BSI deltas, threshold → change candidate with per-parcel stats stored (mean delta, changed-pixel area m²). Deterministic and explainable — the same philosophy as `domain/alerts.py`.
- Candidates feed the **existing** pipeline: `persistence_check` (≥2 captures) → `severity_score` → alert with tier. `POST /alerts` logic is reused; only the caller changes from human to detector.
- Every run writes a `detection_run` row (model version, params, scene ids) so every alert traces to a reproducible run.

**C2. High-res confirmation loop.**
Amber alerts trigger a PAN/pan-sharpened footprint diff vs baseline footprints (bootstrap from Google Open Buildings for the AOI) → Red or dismissed-with-reason-code. Footprint extraction v1 can be classical (morphological ops on NDBI + PAN texture); defer deep models until officer dispositions accumulate as labels.

**C3. Scheduling.**
Prefect (per PLAN §11): monthly flow per AOI = pull scenes → ingest (B1) → screen (C1) → confirm (C2). Monsoon mode (Sentinel-1 SAR coherence) is a later flow variant — ship optical first.

**C4. Shadow mode gate.**
Run C1–C3 for ≥2 cycles producing alerts nobody acts on; measure precision against field checks; go live at ≥60% Red-alert precision (PLAN §10). This is a policy switch (`alert.visible`), not new machinery — build the flag in from day one.

---

## Phase D — HRDA GIS layer registry (requisition §3)

**D1. Multi-layer model.**
New tables: `gis_layer` (kind: `khasra | plot | property | master_plan | elu | plu | green_belt | road | water_body | approved_plan | legacy_encroachment`, provenance, version, imported_at) and `gis_feature` (layer_id, source_feature_id, generic `Geometry` — not MULTIPOLYGON-only, attributes JSONB). Parcels stay the canonical enforcement unit; layers are context.

**D2. Extend ingestion to linear layers.**
`cadastral/ingestion.py` rejects non-polygons by design — right for parcels, wrong for roads/canals. Add `load_layer()` accepting LineString/MultiLineString for `road`/`water_body` kinds, with a linear topology QA variant in `cadastral/topology.py` (dangles, self-intersections) using the same accept/quarantine/reject contract.

**D3. Enrichment joins at alert creation.**
`detection/enrichment.py`, computed when an alert is raised and stored on it:
- **Zoning mismatch:** parcel/detected-change centroid vs ELU/PLU polygons → `zoning_flag`.
- **Green belt / water body:** intersection or proximity buffer → severity escalation (extend `LAND_CATEGORY_WEIGHTS` treatment in `domain/alerts.py` with layer-driven modifiers).
- **RoW breach:** buffer road centerlines by per-class RoW width → intersect with detected footprint.

**D4. Khasra ↔ revenue records linkage.**
`domain/geography.py` already has `ParcelAlias`/identifier versioning — use it to map khasra numbers → canonical parcels, and add an import for Bhulekh Uttarakhand RoR extracts (owner/occupant fields are DPDP Restricted-class: role-gated, access-logged).

**D5. GCP / DGPS module.**
`gcp` table (point geometry, accuracy, survey ref); survey-upload endpoint that attaches DGPS results to a parcel and promotes `boundary_grade` C→B→A via the existing `PATCH /parcels/{id}/boundary-grade` path; unblocks the case machine's `SURVEY_REQUESTED` state with a real artifact. GCPs also feed ortho-QC reporting for B1 (record residual RMSE per scene — honest accuracy, not "zero-margin").

**D6. Approved-plan matching.**
`approved_plan` layer kind with permitted footprint + attributes (floors, use). Confirmation step (C2) compares detected footprint vs permitted envelope → `deviation_flag`. **Scope note for HRDA:** floor-addition detection from nadir imagery is unreliable — deliver footprint-deviation from satellite, floor-count verification via inspection/drone (Phase F).

---

## Phase E — Legal & evidence completion ("legally document")

**E1. Trusted timestamps.** RFC 3161 (`rfc3161ng`) over every evidence hash at ingest/capture; store the TSR alongside the record.
**E2. WORM storage.** MinIO object-lock (compliance mode) bucket for media and packets; write-once verified in tests.
**E3. Evidence packet builder.** `evidence/packet.py`: assemble scene ids + hashes + sidecars + timeline + inspection media into a manifest, render PDF (WeasyPrint), store in WORM, log to audit chain. BSA §63 certificate workflow = Legal Officer role signs the certificate record; the case machine already refuses to advance without step artifacts — add the packet as the required artifact for `SHOW_CAUSE_ISSUED`.
**E4. Notice generator.** Template-driven (legal-approved), pre-filled from case + parcel + alert; dispatch proof upload required by the existing transition guard.

---

## Phase F — Field verification loop

**F1. Inspection API.** `/inspections` + batch sync endpoint; `inspection` + `media` tables (A1) with `sha256_at_capture`, GPS, device id.
**F2. Capture client.** Fastest credible path: an offline-capable PWA sharing the Next.js codebase (camera + geolocation + client-side SHA-256 before upload), regional-language UI; React Native app later if field trials demand it.
**F3. Drone evidence.** Ingest Digital-Sky-compliant drone imagery for flagged parcels through the same B1 hash-first path (`source="drone"`), satisfying §3.4's historical/priority survey data.

---

## Parallel track — data & institution (no code, gates everything)

1. **Data requisition execution:** USAC MoU for Cartosat-3 tasking + archive; validate tasking latency before promising cadence.
2. **HRDA data-readiness audit:** which of the §3 layers exist digitally, in what CRS, with what topology; run everything through the quarantine pipeline and report grades.
3. **Baseline date declaration** signed by the Authority, baseline imagery hashed same week.
4. **Compliance:** India-only hosting (sub-1m data), DPDP data map for occupant records, CERT-In empanelled VAPT before go-live.
5. **Precision KPI + shadow-mode policy** adopted by HRDA before any enforcement action on alerts.

---

## Sequencing & effort

| Phase | Depends on | Rough effort (1 geospatial + 2 full-stack) |
|---|---|---|
| A foundation | — | 3–4 wks |
| B imagery | A | 4–5 wks |
| C detection | B | 5–6 wks (+2 shadow cycles calendar time) |
| D layers | A (D3 needs C) | 4–5 wks, overlaps B/C |
| E evidence | A | 3–4 wks, overlaps C/D |
| F field loop | A, E | 4–6 wks |

Critical path: **A → B → C → shadow mode**. D and E run in parallel lanes. A demonstrable end-to-end slice (one parcel, two Cartosat scenes, auto-raised alert → case → evidence packet) is achievable at the end of Phase C and is the demo that sells the requisition's promise.
