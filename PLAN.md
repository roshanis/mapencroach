# mapencroach — Implementation Plan v2.0 (Builder's Edition)

**Mission:** Give the state a working system that protects public land — every hectare of government land visibly monitored, every new encroachment caught early, every case carried to closure with evidence that stands up in court.
**Author:** Claude · 2026-07-08 · v2.0 (supersedes v1.0)

This is a plan to *succeed*, not just to avoid failure. Every known risk appears here exactly once — next to the feature or process that defuses it.

---

## 1. Who We're Building For — User Personas

The product succeeds when each of these people is better at their job with it than without it.

### P1 · District Collector — "the sponsor's eyes"
- **Reality today:** learns about encroachment from newspapers, complaints, or court orders. No district-wide picture. Reviews are anecdote-driven.
- **What we give her:** one dashboard — active cases, case age, area under threat, where cases are stuck, which taluk is performing.
- **Key screens:** executive dashboard, pipeline-leakage view, monthly review pack (auto-generated PDF).
- **Success:** she opens it unprompted before every revenue review meeting.

### P2 · Tahsildar / Revenue Officer — "the case owner"
- **Reality today:** encroachment work is reactive paperwork on top of 40 other duties. Files move slowly; evidence is scattered.
- **What we give him:** a triaged alert queue (highest severity first), one-click inspection assignment, auto-assembled evidence packets, notice templates, a case file that never loses documents.
- **Key screens:** alert triage queue, case detail, notice generator.
- **Success:** processing a case takes hours of his time instead of weeks; he trusts the queue because ≥60% of Red alerts are real.

### P3 · Village Accountant / Field Inspector — "boots on the ground"
- **Reality today:** handwritten panchnama, photos on personal phone via WhatsApp, no GPS record, evidence challenged later.
- **What we give him:** a mobile app that works offline, shows him exactly which parcel to visit, records a GPS track of the visit, hashes photos at capture, and syncs when he's back in coverage. Regional-language UI, runs on a ₹10k Android.
- **Key screens:** today's inspections, parcel locator map, guided inspection form, photo capture.
- **Success:** a complete, tamper-evident inspection report reaches the case file the same day.

### P4 · Survey Officer — "the boundary authority"
- **Reality today:** demarcation requests arrive as paper files with vague descriptions.
- **What we give him:** a demarcation request queue with parcel context, imagery, and the exact dispute area; a place to upload DGPS results that then upgrade the parcel's boundary-confidence grade for everyone.
- **Success:** his DGPS work compounds — every survey permanently improves the map.

### P5 · Department Legal Officer — "the evidence gatekeeper"
- **Reality today:** cases collapse in court on procedure — missing notice proof, uncertifiable digital photos.
- **What we give her:** evidence packets with hash manifests and BSA §63 certificate workflow, a hearing tracker, due-process checklist enforced by the system itself (a case *cannot* advance past a skipped step).
- **Success:** zero cases lost on procedural/evidentiary grounds.

### P6 · GIS / Data Administrator (state HQ) — "the map keeper"
- **What we give him:** imagery management console (AOIs, capture dates, cloud cover, tasking requests), cadastral QA tools (topology checks, boundary grading), detection-run monitor, false-positive analytics.
- **Success:** every monthly detection run completes on schedule; parcel data quality trends upward.

### P7 · System Administrator (NIC / state IT) — "the operator"
- **What we give him:** user provisioning tied to the government hierarchy, transfer/handover workflows, audit search, backup/restore runbooks, uptime dashboards.
- **Success:** officer transfers don't orphan cases; audits take minutes, not weeks.

### P8 · Secretary / HoD — "the mandate holder"
- **What we give her:** quarterly statewide KPIs — hectares protected, cases closed, recovery value, district league table — the numbers that justify next year's budget and expansion GO.
- **Success:** she presents mapencroach data in the Chief Secretary's review.

---

## 2. Product Architecture & Implementation Details

### 2.1 System overview

```
Imagery sources ──► Ingestion workers ──► COG + STAC catalog ──► TiTiler tiles ─┐
(Bhoonidhi, Sentinel,     (Prefect)              (MinIO/S3)                    │
 drone, mobile photos)         │                                               ▼
                               ▼                                        Web app (Next.js)
                     Detection pipeline ──► Alerts ──► Case engine ◄──► Mobile app (RN)
                     (change screening,      (PostGIS)  (state machine,        ▲
                      footprint diff)                    evidence store)       │
                               ▲                              │                │
                     Parcel registry ◄────────────────────────┴──► Audit chain + WORM evidence
                     (cadastre, boundary grades)
```

One FastAPI monolith + Prefect workers. No microservices at pilot scale — minimum complexity, maximum shippability.

### 2.2 Core data model (PostGIS)

| Table | Key fields | Notes |
|-------|-----------|-------|
| `parcel` | geometry, survey_no, ULPIN, owning_dept, land_category, **boundary_grade (A/B/C)**, legal_status, jurisdiction_id | Versioned via `parcel_version` — boundaries change as surveys land |
| `imagery_scene` | footprint, capture_ts, sensor, resolution, cloud_pct, source, **sha256**, stac_item_id | Hash computed at ingest, before anything else touches the file |
| `detection_run` | model_version, aoi, started/finished, params | Reproducibility: every alert traces to a run |
| `alert` | parcel_id, detection_run_id, change_gekm, area_m2, tier (green/amber/red/legacy), severity_score, persistence_count | Persistence ≥2 captures before an alert becomes visible |
| `case` | alert_id, parcel_id, owner_user_id, **state**, opened_ts, sla_due | One case per confirmed alert |
| `case_event` | case_id, from_state, to_state, actor, ts, note | **Append-only** — the state machine's audit trail |
| `inspection` | case_id, inspector_id, gps_track, started/ended, form_json | |
| `media` | inspection_id/case_id, **sha256_at_capture**, gps, ts, device_id | Photos hashed on-device before upload |
| `evidence_packet` | case_id, manifest (all hashes), certificate_status, issued_by | Rendered PDF stored in WORM bucket |
| `user`, `role`, `jurisdiction` | | See §3 |
| `audit_log` | actor, action, object, ts, **prev_hash, row_hash** | Hash-chained, append-only |

### 2.3 Case state machine (due process encoded, not documented)

```
NEW → TRIAGED → INSPECTION_ASSIGNED → INSPECTED → SHOW_CAUSE_ISSUED
    → RESPONSE_WINDOW → HEARING_SCHEDULED → HEARING_HELD → ORDER_ISSUED
    → ACTION_TAKEN → CLOSED
Side exits (from any state): DISMISSED_FALSE_POSITIVE · LEGACY_REFERRED ·
    SURVEY_REQUESTED (blocks until survey uploaded) · STAYED_BY_COURT (freezes SLA)
```

Transitions are the *only* way a case moves; each requires the artifacts of its step (e.g., `SHOW_CAUSE_ISSUED` requires a generated notice + dispatch proof; `ORDER_ISSUED` requires a reasoned-order document). This is how the SC's Nov-2024 demolition guidelines become impossible to skip rather than easy to forget.

### 2.4 Detection pipeline (monthly, per AOI)

1. Pull new Sentinel-2 scenes (cloud < 30%) → COG → STAC.
2. Band-ratio change vs. rolling baseline (NDVI/NDBI/BSI) per parcel; simple classifier scores change type.
3. Persistence check: candidate must recur in the next capture → else parked.
4. Persistent candidates on govt parcels → **Amber alert** + high-res confirmation request (Cartosat tasking or archive).
5. High-res footprint diff vs. baseline footprints → **Red** (new built-up) or dismissed with reason code.
6. Severity score = f(area, land_category weight, boundary_grade, repeat_flag) → triage queue.
7. Every officer disposition (confirm / false-positive + reason) is captured as labeled training data.

Monsoon mode (Jun–Sep): Sentinel-1 SAR coherence change as the screening signal; optical confirmation deferred, SLA clocks adjusted.

### 2.5 API surface (v1)

`/auth/*` (Keycloak-backed) · `/parcels` (+geo queries, timeline) · `/alerts` (queue, triage, disposition) · `/cases` (+ `/transitions`, `/events`) · `/inspections` (+ mobile sync batch endpoint) · `/evidence` (packet build, certificate workflow) · `/tiles/{z}/{x}/{y}` (TiTiler proxy with auth) · `/admin/*` (users, jurisdictions, imagery, detection runs) · `/reports/*` (dashboard aggregates)

All endpoints jurisdiction-scoped (see §3.2); all mutations audit-logged.

---

## 3. User Management & Access Control

### 3.1 Roles (mapped to the government hierarchy)

| Role | Persona | Can do | Cannot do |
|------|---------|--------|-----------|
| Viewer | Secretary, Collector | dashboards, case read | any mutation |
| Case Officer | Tahsildar | triage alerts, run cases, issue notices | alter evidence, close without due-process states |
| Inspector | VA/field staff | assigned inspections, media upload | see other jurisdictions, edit after submission |
| Survey Officer | Survey dept | demarcation queue, DGPS upload, boundary-grade updates | case actions |
| Legal Officer | Legal cell | certify evidence, hearing tracker, legal holds | field/detection functions |
| Data Admin | GIS cell | imagery, parcels, detection runs, FP analytics | case decisions |
| System Admin | NIC/IT | user lifecycle, audit search, config | **case decisions, evidence writes** (separation of duties) |

### 3.2 Jurisdiction scoping
Every user is bound to a node in the jurisdiction tree (state → district → taluk → village). Enforced as row-level filters in every query — an inspector literally cannot fetch parcels outside his charge. Collectors see their district; HQ roles see the state.

### 3.3 The transfer problem (solved, not ignored)
Government officers transfer every 1–3 years. Built-in from Phase 1:
- **Handover workflow:** transfer order → outgoing officer's open cases listed → bulk reassign to successor → handover memo auto-generated and logged.
- **No orphan cases:** a case cannot lack an owner; SLA alarms escalate ownerless cases to the collector queue.
- **Leave delegation:** time-boxed delegation with full audit trail; delegate actions are marked as such.

### 3.4 Identity & onboarding
- Phase 1: Keycloak — officer ID + mobile OTP; MFA (TOTP) mandatory for Legal, Data Admin, System Admin roles.
- Bulk provisioning from department HRMS lists (CSV import with maker-checker approval).
- Integrate state SSO / NIC Parichay when the state mandates it (Keycloak federates cleanly).
- Quarterly access review report auto-generated for the sponsor department; dormant accounts (90 days) auto-suspended.

---

## 4. Security Architecture

### 4.1 Threat model — who attacks this and why

| Adversary | Goal | Primary defenses |
|-----------|------|------------------|
| Well-resourced encroacher | delete/alter evidence, learn what's unmonitored, stall cases | WORM evidence store, hash-chained audit, need-to-know on coverage maps, SLA escalation |
| Insider (colluding official) | quietly dismiss alerts, leak parcel intel, fix cases | append-only case events, random secondary review of dismissals/closures, access logging on evidence reads, separation of duties |
| Generic attacker | deface, ransom, exfiltrate owner data | standard hardening below |
| Litigant | discredit evidence in court | provenance metadata, capture-time hashing, §63 certificate workflow |

### 4.2 Controls

- **Evidence integrity:** SHA-256 at ingest/capture → RFC 3161 timestamp → manifest in packet → packet PDF in WORM (object-lock) bucket. Mobile photos hashed *on-device* before upload with GPS+time embedded.
- **Audit:** hash-chained append-only log for every mutation *and every evidence read*; chain verified nightly; exportable for CAG/departmental audit.
- **AppSec:** OWASP Top 10 discipline — parameterized queries only, output encoding, CSRF tokens, strict CORS, rate limiting, file-upload validation (type/size/AV scan), no secrets in code (Vault/SOPS), dependency scanning + SBOM in CI (govt procurement increasingly asks for SBOMs).
- **Transport/storage:** TLS 1.2+ everywhere, AES-256 at rest, per-environment keys, India-only regions (Geospatial Guidelines 2021 for sub-1m data).
- **Mobile:** device binding, certificate pinning, encrypted local store, remote wipe of app data on transfer/exit.
- **Ops:** dev/staging/prod isolation (staging runs synthetic-district data, never real owner data), backups with quarterly restore drills, RPO ≤ 24h / RTO ≤ 8h for the pilot, incident-response runbook with CERT-In reporting timelines (6h rule).
- **Compliance gates:** CERT-In empanelled VAPT before pilot go-live and annually; STQC before statewide; DPDP data-map + retention schedule reviewed by legal officer; defence-adjacent/restricted parcels excluded at the data layer.

### 4.3 Data classification

| Class | Examples | Handling |
|-------|----------|----------|
| Public | aggregate district stats | publishable dashboards |
| Internal | parcel layers, alert queues | authenticated, jurisdiction-scoped |
| Restricted | owner/occupant personal data, coverage/tasking plans | role-gated, access-logged, DPDP minimization |
| Evidence | packets, media, certificates | WORM, read-audited, legal-hold capable |

---

## 5. Testing & Quality Strategy

TDD throughout; ≥80% coverage on changed code is the merge bar. But geospatial+government systems need more than unit tests:

| Layer | What we test | How |
|-------|--------------|-----|
| Geospatial logic | spatial joins, area calc, boundary-grade weighting, CRS handling | fixture parcels + synthetic change rasters; property-based tests for geometry edge cases (slivers, multipolygons, dateline-safe ops) |
| Detection quality | precision/recall per model release | **golden dataset**: curated known-change/no-change image pairs from the pilot AOI, grown from officer dispositions; no model ships that regresses precision |
| Case engine | every transition, every illegal transition, SLA/escalation timing | exhaustive state-machine tests; time-travel clock in tests |
| Evidence | hash manifest correctness, packet reproducibility, chain verification | byte-level regression tests; tamper-detection test (mutate a row → chain check must fail) |
| API | authz on every endpoint × every role × wrong-jurisdiction | contract tests generated from the role matrix in §3.1 |
| Mobile sync | offline queue, conflict handling, partial sync, low-storage devices | device-farm runs on 3 low-end Android models; airplane-mode test scripts |
| Pipeline | end-to-end monthly run on a mini-AOI | staging runs the full DAG nightly on synthetic data |
| Performance | 100k parcels on map, tile latency < 300ms p95, triage queue < 2s | k6 load tests in CI |
| Security | OWASP, dependency CVEs | ZAP baseline + dependency scan in CI; external VAPT per §4.2 |
| **Field reality** | does it work in a taluk office and a village? | **shadow mode**: Phase 2 detection runs live for 2 months generating alerts nobody acts on — we measure precision and tune *before* officer trust is at stake. UAT scripts run with real officers each phase |
| Data quality | cadastral topology (gaps, overlaps, invalid geometry) | automated QA report on every parcel import; blocking errors quarantine the batch |

---

## 6. Delivery Plan — First 12 Months, Sprint by Sprint

Two-week sprints, demo every sprint, officer-facing demo every second sprint.

**Months 1–3 (S1–S6) · Foundation** *(parallel with Phase 0 institutional work)*
- **S1–S2:** repo + CI/CD (tests, lint, dependency scan), PostGIS schema v1, Keycloak setup, cadastral ingestion + topology QA tool, jurisdiction tree.
- **S3–S4:** parcel map (MapLibre + PMTiles), parcel profile page, Sentinel-2 ingestion → COG/STAC → TiTiler, hash-on-ingest, audit chain v1.
- **S5–S6:** case engine (full state machine + tests), alert CRUD (manual creation), RBAC + jurisdiction scoping across API, boundary-grading workflow for the GIS admin.

**Months 4–6 (S7–S12) · Workflow MVP live**
- **S7–S8:** evidence packets (manifest, PDF, certificate workflow), imagery timeline + before/after slider, notice generator with legal-approved templates.
- **S9–S10:** officer UAT round 1 → fixes; baseline footprints imported (Open Buildings + QA); transfer/handover workflow; **go-live: pilot officers run 10–20 real cases manually**.
- **S11–S12:** detection pipeline v1 in **shadow mode**; triage console; precision-measurement harness; false-positive tagging.

**Months 7–9 (S13–S18) · Detection GA + mobile**
- **S13–S14:** shadow-mode calibration (persistence tuning, severity weights) → detection GA when precision ≥60% on shadow data; Cartosat/high-res confirmation loop.
- **S15–S18:** inspector mobile app (offline maps, guided form, hashed photo capture, sync), device-farm testing, field trial in one taluk, regional-language UI.

**Months 10–12 (S19–S24) · Enforcement & visibility**
- **S19–S20:** hearing tracker, reasoned-order records, survey-request integration, legal-hold.
- **S21–S22:** collector dashboard + pipeline-leakage view + monthly review pack; secretary KPI rollups.
- **S23–S24:** CERT-In VAPT + fixes; DR drill; SAR monsoon mode; pilot review report → scale-up GO proposal.

Team: 1 PM/domain lead · 1 geospatial engineer · 2 full-stack · 1 ML (from S11) · 1 field ops/training · part-time legal counsel.

---

## 7. Roadmap (Phase View)

| Phase | Months | Outcome | Exit criteria |
|-------|--------|---------|---------------|
| 0 · Foundation | 1–3 | GO signed, Bhoonidhi/Cartosat access validated, parcels boundary-graded, baseline date declared & imaged | ≥90% pilot parcels graded; baseline hashed; SOP signed |
| 1 · Workflow MVP | 3–6 | Officers run real cases end-to-end, no ML | N cases to notice stage; legal counsel approves packets |
| 2 · Detection | 6–10 | Monthly screening + high-res confirmation, live after shadow calibration | precision ≥60% field-confirmed |
| 3 · Field & enforcement | 9–14 | Mobile app, notices, hearings, leakage dashboard | median alert→closure tracked; zero due-process skips |
| 4 · Scale | 14–24 | More districts/departments, retraining loop, statewide dashboards | CERT-In + STQC cleared; expansion GO |

**Pilot wedge (recommended):** water-body/tank-bed encroachment in one district — court/NGT mandates often already require monitoring, so budget and motivated officers exist on day one. Alternative: 1,000–5,000 high-value govt parcels in the district with the *best land records* (DILRMP score), not the worst encroachment.

---

## 8. Blindspots → Engineered Solutions

Every hard truth about this domain, and the specific thing in this plan that handles it:

| Blindspot | Built-in answer |
|-----------|-----------------|
| Cadastral maps off by 10–100m | Boundary grades (A/B/C) baked into severity + legal posture; every DGPS survey upgrades the grade permanently (§2.2, P4) |
| Satellite boundaries have no legal standing | `SURVEY_REQUESTED` state triggers official demarcation; product never asserts a boundary (§2.3) |
| Legacy occupation is a political/legal minefield | Baseline-date design + `LEGACY_REFERRED` routing; AI only ever flags *post-baseline change* (§2.3, §2.4) |
| Permits aren't digitized | Amber-by-default classifier; permit matching is an enhancement, never a dependency (§2.4) |
| 10m imagery can't see small structures | Tiered cadence: free screening everywhere + Cartosat (free to govt) confirmation on flags; honest detection-floor SLAs (§2.4) |
| Officer alert fatigue kills adoption | Persistence rule, shadow-mode calibration before go-live, precision KPI as a release gate (§5) |
| Evidence challenged in court | Capture-time hashing, WORM store, §63 certificate workflow, due-process state machine (§2.3, §4.2) |
| Officer transfers orphan cases | Handover workflow + no-orphan rule + escalation (§3.3) |
| Insider collusion | Append-only events, random secondary review of dismissals, read-audited evidence (§4.1) |
| Enforcement stalls politically | Pipeline-leakage dashboard puts the stall in front of the collector and secretary (P1, P8) |
| Monsoon blinds optics | SAR screening mode + adjusted SLAs Jun–Sep (§2.4) |
| Cartosat tasking may be slow | Validated in Phase 0 with pre-approved commercial contingency (§7 Phase 0) |

---

## 9. Adoption & Change-Management Playbook

Software doesn't protect land — officers using it do. Budgeted and scheduled, not hoped for:

1. **District champion:** one respected Deputy Collector/Tahsildar co-designs screens from Sprint 3; their taluk goes first.
2. **Train-the-trainer:** we train 5 master trainers; they train the rest in their own language. Training environment = staging with synthetic data.
3. **First-win publicity:** the first real case closed through the system gets a departmental circular and a slot in the collector's review — success stories drive uptake faster than orders.
4. **Helpdesk where officers live:** a WhatsApp support line + 48h fix SLA on field-app bugs during pilot.
5. **Officer feedback council:** monthly 1-hour session; every release notes what changed because of officer input.
6. **Never a blocker:** every workflow has a manual fallback so a system outage never gives anyone a reason to abandon it.
7. **Make the officer look good:** monthly auto-generated achievement summary per officer (cases closed, area protected) — usable in their own performance reviews.

---

## 10. Success Metrics & Operating Rhythm

**North star: hectares of government land protected or recovered.**

| Metric | Target (pilot) | Cadence |
|--------|----------------|---------|
| Red-alert precision (field-confirmed) | ≥60% | per detection run |
| Median alert → case closure | < 90 days | weekly |
| Cases with complete, certified evidence | 100% | per case |
| Officer weekly active usage | ≥80% of provisioned officers | weekly |
| Pipeline leakage (cases stalled >30 days per stage) | visible + trending down | weekly to collector |
| Detection coverage | 100% of pilot parcels screened monthly | per run |
| Time from alert to inspection | < 14 days | weekly |

Operating rhythm: sprint demos (biweekly) → collector review (monthly, auto-generated pack) → secretary KPI review (quarterly) → model + precision review (per detection run).

---

## 11. Tech Stack (settled)

| Layer | Choice |
|-------|--------|
| Web | Next.js + TypeScript, MapLibre GL, deck.gl, Tailwind |
| Mobile | React Native, offline-first (PMTiles, SQLite sync queue) |
| API | Python FastAPI (monolith + workers) |
| Jobs | Prefect |
| DB | PostgreSQL + PostGIS (+ pgSTAC) |
| Imagery | MinIO/S3 · COG · STAC · TiTiler · GDAL/Rasterio/GeoPandas |
| ML | PyTorch + TorchGeo, Label Studio; band-ratio first, deep models when labels justify |
| Auth | Keycloak (→ state SSO/Parichay federation), TOTP MFA |
| Integrity | SHA-256 + RFC 3161 + hash-chained audit + object-lock WORM |
| Observability | Prometheus/Grafana/Loki, Sentry |
| Deploy | Docker Compose → K8s at scale; state DC or MeitY-empanelled Indian cloud, India-only |

All open-source: no license line-items in the RFP, no foreign SaaS holding sub-1m geospatial data.

## 12. Imagery & Data Access (settled)

- **Cartosat-2/3 via Bhoonidhi** — ~0.3–0.65m, free to government under Space Policy 2023 → baseline + confirmation. Tasking latency validated in Phase 0.
- **Sentinel-2** (free, 10m, ~5-day) → monthly screening. **Sentinel-1 SAR** (1A+1C) → monsoon screening.
- **Google Open Buildings / MS Footprints** → footprint baseline bootstrap.
- **Commercial (Planet/Maxar via Indian resellers)** → contingency only, flagged parcels only.
- **State cadastre + DILRMP + SVAMITVA drone data** → parcel truth. **SoI CORS/DGPS** → ground control. **Drones (Digital Sky-compliant)** → priority-case evidence.

**Pilot-year budget (order of magnitude):** team ₹1.5–2.5 Cr · infra ₹10–25 L · imagery ~₹0 (Cartosat) with ₹15–40 L commercial contingency · devices/drones ₹5–10 L · security audits ₹5–15 L.

---

## 13. What Success Looks Like

1. A collector opens the dashboard before every revenue review — because it's the best picture of her district she has.
2. An encroachment that began in March is a certified case file by May and a closed case by monsoon.
3. A field inspector's same-day, tamper-evident report replaces a week of paperwork.
4. The department's lawyer stops losing cases on procedure.
5. The secretary presents "hectares protected" numbers in the Chief Secretary's review — and asks for three more districts.
6. Officers ask for *more* parcels under monitoring. That's the moment this becomes permanent infrastructure for the state.
