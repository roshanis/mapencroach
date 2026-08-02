# HRDA GEVD Requisition — Requirements Gap Analysis

**Against:** "Technical Data Requisition & System Implementation Proposal" to the Secretary, Haridwar Roorkee Development Authority (HRDA), dated 2026-07-29 — requisitioning Cartosat-3 imagery (via USAC) and HRDA GIS layers for an Automated Geospatial Enforcement, Vigilance & Anti-Encroachment Platform (GEVD).

**Repo assessed at:** current state of `mapencroach` (backend 200 tests, web 24 tests, demo-mode API).

**Bottom line:** the repo is a strong match for the *back half* of the GEVD mandate — verify, case-manage, legally document — and is missing most of the *front half*: the imagery processing pipeline and the automated change-detection engine that the proposal's executive objective is named after. Roughly: workflow/legal scaffolding ~70% designed and partially built; imagery/detection ~5% built (metadata registry only); GIS-layer integration ~30% (generic parcel ingestion exists, all HRDA-specific layers missing).

---

## 1. Requirement-by-requirement scorecard

Status legend: ✅ built · 🟡 partial / designed-but-not-built · ❌ missing

### §2 Space-based remote sensing (Cartosat-3 via USAC)

| Requisition item | Status | What exists / what's missing |
|---|---|---|
| PAN 0.25–0.28m GeoTIFF ingestion | ❌ | `imagery/registry.py` hashes scene bytes and records caller-supplied metadata (sensor, GSD, cloud %, minimal STAC item). **No raster code exists anywhere** — no rasterio/GDAL dependency, no GeoTIFF reading, no COG conversion, no reprojection. TiTiler is in `docker-compose.yml` but nothing feeds it. |
| MX 1.1m 4-band, False Color Composite | ❌ | No band math, no FCC rendering, no NDVI/NDBI/BSI computation (PLAN §2.4 describes band-ratio screening; none is implemented). |
| Pan-sharpened 0.45m products | ❌ | No pan-sharpening; would likely be delivered pre-sharpened by USAC, but there is no pipeline to catalog/serve them either. |
| Temporal stacks / monthly time series | 🟡 | Web has `HistoricalImageryTimeline` component and the registry stores `captured_at`, so the *display* concept exists. No baseline-scene management, no per-AOI capture scheduling, no time-series raster storage or comparison. |
| Metadata sidecar (.txt/.xml) — ephemeris, sensor angles, timestamps for court scrutiny | 🟡 | Registry computes SHA-256 at ingest and dedups by hash and scene_id — the right evidentiary anchor. But it does **not parse or preserve Cartosat sidecar files**; STAC item carries only datetime/cloud/GSD. No RFC 3161 trusted timestamping (planned in PLAN §4.2, not built). |
| **The change-detection engine itself** (the platform's stated purpose) | ❌ | No detection module exists. `POST /alerts` creates alerts **manually**. Severity scoring (`domain/alerts.py`), tiering (GREEN/AMBER/RED/LEGACY), and the ≥2-observation persistence rule are implemented and tested — but nothing upstream produces detections. `detection_run` is in PLAN's data model, absent from `db/models.py`. |

### §3.1 Cadastral & land administration layers

| Requisition item | Status | Notes |
|---|---|---|
| Khasra GIS layer | 🟡 | `cadastral/ingestion.py` accepts any geopandas-readable file with schema validation (ids, CRS, polygon-only) and topology QA (gaps/overlaps → accept/quarantine/reject). Parcels carry `survey_no`, `ULPIN`, boundary grade A/B/C. **Missing:** khasra-number-specific modeling, linkage to revenue records of rights (RoR / Bhulekh Uttarakhand), mutation history. |
| Plot boundary GIS layer | 🟡 | Same generic parcel path works. No separate layer type — the schema has exactly one parcel layer; plot-vs-khasra-vs-property distinctions collapse. |
| Property GIS layer + attribute DB | 🟡 | Arbitrary attributes are preserved on ingest (`ParcelRecord.attributes`) but not modeled, indexed, or queryable. |

### §3.2 Statutory master plans & zoning

| Requisition item | Status | Notes |
|---|---|---|
| Master Plan GIS | ❌ | No zoning/plan layer model at all. |
| ELU / PLU land-use layers + mismatch flagging | ❌ | Closest analog is the parcel `land_category` enum (waterbody/forest/revenue/…). No use-vs-zoning comparison, and no way to flag a commercial/residential mismatch. |
| Green Belt GIS | ❌ | Could be shoehorned into `land_category`, but no restricted-zone layer, no buffer logic. |

### §3.3 Infrastructure & geodetic networks

| Requisition item | Status | Notes |
|---|---|---|
| Road network / RoW centerlines | ❌ | Ingestion **rejects non-polygonal geometry by design** — linear layers (centerlines, drains) cannot even be loaded today. No RoW buffer generation. |
| Water bodies GIS | 🟡 | `waterbody` is a first-class land category with the highest severity weight (1.0). But hydrology as *vector network* (canals, drainage) is unsupported (same polygon-only limitation). |
| DGPS / Ground Control Points, ortho-rectification | 🟡 | Boundary grade A is *defined* as DGPS-verified and there's a `PATCH /parcels/{id}/boundary-grade` endpoint. **Missing:** GCP storage, DGPS survey upload workflow (PLAN persona P4), and any orthorectification capability (no raster stack). |

### §3.4 Enforcement, permissions & administrative records

| Requisition item | Status | Notes |
|---|---|---|
| Approved building plans & permission DB matching | ❌ | Nothing. PLAN deliberately treats permit-matching as an enhancement ("amber-by-default"); the HRDA proposal makes it a **core requirement** (catching illegal floor additions / footprint deviations). This is a scope conflict to resolve, not just a gap. |
| Encroachment legacy records / repeat-offense hotspots | 🟡 | `repeat_offender` multiplier (×1.2) exists in severity scoring; no import path for legacy enforcement maps, no hotspot analytics. |
| Zone & ward boundaries | 🟡 | Jurisdiction tree with row-level scoping is built and enforced on every endpoint — but levels are **hardcoded to state/district/taluk/village**. HRDA is a development authority organized by planning zones/wards; the enum needs generalizing. |
| Historical drone/survey data | ❌ | No drone ingestion; imagery registry would accept the bytes but nothing processes or serves them. |

### Cross-cutting platform requirements implied by the proposal

| Capability | Status | Notes |
|---|---|---|
| "Legally document" — evidence packets, §63 BSA certificates, notices | 🟡 | Audit hash chain (`audit/chain.py`) and case state machine (due process encoded; SHOW_CAUSE→…→ORDER_ISSUED with side exits incl. SURVEY_REQUESTED, STAYED_BY_COURT) are built and tested. **Missing endpoints/modules:** evidence packet builder, hash manifest PDF, certificate workflow, notice generator, WORM storage wiring, RFC 3161 timestamps. |
| "Verify" — field inspection | ❌ | No mobile app, no inspection model in the API, no GPS-tracked/hash-at-capture photo path. The case machine has INSPECTION_ASSIGNED/INSPECTED states but no artifacts behind them. |
| "Real time" monitoring | ❌ | No schedulers/workers (Prefect is in PLAN, not in the repo). And see Blindspot #2 below — "real time" is not achievable with Cartosat-3 regardless. |
| Production persistence | ❌ | The API runs **entirely on an in-memory store** (`api/store.py`); SQLAlchemy/PostGIS models exist in `db/models.py` but are not wired to the API, and the models cover only jurisdiction/parcel/audit — no alert, case, scene, inspection, or evidence tables. |
| Production auth | 🟡 | JWT + RBAC + jurisdiction scoping enforced and tested; but the secret is a dev constant and Keycloak (in docker-compose) is not integrated. |

---

## 2. Blindspots — in the HRDA proposal itself

Things the requisition assumes or promises that will bite the project if not surfaced now:

1. **It requisitions data, not detection.** The document specifies inputs exhaustively and says nothing about the change-detection method, model, precision target, or false-positive handling. Officer alert fatigue is the #1 killer of these systems (PLAN targets ≥60% Red-alert precision as a release gate, with shadow-mode calibration). The proposal should commit to a precision KPI and a shadow-mode period before enforcement action is taken on alerts.
2. **"Real time" is not physically available.** Cartosat-3 is a tasked satellite; realistic cadence over a fixed AOI is weekly-to-monthly with tasking latency, and monsoon (Jun–Sep) cloud cover blinds optical sensing over Haridwar exactly when construction often accelerates. PLAN's answer (Sentinel-1 SAR monsoon mode, adjusted SLAs) exists on paper only. Set expectations as "monthly screening + on-demand confirmation," not real time.
3. **"Zero-margin spatial error" is unattainable.** Ortho-rectification with DGPS GCPs reduces image error to ~1px (±0.3–0.5m), but the dominant error is the **cadastre**: Indian revenue maps are routinely off by 10–100m. The repo's boundary-grade system (A/B/C weighting severity and legal posture) is the honest mitigation — the proposal should adopt that language rather than promise zero error, or the first cross-examination will discredit the platform.
4. **Floor additions are largely invisible to nadir satellite imagery.** The proposal promises detection of "illegal floor additions" from 0.25–0.45m imagery. Vertical growth needs stereo pairs/DSM differencing, oblique drone imagery, or shadow-length analysis — none requisitioned. Either add stereo Cartosat-3 products & drone sorties for flagged parcels, or scope floor-addition detection out of satellite claims.
5. **Satellite evidence alone doesn't win cases.** Metadata sidecars help, but Indian courts require BSA 2023 §63 certificates for electronic records, an unbroken chain of custody, and (per the Supreme Court's Nov-2024 demolition guidelines) strict due process before enforcement. The repo's case state machine encodes exactly this — it's the strongest card the platform holds and the proposal doesn't mention workflow at all.
6. **The proposal assumes HRDA's layers exist in usable digital form.** Khasra maps that are georeferenced, topology-clean road centerlines, a *digitized* approved-building-plan database with spatial coordinates — in most Indian development authorities these are partly paper or non-spatial. Budget a data-readiness audit and digitization/QA effort (the repo's quarantine-on-topology-failure ingestion is built for exactly this reality).
7. **Legacy encroachment is a legal/political minefield.** Pre-baseline occupation can't be adjudicated by a change-detection tool. A baseline date must be declared and imaged, and pre-baseline flags routed separately (repo already has LEGACY tier + LEGACY_REFERRED state).
8. **No field-verification loop in the proposal.** Detection → enforcement with no inspection step fails both practically (false positives) and legally. A mobile inspection app with GPS-tracked, hash-at-capture photos is needed (planned, not built).
9. **Compliance obligations unstated.** Sub-1m imagery triggers the Geospatial Guidelines (India-only hosting, negative-list zones excluded); occupant/owner data triggers DPDP Act minimization; government go-live requires CERT-In empanelled VAPT. None appear in the proposal.
10. **No people/process line-items.** Officer training, transfer/handover (officers rotate every 1–3 years), helpdesk, and change management decide adoption. PLAN §9 covers this; the requisition covers only data.

---

## 3. Blindspots — in the repo (relative to this proposal)

1. **The core engine is absent.** There is no code that compares two images. Everything downstream of detection (severity, tiers, persistence, cases) is real; everything upstream is not.
2. **Demo-only persistence and auth.** In-memory store, dev JWT secret, Keycloak/MinIO/TiTiler composed but unwired. Nothing in the current API survives a restart.
3. **Polygon-only world.** Road RoW, canals, drainage — required layers — cannot be ingested at all today.
4. **No layer taxonomy.** One parcel table cannot represent khasra + plot + property + master plan + ELU/PLU + green belt + wards as distinct, cross-queryable layers with provenance.
5. **No raster serving.** Officers cannot see any imagery behind an alert; the before/after slider and evidence exhibits have nothing to render.
6. **Evidence chain has a gap in the middle.** Hash-on-ingest ✅ and audit chain ✅, but no RFC 3161 timestamps, no WORM bucket wiring, no packet/certificate generation — the pieces a defense counsel would probe.
7. **Jurisdiction model doesn't fit a development authority.** Hardcoded revenue hierarchy (state/district/taluk/village) vs HRDA's planning zones/wards.
8. **No workers/scheduling.** "Monthly automated run" requires a job system (Prefect per PLAN); none exists.

---

## 4. What's genuinely strong (sell these)

- **Case state machine with due process encoded** — a case cannot skip show-cause, hearing, or reasoned order (`domain/case_engine.py`, exhaustively tested). Directly answers the proposal's "legally document" objective and the SC demolition guidelines.
- **Tamper-evident audit chain + hash-on-ingest scene registry** — the correct evidentiary spine for court scrutiny.
- **Cadastral ingestion with topology QA and boundary grading** — built for exactly the messy-data reality of §3.1.
- **RBAC + row-level jurisdiction scoping on every endpoint** — vigilance-grade access control.
- **Explainable severity model** (area × land-category × boundary-grade × repeat-offender) — defensible to officers and courts, unlike a black-box score.

---

## 5. Priority build list to satisfy the requisition

| # | Work item | Fulfills | Size |
|---|---|---|---|
| 1 | Raster pipeline: GeoTIFF→COG, STAC catalog (pgSTAC), TiTiler wiring, Cartosat sidecar (.txt/.xml) parsing preserved verbatim + hashed | §2 all rows | L |
| 2 | Detection v1: parcel-clipped band-ratio change vs baseline (MX/FCC, NDVI/NDBI), persistence-gated → auto-create alerts via the existing severity path; `detection_run` table for reproducibility | Executive objective | L |
| 3 | Wire API to PostGIS (models exist); add scene/alert/case/inspection/evidence tables; real Keycloak auth | Platform viability | M |
| 4 | Multi-layer GIS model: layer registry (khasra, plot, property, master plan, ELU/PLU, green belt, ward) with line+polygon support and provenance; RoW buffering | §3.1–3.3 | M |
| 5 | Zoning-mismatch + green-belt/water-body proximity flags joined into alert enrichment | §3.2, §3.3 | M |
| 6 | Evidence completion: RFC 3161 timestamps, WORM (MinIO object-lock), packet PDF with hash manifest, §63 certificate workflow, notice generator | "Legally document" | M |
| 7 | GCP/DGPS module: GCP store, survey upload → boundary-grade promotion; document ortho-rectification accuracy honestly | §3.3 | S–M |
| 8 | Permission-DB matching: approved-plan footprint vs detected footprint deviation (flag scope conflict re floor additions) | §3.4 | M |
| 9 | Jurisdiction generalization to authority zones/wards | §3.4 | S |
| 10 | Scheduler (Prefect) for monthly runs + monsoon SAR mode | "automated… monitoring" | M |
| 11 | Field inspection capture path (mobile or PWA): GPS track, on-device hashing | Verification loop | L |

Items 1–3 are the credibility threshold: without them the platform cannot demonstrate a single automated detection end-to-end.
