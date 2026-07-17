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

## [AGENT: Claude] [2026-07-12T02:55Z]
### Action: Demo improvements — interactive due-process panel, satellite basemap, KPI strip, live alert queue
### Files changed:
- backend: domain/case_engine.py (+required_artifacts_for, pause-return aware), api/app.py (+_transition_options; required_artifacts in case detail + transition responses), tests/test_case_engine.py (+5), tests/test_api.py (+2)
- web: lib/api.ts (+transitionCase, never-throws TransitionResult), lib/types.ts (Case.required_artifacts), components/TransitionPanel.tsx+test (new — 15-state select with allowed/refused labeling, prefilled evidence inputs, verbatim 409 banner, router.refresh on success), components/BasemapToggle.tsx+test (new), components/KpiStrip.tsx+test (new), MapLibreMap.tsx (Esri World Imagery default basemap + toggle, outline 2.5px), app/cases/[id]/page.tsx (panel wired, force-dynamic), app/page.tsx (KPI overlay + getCases), app/alerts/page.tsx (force-dynamic)
- DEMO.md (stops 1 and 4 rewritten around satellite view, KPI strip, hand-them-the-mouse refusal moment)
### Diff summary: Backend TDD red-first (210 passed / 99.72% cov / ruff clean; one red was my own test using a viewer token for a case_officer endpoint — fixed test, not intent). Web by Sonnet subagent, verified independently: 54 passed (was 32) / tsc clean / production build clean (alerts+case pages now dynamic: 4 static pages, was 5). Subagent correctly declined to run build while a dev server was live; orchestrator stopped own server and ran it.
### Recommendations / Next steps: push to deploy (Render+Vercel auto); live-verify panel markup + KPI labels via SSR probes; satellite tiles are Esri World Imagery with attribution (demo-scale use); visual check of basemap by user (client-rendered).

## [AGENT: Claude] [2026-07-12T03:55Z]
### Action: Demo personas (switchable identities) + parcel tagging, end to end
### Files changed:
- backend: api/app.py (4 HRDA personas; GET /demo/personas + POST /demo/login registered only when MAPENCROACH_DEMO=1; POST/DELETE /parcels/{id}/tags with slug validation, idempotent add, scoping, audit), api/auth.py (+signing_secret), api/store.py (seed tags), tests/test_api.py (+14)
- web (Sonnet subagent, verified): lib/api.ts (cookie-aware auth precedence override>cookie>env; getPersonas/loginPersona/addParcelTag/removeParcelTag; token threading), lib/server-api.ts (new — sole next/headers importer; per-request cookie token for server pages), components/PersonaSwitcher.tsx+test (TopBar dropdown, cookie set + reload, reset), components/TagEditor.tsx+test (chips, add/remove, verbatim refusal text), parcel/case/alert pages on request-scoped wrappers, parcels/[id] force-dynamic, fixtures+types tags
- DEMO.md: Stop 5 (persona switching: scoping + read-only refusal), tags beat in Stop 3
### Diff summary: Backend TDD red-first (224 passed / 99.60% cov / ruff clean). Web verified independently: 80 passed / tsc clean / build clean with parcel/case/alert routes dynamic. Local E2E smoke on port 8001: personas listed unauthenticated; eo-haridwar sees exactly 4 parcels and 404s on parcel-5; vc-hrda tag attempt → 403 role message; admin-hq tag add → 201 audited. Demo endpoints structurally absent outside demo mode (tested).
### Recommendations / Next steps: push (auto-deploys); live-verify /demo/personas on Render + persona-scoped parcel counts + tag flow; note persona tokens minted server-side with the real secret, 8h expiry.

## [AGENT: Claude] [2026-07-13T00:00Z]
### Action: Code review — Batch 2 (WP4 personas page, WP5 cases index, WP6 inline explainability)
### Files changed: none (review only)
### Diff summary: Reviewed 11 modified files (git diff HEAD) + 8 brand-new files (direct read). Found 1 WARNING, 3 NITPICKs, no BLOCKERs. All 154 tests pass; tsc clean.
### Recommendations / Next steps: See reviewer findings below. Top priority: fix CasesTable concluded-section double-counting bug (CLOSED appears in both TERMINAL_STATES and the explicit check). Second: extract roleLabel to lib/format.ts to remove the duplication between PersonaCard and ViewingAsBanner. CaseEvent.to_state typed as CaseState (not AnyCaseState) is a latent risk — log a TODO for when the backend starts emitting special states in event history.

## [AGENT: Claude] [2026-07-13T15:40Z]
### Action: Approved-plan execution — console intuitiveness overhaul, expanded seed (30 parcels / 6 named taluks / 10 alerts / 5 cases), personas showcase
### Files changed:
- backend (orchestrator, TDD): store.py (JURISDICTION_NAMES; +taluk-a3 Laksar, taluk-b3 Narsan; parcels 8→30 with protagonists byte-identical; alerts 4→10 incl. UNDER_REVIEW/ESCALATED, alert-3 RESOLVED→CLOSED for filter coherence; cases 2→5 incl. STAYED_BY_COURT + SURVEY_REQUESTED pauses), app.py (jurisdiction_name in features; state_since on /cases list; 5th persona co-roorkee-city; /demo/personas + login enriched with jurisdiction_name/visible_parcels/capabilities), tests (+10, two hardcoded persona counts now store-derived)
- web Batch 1 (Sonnet 5): NavLinks (active-route nav + mobile), TopBar mount, jurisdictionLabel + fallback map, MapIntroPanel (localStorage-dismissible "What am I looking at?")
- web Batch 2 (Sonnet 5): lib/cookies.ts (+persona meta cookie), /personas page + PersonaCard (live "sees N of M" + capabilities from API), ViewingAsBanner on all pages, /cases index + CasesTable (In due process / Paused / Concluded, step-k-of-11 bars) + CaseStateChip, StateRail special-state banner, lib/explanations.ts + tier/severity/status/state tooltips with touch fallbacks, shared state constants dedup
- DEMO.md (Stop 4 opens from Cases queue; Stop 5 = personas page, 30/15/5 story), README.md
### Diff summary: Backend 234 passed / 99.62% cov / ruff clean. Web 157 passed (was 80) / tsc clean / build clean (routes: /cases dynamic, /personas static). Batch 2's reviewer sub-pass caught and fixed section-exclusivity + sort-stability issues in CasesTable. Full-stack local integration: 15/15 probes (cases grouping incl. both paused labels, jurisdiction names, severity footnote, paused-case rail banner).
### Recommendations / Next steps: push (auto-deploy), live-verify /personas + /cases + persona visible_parcels 30/15/5; user should eyeball map density at zoom 11 and the mobile hamburger.

## [AGENT: Codex] [2026-07-16T16:35Z]
### Action: Implemented the approved UI-intuitiveness overhaul with red-first tests and production-route verification
### Files changed:
- Home/workbench: `web/src/app/page.tsx`; `web/src/components/{AlertSidebar,KpiStrip,MapIntroPanel,MapLibreMap,SelectedAlertCard,WorkbenchSummary}.tsx` plus focused tests
- Queues/navigation: `web/src/app/alerts/page.tsx`; `web/src/components/{AlertsTable,CasesTable,NavLinks,TopBar}.tsx` plus focused tests
- Parcel/case workflow: `web/src/app/parcels/[id]/page.tsx`; `web/src/app/cases/[id]/page.tsx`; `web/src/components/{ParcelWorkSummary,TransitionPanel}.tsx` plus focused tests
- Honest route states: `web/src/app/{loading,error,not-found}.tsx` plus tests; `DEMO.md`
### Diff summary: Added a role-aware workbench and unresolved-alert mobile queue; unified map/list selection with a highlighted marker and parcel action card; corrected urgent/active alert semantics; added URL-persisted search and counted filters to alert/case queues with real links and responsive table overflow; moved demo personas out of primary navigation; elevated parcel risk, case stage, boundary confidence, and next action; replaced the legal-state dropdown with plain-language permitted actions and empty required-evidence fields while retaining prohibited-transition testing in a labeled demo disclosure; added accessible loading, retry, service-failure, empty, and record-not-found states; updated stale demo guidance. No backend, environment, dependency, deployment, or git-history changes.
### Verification: red-green component cycles completed; `npm test` 181 passed across 32 files (was 157, +24); `npm run lint` clean; `npm run build` clean; `git diff --check` clean. Built app HTTP checks passed for `/`, `/alerts`, `/alerts?q=PCL-1001`, `/cases`, `/cases?view=active`, `/personas`, `/parcels/PCL-1001`, `/cases/CASE-9001`, and missing parcel/case recovery routes.
### Recommendations / Next steps: Review the uncommitted changes on `claude-worktree`; commit and deploy only after human approval. A final human viewport check is still useful for map-overlay density on the intended demo display.

## [AGENT: Codex] [2026-07-16T21:07Z]
### Action: Added the approved geographic-lineage model and SHRUG-compatible parcel Context tab with a hard context-versus-evidence boundary
### Files changed:
- Backend contracts and import boundary: `backend/src/mapencroach/domain/geography.py`; `backend/src/mapencroach/context/{__init__.py,shrug.py,README.md}`; `backend/src/mapencroach/db/models.py`
- Backend API/demo wiring and tests: `backend/src/mapencroach/api/{app.py,store.py}`; `backend/tests/{test_api.py,test_db_models.py,test_geography.py}`
- Web data contracts and parcel UI: `web/src/lib/{types.ts,fixtures.ts,api.ts,api.test.ts,server-api.ts}`; `web/src/app/parcels/[id]/page.tsx`; `web/src/components/{ParcelContextPanel,ParcelDetailTabs}.{tsx,test.tsx}`
### Diff summary: Added versioned parcel aliases and split/merge/renumber lineage contracts; additive SQLAlchemy tables for identifiers, lineage, context sources, geographic units, parcel links, and observations; jurisdiction-scoped `GET /parcels/{id}/context`; and an official-SHRUG import boundary that requires an explicit redistribution review and retains provenance. Added accessible Overview/Context tabs with identity history, match method/confidence, five clearly illustrative planning indicators, source/license/limitation cards, and honest empty/unavailable states. Context objects cannot be promoted to evidence in either construction or display. No official SHRUG rows, dependencies, environment changes, commits, or deployments were added.
### Verification: Red-first backend and web cycles completed. Backend: 253 passed, 99.71% coverage, ruff clean. Web: 188 passed across 34 files, ESLint clean, optimized Next.js build/type-check clean. Production web checks returned parcel pages and server-rendered the Context warning/demo/source signals; live local API check returned 200 with ULPIN/survey aliases, SHRUG_SHRID2 link, five context-only observations, demo provenance, and 404 for an unknown parcel. `git diff --check` clean.
### Recommendations / Next steps: Obtain written clarification for the applicable SHRUG module and intended-use license before setting `redistribution_reviewed=True` or bundling official data; then persist the additive schema through the future PostGIS/Alembic path and import reviewed user-supplied SHRUG rows. Review the uncommitted branch before any commit or deployment.

## [AGENT: Codex] [2026-07-17T01:54Z]
### Action: Committed the approved console/context release and deployed it through the established GitHub-to-Vercel/Render production path
### Files changed: `agents-build-log.md` (deployment closeout only; release source was committed as `890d356`)
### Diff summary: Pushed the validated UI-intuitiveness and parcel-context release from `claude-worktree` to `origin/main`. Render rebuilt the FastAPI backend and Vercel rebuilt the Next.js console. No environment variables, credentials, hosting configuration, dataset files, or runtime data were changed.
### Verification: `origin/main` reached `890d356`; Render OpenAPI returned 200 and registered `/parcels/{parcel_id}/context`; the production parcel route returned 200 and rendered the accessible parcel tabs, non-evidence warning, illustrative-demo label, night-light signal, and `mapencroach demo` provenance from the live backend.
### Recommendations / Next steps: Keep official SHRUG rows out of production until the applicable license and intended use are reviewed. The current deployment remains demo-data-only and should not be connected to real government parcel or case data before Keycloak and persistent PostGIS storage are in place.

## [AGENT: Codex] [2026-07-17T02:11Z]
### Action: Built the approved public landing experience and separated first-impression storytelling from the operational command map
### Files changed:
- Landing and visual system: `web/src/app/{page.tsx,page.test.tsx,globals.css,layout.tsx}`
- Console route and navigation: `web/src/app/console/{page.tsx,page.test.tsx}`; `web/src/components/{NavLinks,TopBar}.{tsx,test.tsx}`
- Route continuity: `web/src/app/{alerts/page.tsx,not-found.tsx,not-found.test.tsx,personas/page.tsx,parcels/[id]/page.tsx}`
- Operator/deployment guidance: `README.md`, `DEMO.md`, `DEPLOY.md`
### Diff summary: Replaced `/` with a responsive product landing page featuring a clear outcome-led hero, working-console preview, seeded demo proof, signal-to-action workflow, parcel-centered capabilities, explicit context-versus-evidence trust model, role-specific value, and repeated `/console` conversion points. Preserved the complete map experience at `/console`, updated every direct map link and persona redirect, made the operational wordmark return home, and refreshed product/social metadata. A site-specific social-card generation was attempted and retried once; the saved rasters failed typography inspection, so no broken or generic Open Graph image was shipped.
### Verification: Red-first route and landing tests completed. Web: 192 passed across 35 files, ESLint clean, optimized Next.js build/type-check clean. Built-server checks returned 200 for `/`, `/console`, `/alerts`, `/cases`, and `/parcels/PCL-1001`; the landing HTML contained the exact hero, workflow, trust headline, and `/console` CTA; the console retained its operational loading shell. `git diff --check` clean.
### Recommendations / Next steps: Publish through the existing `origin/main` Vercel path, then verify the live landing CTA reaches the Render-backed console. Keep the new root route product-focused; operational additions should continue under `/console`, `/alerts`, `/cases`, and parcel records.

## [AGENT: Codex] [2026-07-17T02:15Z]
### Action: Published and verified the new landing-page and `/console` experience in production
### Files changed: `agents-build-log.md` (deployment closeout only; release source was committed as `b39eae0`)
### Diff summary: Pushed the validated landing/UX release to `origin/main`; Vercel published the new static root page and command-map route while the existing Render backend remained unchanged and authenticated. No environment variables, credentials, backend code, datasets, or hosting settings were changed.
### Verification: GitHub reported Vercel success and the backend check green for `b39eae0`. Production returned 200 for `/`, `/console`, `/alerts`, and `/cases`; the live root contained the exact outcome-led hero, workflow headline, trust-boundary headline, and `/console` CTA; `/console` served the operational console shell. Render continued returning 401 for unauthenticated parcel access and exposed the parcel-context endpoint in OpenAPI.
### Recommendations / Next steps: Use `https://mapencroach.vercel.app` for product introductions and `https://mapencroach.vercel.app/console` for direct operator demos. Preserve the landing/console separation as new product capabilities are added.

## [AGENT: Codex] [2026-07-17T03:10Z]
### Action: Added the approved Google Maps production renderer with a visible MapLibre fallback
### Files changed:
- Map provider and behavior tests: `web/src/components/{GoogleMap,MapProviderMap,googleMapsLoader,map-types}.{ts,tsx}` and `web/src/components/{GoogleMap,MapProviderMap}.test.tsx`
- Existing map boundary: `web/src/components/{MapView,MapLibreMap,ParcelMiniMap}.tsx`
- Dependencies and operator guidance: `web/{package.json,package-lock.json,README.md}`; `README.md`; `DEPLOY.md`; `DEMO.md`
### Diff summary: When both `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` and `NEXT_PUBLIC_GOOGLE_MAP_ID` are available, the command map and parcel mini-maps now use the official Google Maps JavaScript API with hybrid/road views, existing land-category GeoJSON styling, accessible alert markers, preserved selection, and preserved camera movement. Missing configuration or a loader failure switches to the existing MapLibre renderer with an explicit status message. The backend, parcel/case contracts, runtime data, and environment values were not changed or read.
### Verification: Red-first provider tests failed on the absent Google components, then passed after implementation. Web: 197 passed across 37 files (was 192, +5); TypeScript clean; ESLint clean; optimized Next.js build clean; built-server requests returned 200 for `/`, `/console`, `/parcels/PCL-1001`, `/alerts`, and `/cases`; `git diff --check` clean. Production dependency audit still reports the two pre-existing moderate Next.js/PostCSS findings whose suggested automatic fix is a breaking downgrade; no high or critical findings and no forced audit fix applied.
### Recommendations / Next steps: Commit and publish through the existing GitHub-to-Vercel path, then verify deployment health and the live `/console` route. Keep the Google browser key restricted to approved referrers and Maps JavaScript API only; keep Google imagery contextual rather than enforcement evidence.

## [AGENT: Codex] [2026-07-17T03:16Z]
### Action: Published and verified the Google Maps frontend integration
### Files changed: `agents-build-log.md` (deployment closeout only; release source was committed as `d0a36bd`)
### Diff summary: Pushed the validated map-provider release to `origin/main`; Vercel rebuilt the Next.js frontend using the user-managed Google Maps variables. The existing Render backend, environment values, credentials, data, and hosting configuration were not modified.
### Verification: Vercel reported a successful deployment. Production returned 200 for `/`, `/console`, `/alerts`, `/cases`, and `/parcels/PCL-1001`; the deployed dynamic console bundle contains the Google provider, loading state, and explicit fallback states; a restricted Google browser key was injected at build time without its value being displayed. The unchanged Render parcels endpoint continued to return the expected unauthenticated 401.
### Recommendations / Next steps: Open `/console` once in a normal browser to confirm the Google Cloud referrer restriction accepts the production hostname and that the selected map ID displays the intended hybrid imagery. If the explicit fallback appears, review Maps JavaScript API enablement, billing, and the key's website restrictions.

## [AGENT: Codex] [2026-07-17T04:27Z]
### Action: Aligned the public landing visual system with the government console and added source-attributed historical parcel imagery
### Files changed:
- Landing visual system and tests: `web/src/app/{page.tsx,page.test.tsx,globals.css}`
- Parcel imagery timeline and tests: `web/src/components/{HistoricalImageryTimeline.tsx,HistoricalImageryTimeline.test.tsx}`; `web/src/app/parcels/[id]/page.tsx`; `web/next.config.ts`
- Operator guidance: `DEMO.md`; `web/README.md`
### Diff summary: Replaced the landing-only green palette and heavy display typography with the console's `gov` blue, neutral gray, Inter/system font, semibold headings, controls, focus states, cards, and trust section while preserving the landing content and `/console` paths. Replaced the parcel imagery placeholder with a responsive timeline containing verified NASA GIBS Landsat WELD scenes for 1990 and 2000 and MODIS Terra for 2010, plus an honest 1985 coverage-gap state, parcel-center marker, loading/network failure states, capture date, source, resolution, and an explicit planning-context-only warning. Added only the NASA GIBS image-host allowlist; no environment variables, credentials, dependencies, backend code, or runtime data changed.
### Verification: Red-first focused tests failed on the missing landing tokens and timeline component, then passed after implementation. Web: 200 passed across 38 files (was 197, +3); ESLint clean; optimized Next.js build/type-check clean; `git diff --check` clean. Built-server checks returned 200 for `/`, `/console`, `/parcels/PCL-1001`, `/alerts`, and `/cases`; parcel HTML contained the timeline, selected 2010 scene, NASA host, and non-evidence warning. Direct NASA WMS probes returned valid 960×540 JPEGs for all three usable dates. Dependency audit remains at the two pre-existing moderate Next.js/PostCSS findings; the automatic suggestion is a breaking downgrade, so no forced fix was applied.
### Recommendations / Next steps: Commit and publish through the existing GitHub-to-Vercel path, then verify that production serves the landing palette and parcel timeline. Keep historical imagery contextual and retain the honest 1985 gap unless a reviewed source provides valid coverage.

## [AGENT: Codex] [2026-07-17T04:30Z]
### Action: Published and verified the landing alignment and historical imagery timeline in production
### Files changed: `agents-build-log.md` (deployment closeout only; release source was committed as `ccee286`)
### Diff summary: Pushed the validated frontend release to the established `origin/main` Vercel path. Vercel rebuilt the Next.js site and the unchanged backend check completed successfully. No environment variables, credentials, backend code, datasets, hosting settings, or runtime data were changed.
### Verification: Vercel reported success; production returned 200 for the public landing page and `/parcels/parcel-1`. The live landing contains the `gov` blue and neutral-gray tokens, and the live parcel HTML contains Imagery Timeline, the selected 2010 observation, NASA GIBS attribution, remote imagery host, and planning-context-only warning. The deployed Next.js image endpoint returned a valid optimized 640×360 JPEG for the NASA scene.
### Recommendations / Next steps: Use the parcel timeline as screening context only. If 1985 coverage is later sourced from a reviewed cadastral or imagery provider, replace the explicit gap with a source-attributed scene and retain the same non-evidence boundary.
