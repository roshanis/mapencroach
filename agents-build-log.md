# Agents Build Log — mapencroach

Satellite-based land encroachment intelligence + case management platform for Indian state governments.

## [AGENT: Codex] [2026-07-07 — summarized by Claude from user-pasted output]
### Action: Produced initial product framing, 5-phase roadmap, admin screens, imagery tiers, tech stack, risks
### Files changed: none (planning only)
### Diff summary: Encroachment intelligence + case management framing; Sentinel-2/Bhoonidhi/commercial imagery tiers; PostGIS/FastAPI/Next.js/MapLibre stack; pilot = 1 district, 1,000–5,000 govt parcels

## [AGENT: Claude] [2026-07-07T06:30Z]
### Action: Reviewer pass on Codex roadmap — blindspot review
### Files changed: agents-build-log.md (created)
### Recommendations (full detail delivered to user in session):
1. Legal evidence gap: BSA 2023 §63 certificates, hash-on-ingest, chain of custody, SC Nov-2024 demolition due-process guidelines must be in the case workflow from Phase 1.
2. Satellite/parcel overlays have no legal standing for boundaries — only licensed govt survey does. Product action = "trigger official demarcation," never assert boundary truth.
3. Separate NEW change (post-baseline) from LEGACY occupation (pattas, FRA claims, regularization) — baseline date is a policy/legal decision. AI should never label legacy occupation "unsafe."
4. Permit-matching assumption is mostly false — ULB permits are rarely digitized/geocoded. Default classifier path must handle "no permit data."
5. Weekly free-imagery monitoring can't see building-level change (Sentinel-2 = 10m). Tiered cadence + Cartosat-2/3 free-to-govt via Bhoonidhi is the big cost lever Codex underplayed.
6. No cost model in plan — imagery $/km², annotation, devices; needed for RFP/GeM procurement case by Phase 1.
7. Sponsorship missing: need one admin sponsor dept + Government Order + NRSC MOU. Consider eGov DIGIT for case management instead of fully custom.
8. Alert-precision KPI (>60–70% Red confirmed in field) + collusion controls (random secondary review, immutable logs, case-aging escalation).
9. Geospatial Guidelines 2021: <1m-accuracy data must stay with Indian entities on Indian infra; exclude restricted/defence-adjacent parcels; CERT-In/STQC audit before deploy.
10. Persistence check (confirm across 2 captures) + "temporary structure" disposition to cut seasonal/festival false positives.
11. Stronger wedge pilot: water-body/tank-bed encroachment (NGT/court-mandated monitoring already exists = mandate + budget).
12. Add pipeline-leakage metric (where cases stall: alert→inspection→notice→action).
Nits: Sentinel-1B is dead (constellation = 1A+1C); Phase 0 of 2–4 weeks unrealistic (~2–3 months); pick pilot district by land-record quality, not encroachment severity.
### Next steps: Codex to revise roadmap against items 1–5 and 7 (structural); then Phase 0 data-readiness checklist.

## [AGENT: Claude] [2026-07-08T06:00Z]
### Action: User dropped Codex from the workflow; Claude authored the consolidated implementation plan, product roadmap, and tech stack incorporating all 12 blindspot-review items
### Files changed: PLAN.md (created)
### Diff summary: 5-phase roadmap (Months 1–24), design principles (change-not-guilt, evidence-grade-from-day-one, boundary humility, Amber-by-default), waterbody wedge pilot recommendation, open-source India-deployable stack (FastAPI/PostGIS/MapLibre/TiTiler/STAC/TorchGeo), Cartosat-via-Bhoonidhi as primary imagery lever, pilot-year cost model, compliance checklist
### Recommendations / Next steps: Phase 0 first actions — identify sponsor department + GO, Bhoonidhi govt registration to test Cartosat tasking latency, obtain pilot-district cadastral vectors for boundary-confidence audit. git init when coding starts.

## [AGENT: Claude] [2026-07-08T17:00Z]
### Action: Rewrote plan as v2.0 "Builder's Edition" after user feedback that v1 read too defensively; PLAN.html regeneration delegated to Sonnet subagent
### Files changed: PLAN.md (full rewrite, v1 superseded — user declined backup), PLAN.html (regenerating)
### Diff summary: Added 8 user personas; core data model + case state machine + detection pipeline + API surface; user management (roles matrix, jurisdiction row-level scoping, officer-transfer handover workflow); security architecture (threat model incl. insider/encroacher adversaries, data classification, evidence integrity chain); testing strategy (golden detection dataset, shadow mode, state-machine exhaustive tests, device farm); 12-month sprint-by-sprint delivery plan; blindspots reframed as engineered solutions; adoption/change-management playbook; success metrics + operating rhythm
### Recommendations / Next steps: Same Phase 0 actions as prior entry; when build starts, S1–S2 scope is repo+CI, PostGIS schema v1, Keycloak, cadastral ingestion + topology QA.

## [AGENT: Claude TDD Guardian] [2026-07-08 23:05]
### Action: TDD Cycle — Sprint 1 foundation (branch: claude-worktree)
### Files changed:
- backend/pyproject.toml, .github/workflows/ci.yml, .gitignore (scaffold: pytest, ruff, coverage gate 80%, pip-audit)
- backend/src/mapencroach/domain/jurisdiction.py + tests/test_jurisdiction.py
- backend/src/mapencroach/audit/chain.py + tests/test_audit_chain.py
- backend/src/mapencroach/cadastral/topology.py + tests/test_topology.py
- backend/src/mapencroach/db/models.py + tests/test_db_models.py
### Tests written: 46 total, red-first confirmed (ModuleNotFoundError before implementation)
- JurisdictionTree: is_within/scope_ids happy paths, self, siblings, unknown-id KeyError, cycle/multi-root/missing-root/duplicate/empty rejection
- Audit chain: deterministic canonical hashing, genesis link, tamper/reorder/delete detection with first_bad_index
- Topology QA: invalid (bowtie, empty), overlaps (touching≠overlap, sliver threshold, 3-way pairs), gaps (full coverage, strip, threshold), blocking semantics (invalid/overlap block, gaps warn)
- Schema v1 metadata: MULTIPOLYGON SRID 4326, boundary_grade A/B/C, land categories, jurisdiction FKs, mandatory hash columns
### Suite status: ALL PASSING (46 tests)
### Coverage on changed files: 100%
### Recommendations / Next steps: cadastral file ingestion (GeoPackage/Shapefile -> topology QA -> quarantine), Alembic migrations, first FastAPI endpoints (/parcels with jurisdiction scoping), Keycloak docker-compose. Uncommitted on claude-worktree — awaiting user instruction to commit.

## [AGENT: Claude TDD Guardian] [2026-07-08 23:40]
### Action: TDD Cycle — cadastral file ingestion module (branch: claude-worktree)
### Files changed:
- backend/src/mapencroach/cadastral/ingestion.py (new)
- backend/tests/test_ingestion.py (new)
### Tests written: 17 total, red-first confirmed (ModuleNotFoundError before implementation)
- Happy path GeoJSON and GPKG (accepted, correct ParcelRecord contents)
- Reprojection EPSG:32643 (UTM 43N, Bhopal) -> EPSG:4326, asserts coordinate values numerically changed
- Polygon -> single-part MultiPolygon promotion; MultiPolygon passthrough (disjoint parts, since touching parts are themselves invalid per OGC rules)
- Attributes preserved, id_column excluded from attributes
- Rejection: missing file, unreadable/corrupt file, missing id_column, duplicate ids, null id, no CRS (via GPKG — GeoJSON always round-trips as EPSG:4326 per RFC 7946 so it can't represent a "no CRS" case), non-polygon geometry (Point) — each asserts status/parcels/report/errors contract
- Quarantine on overlap (status quarantined, parcels empty, report.blocking True)
- Accepted-with-gap-warnings (boundary larger than coverage, no overlaps)
- Id coercion to str (int id column -> string parcel_id)
- Clean batch still attaches empty-issues TopologyReport (not None)
### Suite status: ALL PASSING — full suite 63 passed (46 pre-existing + 17 new)
### Coverage on changed files: ingestion.py 100% (69/69 stmts); full-repo coverage 100%

## [AGENT: Claude (reviewer)] [2026-07-09T00:15Z]
### Action: Verified Sonnet subagent's ingestion module — found and fixed one defect (red-first)
### Files changed: backend/src/mapencroach/cadastral/ingestion.py (null-geometry handling), backend/tests/test_ingestion.py (+1 test)
### Diff summary: features with null geometry (common in messy state cadastral exports) crashed load_parcels with AttributeError instead of rejecting the batch; now rejected with "id=<id> (missing)" in errors. Subagent's own report was otherwise accurate (independently re-ran suite/coverage/lint before accepting).
### Suite status: ALL PASSING (64 tests) · Coverage: 100% · ruff clean
### Recommendations / Next steps: Alembic migrations, /parcels API with jurisdiction scoping, Keycloak docker-compose. Uncommitted on claude-worktree.

## [AGENT: Claude (orchestrator)] [2026-07-09T01:30Z]
### Action: Goal "build sprints 1-5" — case engine + alerts domain landed (Sonnet subagent, 2nd attempt); docker-compose dev runtime added
### Files changed: backend/src/mapencroach/domain/case_engine.py, domain/alerts.py, tests/test_case_engine.py, tests/test_alerts.py, docker-compose.yml (PostGIS/Keycloak/MinIO/TiTiler)
### Diff summary: Due-process state machine (11-state forward chain, artifact enforcement per transition, survey/stay pauses that always resume where entered, terminal states reject all); alert tiers + severity scoring (land-category weights, boundary-grade multiplier, repeat-offender bonus) + persistence rule. NOTE: subagent's first report claimed success for files never written to disk — caught on verification, redone with proof-of-output required. Design calls: no dismissal while survey pending; stay-during-survey vacates to pre-survey state.
### Suite status: ALL PASSING (144 tests) · Coverage 100% · ruff clean
### Recommendations / Next steps: API layer agent running (FastAPI, JWT/RBAC, jurisdiction-scoped endpoints, imagery hash-on-ingest registry, demo seed); web UI agent running (Next.js+MapLibre). Then: wire UI to API, full verification, sprint 1-5 wrap.

## [AGENT: Claude (orchestrator)] [2026-07-09T02:30Z]
### Action: Goal "build sprints 1-5" COMPLETE — API layer + web console landed (Sonnet subagents), UI wired to API, full stack smoke-tested live
### Files changed: backend/src/mapencroach/api/{app,auth,store}.py, imagery/registry.py, tests/test_api.py, tests/test_imagery_registry.py, backend/README.md, pyproject.toml (+pyjwt, uvicorn); web/ (full Next.js console, 30+ files); web/src/lib/api.ts + api.test.ts (orchestrator: bearer-token support + tier/status case normalization); README.md (root quickstart)
### Diff summary: FastAPI with HS256 JWT auth (Keycloak-federation-ready), 7-role RBAC, jurisdiction scoping on every read (out-of-scope = 404, no existence leak), case-transition endpoint mapping InvalidTransition/MissingArtifact to 409, boundary-grade workflow (survey_officer/data_admin), audit entry per mutation with verify_chain-tested integrity, imagery hash-on-ingest registry with STAC items + dedup, Bhopal demo seed. Web: command map (MapLibre), alert queue, parcel profile, case detail with due-process state rail; fixtures mode or live API mode.
### Verification: backend 200 passed / 99.71% coverage / ruff clean (re-run independently); web 24 passed / tsc clean / production build clean; live smoke test — uvicorn booted with demo seed, /parcels /alerts /cases correct over HTTP with real JWT, 401 without. Orchestrator found+fixed UI-API integration gaps (missing auth header, uppercase enum mismatch).
### Sprint scorecard: S1-2 done (Alembic migrations deferred — in-memory store carries dev; PostGIS models ready). S3-4 done except live Sentinel-2 download client (needs Copernicus credentials — registry/STAC/TiTiler plumbing ready). S5-6 done (case engine, manual alert CRUD, RBAC+scoping, boundary grading).
### Recommendations / Next steps: commit; then Alembic + PostGIS-backed store, Sentinel-2 fetch client behind SceneRegistry, Keycloak token federation, detection pipeline (S11-12).
### Lint: ruff check clean on both new files and full backend/ (fixed B007 unused loop var, two unused test imports)
### Deviations from spec: none functional. Two test-fixture corrections made during red/green (not spec deviations): (1) two abutting boxes wrapped in one MultiPolygon are invalid per OGC self-intersection rules, so the "MultiPolygon passthrough" fixture uses disjoint parts instead; (2) the "no CRS" rejection fixture uses GPKG instead of GeoJSON since GeoJSON always reads back as EPSG:4326.
### Recommendations / Next steps: Alembic migrations, first FastAPI endpoints (/parcels with jurisdiction scoping), wire ingestion.load_parcels into an upload endpoint. Uncommitted on claude-worktree — awaiting user instruction to commit.

## [AGENT: Claude] [2026-07-09T15:35Z]
### Action: Demo-readiness cycle — verified the 5-minute demo narrative end to end, fixed 4 UI gaps + 1 live-API bug, wrote DEMO.md
### Files changed:
- DEMO.md (new — 5-minute script, pre-demo checklist, 409 "technical encore", honest-framing table, Q&A prep)
- web/src/lib/types.ts (LandCategory +irrigation/housing/industrial; LAND_CATEGORY_COLORS/LABELS; plain-language BOUNDARY_GRADE_EXPLANATIONS; Case.allowed_transitions)
- web/src/lib/api.ts (normalize dict-shaped event artifacts → "key: value" string[]; tolerate events-less /cases list shape)
- web/src/lib/api.test.ts, web/src/lib/fixtures.ts
- web/src/components/AllowedNextSteps.tsx + test (new), MapLegend.tsx + test (new)
- web/src/components/MapLibreMap.tsx (parcel fill/outline now colored by land_category, was boundary_grade)
- web/src/app/page.tsx (legend overlay), web/src/app/cases/[id]/page.tsx (Allowed Next Steps section)
- web/src/components/BoundaryGradeBadge.test.tsx, ParcelAttributesCard.{tsx,test.tsx}
### Diff summary: Sonnet subagent implemented 4 spec'd fixes TDD (31 tests); orchestrator review caught a live-API crash the agent's tests missed — GET /cases list omits events, normalizeCase threw TypeError and 500'd the parcel profile; fixed red-first (32 tests). Live verification: all 18 content probes pass across /, /alerts, /parcels/parcel-1, /parcels/parcel-3, /cases/case-1; both due-process 409 refusals confirmed non-mutating. Note: running `npm run build` while `next dev` is live corrupts .next — restart dev server after builds.
### Verification: web 32 passed / tsc clean / production build clean; backend untouched (200 passed as of last run).
### Recommendations / Next steps: rehearse with DEMO.md; consider consolidating ParcelAttributesCard's local LAND_CATEGORY_LABELS with the shared map in types.ts; commit pending user instruction.

## [AGENT: Claude] [2026-07-12T00:20Z]
### Action: Made the backend deployable (Option 2: Vercel + Render) — configurable CORS, uvicorn as prod dep, Dockerfile, DEPLOY.md
### Files changed:
- backend/src/mapencroach/api/app.py (allowed CORS origins from MAPENCROACH_CORS_ORIGINS, comma-separated, default localhost:3000)
- backend/tests/test_api.py (+3 CORS preflight tests, red-first)
- backend/pyproject.toml (uvicorn dev extra → main dependency)
- backend/Dockerfile, backend/.dockerignore (new — python:3.12-slim, $PORT-aware factory boot)
- DEPLOY.md (new — ordered Vercel→Render guide: real JWT secret, env vars, 90-day token mint, free-tier caveats, troubleshooting)
- README.md (pointer to DEPLOY.md)
### Diff summary: TDD cycle on CORS (2 tests red → green, 203 passed / 99.71% cov / ruff clean). Docker daemon down, so the Dockerfile's risk surface was verified equivalently: non-editable pip install into a fresh venv, factory boot under PORT+MAPENCROACH_CORS_ORIGINS, smoke-tested 401 + configured-origin preflight echo + unlisted-origin refusal, server stopped.
### Recommendations / Next steps: user performs the Render/Vercel account steps in DEPLOY.md (agent cannot create accounts/accept ToS); rotate demo token every 90 days; real pilot needs Keycloak login before any real data.

## [AGENT: Claude] [2026-07-12T01:45Z]
### Action: Public demo deployment verified live — Vercel (web) + Render (API)
### Files changed: none this entry (web/vercel.json pushed earlier as 7cfb0b1)
### Diff summary: Deployment debugging: Vercel platform 404 traced to Framework Preset locked to "Other" from initial repo-root import (error: No Output Directory named "public"); fixed via dashboard (Root Directory=web, preset=Next.js) + in-repo pin web/vercel.json. Verification against https://mapencroach.vercel.app: 19/19 content probes pass across /, /alerts, /parcels/parcel-1, /parcels/parcel-3, /cases/case-1 — live Render data confirmed (backend parcel ids, not fixtures), so Vercel→Render JWT auth + CORS chain works. API: https://mapencroach.onrender.com (401 enforced, /docs live, CORS whitelists only the Vercel origin; localhost intentionally not whitelisted). Demo JWT secret exposed in chat during token minting was rotated before use.
### Recommendations / Next steps: warm the Render free instance before demos (sleeps when idle, ~1 min cold start); token expires 2026-10-10 — re-mint and redeploy Vercel before then; alert-queue page is prerendered at build time (static snapshot — fine for seeded demo data); next build phase: Alembic/PostGIS persistence, Keycloak login (required before any real data), Sentinel-2 fetch client.
