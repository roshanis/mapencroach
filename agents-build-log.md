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

## [AGENT: Codex] [2026-07-19T04:54Z]
### Action: Reviewed the current landing, command map, alert and case queues, parcel record, imagery timeline, persona controls, and due-process workflow for UI/UX improvements and blind spots
### Files changed: `agents-build-log.md` only (required review log); no product code or configuration changed
### Diff summary: Completed a read-only repo-grounded audit. The in-app browser runtime had no available browser, so no viewport screenshots or interactive visual QA were claimed. Identified the highest-impact opportunities around mobile navigation density, queue-to-record affordances, synchronized map/table state, comparable parcel-boundary imagery, workflow ownership/SLA context, plain-language case history, and removal of demo-only controls from production chrome. Also identified missing browser-level accessibility, visual-regression, analytics, and field-usability feedback loops.
### Recommendations / Next steps: Prioritize a responsive operational header and mobile queue, make alert/case rows explicit actions, add a boundary-aligned before/after imagery comparison tied to the alert date, and establish browser-level accessibility plus task-based officer usability tests before adding more dashboard surface area.

## [AGENT: Claude] [2026-07-19T18:15Z]
### Action: Demo-readiness UI overhaul (7 delegated Sonnet workers + orchestrator fixes, all TDD)
### Files changed:
- web: map-markers.ts (new), MapLibreMap, GoogleMap, MapProviderMap, MapLegend, globals.css, types.ts (TIER_COLORS), AlertSidebar, AlertsTable, SelectedAlertCard, KpiStrip, MapIntroPanel, NavLinks, TagEditor, TopBar, DemoMenu (new), PersonaSwitcher (gutted to helpers), ViewingAsBanner, StateRail, CasesTable, TransitionPanel (export only), EvidenceManifest (new), EventTimeline (new), format.ts (new), history.ts (new), server-api.ts, console/alerts/cases/cases[id] pages + tests
- backend: api/store.py (seed dates now relative to now), tests/test_demo_seed_dates.py (new)
### Diff summary: Fixed invisible map markers (root cause: maplibre-gl.css never imported → markers had no position:absolute; also eliminated marker transform fight via wrapper/button split and clobbered aria-labels); markers now 26px numbered severity dots with red-tier pulse + fit-bounds framing. Alert rows/cards enriched (survey no · category · grade, integer severity, severity bars, Parcel/Case quick actions). URL-persisted selection (/console?alert=X deep links). Consolidated demo chrome into a DemoMenu; one-row mobile header; KPI strip on all viewports. Case page: summary card, fixed stepper collisions, narrative event timeline, evidence manifest derived from case artifacts (replaces "coming soon" box). Cases list: next-step chips (detail fetches), humanized durations, clickable rows. Backend demo seed timestamps relative to now (alerts 2–21d old). Suites: web 292/292, backend 259/259; lint+tsc clean.
### Recommendations / Next steps:
- Cases list "Parcel" column still shows raw parcel ids — could enrich like alerts table.
- Backend GET /cases/{id} omits state_since (list has it); frontend falls back to last event timestamp — consider adding for parity.
- Survey Officer persona promises boundary-grade upgrades; PATCH endpoint exists but no UI. Before/after imagery slider and notice generator still unbuilt (PLAN S7-S8).
- Headless-Chrome QA note: new headless clamps window width to 500px min and crops the PNG — mobile screenshots below 500px lie; measure via CDP.

## [AGENT: Codex] [2026-07-19T18:16Z]
### Action: Reviewed the newly arrived demo-readiness batch and prepared the required GO-gated plan for the next workflow sprints
### Files changed: `agents-build-log.md` only (required planning log); no product code or configuration changed
### Diff summary: Confirmed that the uncommitted Claude batch already covers the audit's immediate navigation, queue, map-selection, case-history, and evidence-manifest work. Scoped the next implementation around stabilizing that batch, a boundary-aligned before/after imagery comparison, survey-officer boundary-grade controls, a print-ready evidence packet/certificate-readiness view, and a clearly non-authoritative notice-drafting workspace. No existing changes were reverted or overwritten.
### Recommendations / Next steps: Proceed only after human GO. Keep legal templates and certificate claims explicitly demo-only until approved government forms, signing requirements, and counsel review are supplied; do not commit or deploy without a separate request.

## [AGENT: Codex] [2026-07-19T18:46Z]
### Action: Implemented the approved S7-S8 parcel-verification and case-preparation workflows on `codex-s7-s8-workflows`, preserving the inherited demo-readiness batch
### Files changed:
- Historical imagery comparison: `web/src/components/HistoricalImageryTimeline.tsx`; `web/src/components/HistoricalImageryTimeline.test.tsx`
- Boundary-grade workflow: `web/src/components/BoundaryGradeEditor.tsx`; `web/src/components/BoundaryGradeEditor.test.tsx`; `web/src/app/parcels/[id]/page.tsx`; `web/src/lib/api.ts`; `web/src/lib/api.test.ts`
- Evidence packet: `web/src/app/cases/[id]/evidence-packet/page.tsx`; `web/src/components/EvidencePacketDocument.tsx`; `web/src/components/EvidencePacketDocument.test.tsx`; `web/src/components/PrintPacketButton.tsx`; `web/src/components/PrintPacketButton.test.tsx`; `web/src/components/EvidenceManifest.tsx`; `web/src/components/EvidenceManifest.test.tsx`
- Notice drafting and case integration: `web/src/components/NoticeDraftWorkspace.tsx`; `web/src/components/NoticeDraftWorkspace.test.tsx`; `web/src/app/cases/[id]/page.tsx`; `web/src/app/globals.css`
- Operator guidance: `README.md`; `web/README.md`; `DEMO.md`; `agents-build-log.md`
### Diff summary: Added a matched-extent 1990/2000 imagery reveal with a data-projected parcel overlay while preserving single-year and coverage-gap states; added a survey/data-admin-only boundary-grade editor backed by the existing audited PATCH contract and a required survey reference; added a dedicated print/PDF evidence packet that compiles case, parcel, event, and artifact data while keeping legal review and digital signature visibly pending; and added a Grade-C-aware, required-field notice workspace whose output is marked `DRAFT — NOT FOR SERVICE`. Updated the demo and operator docs to state the legal and evidentiary limits. No dependencies, environment values, credentials, backend behavior, external data, commits, or deployments were added in this round.
### Verification: Focused red-green cycles completed for all four workflows. Full web suite: 309 passed across 47 files; ESLint clean; optimized Next.js build/type-check clean, including `/cases/[id]/evidence-packet`. Full backend suite: 259 passed at 99.71% coverage; Ruff clean. `git diff --check` clean. Known non-failing output remains limited to jsdom navigation/localStorage notices, the existing Starlette TestClient deprecation, intentionally short demo JWT-key warnings, and the ingestion test's missing-CRS warning.
### Recommendations / Next steps: Human-review the uncommitted branch, including the inherited Claude batch. Run a manual browser and print-preview pass on the target demo display before release. Obtain counsel-approved notice language, certificate/signing requirements, and real survey procedures before connecting these surfaces to authoritative government records. Commit or deploy only on an explicit follow-up request.

## [AGENT: Codex] [2026-07-19T23:07Z]
### Action: Finalized the approved demo-readiness and S7-S8 workflow batch for a single branch commit
### Files changed: All previously reviewed files on `codex-s7-s8-workflows`; `agents-build-log.md` updated with this commit handoff
### Diff summary: Preserved and grouped the inherited responsive navigation, actionable queues, synchronized map selection, marker, case-history, evidence-manifest, and relative demo-date work with the approved imagery comparison, boundary-grade editor, evidence packet, notice workspace, tests, and operator documentation. Secret-sensitive filenames, environment files, credentials, dependency manifests, and lockfiles are outside the commit scope.
### Recommendations / Next steps: Commit the validated batch with a descriptive message. Do not push, merge, or deploy until separately requested.

## [AGENT: Claude] [2026-07-25T18:59Z]
### Action: Full-repo defect review (4 Sonnet 5 review agents, orchestrator-verified findings) followed by fixes (3 Sonnet 5 fixer agents + orchestrator), TDD throughout
### Files changed:
- Backend auth/API: `backend/src/mapencroach/api/auth.py` (`using_default_secret()`); `backend/src/mapencroach/api/app.py` (fail-closed startup guard for the default JWT secret outside demo mode; `AlertCreate.tier` typed as `AlertTier`; `AlertCreate.area_m2` now `Field(ge=0)`; `patch_boundary_grade` audits `survey_reference`/`from_grade`/`to_grade`)
- Backend store/audit/imagery: `backend/src/mapencroach/api/store.py` (threading.Lock around audit-chain append and alert/case id sequences; audit payload now includes hashed `at` timestamp; `record_audit(extra=...)`); `backend/src/mapencroach/imagery/registry.py` (lock around register's check-then-act)
- Backend domain: `backend/src/mapencroach/domain/jurisdiction.py` (reject dangling parent ids — silent scope loss was an authorization bug); `backend/src/mapencroach/domain/alerts.py` (negative `area_m2` raises; score clamped to [0,100]); `backend/src/mapencroach/context/shrug.py` (consistent shrid2 strip-normalization)
- Web lib: `web/src/lib/api.ts` (`ApiError`; 404-vs-outage distinction in `getParcel`/`getParcelContext`/`getCase`; `tagRequest` network-failure handling); `web/src/lib/history.ts` (`system:*` actors humanize to "System"); `web/src/lib/cookies.ts` (`Secure` attribute on https via `buildCookieString`)
- Web components: `web/src/components/TransitionPanel.tsx` (state resync when `allowedTransitions` content changes after `router.refresh()` — stale-selection/vacuous-evidence bug); `web/src/components/MapLibreMap.tsx` + `web/src/components/GoogleMap.tsx` (basemap toggle no longer throws/desyncs when clicked before map ready; mount-once data-prop contract documented); `web/src/components/TagEditor.tsx` (friendly network-failure message)
- Tests: `backend/tests/conftest.py` (new, non-default JWT secret fixture), `backend/tests/test_store_concurrency.py` (new), plus extended `test_api.py`, `test_imagery_registry.py`, `test_jurisdiction.py`, `test_alerts.py`, `test_geography.py`, `web/src/components/MapLibreMap.test.tsx` (new), and extended web tests alongside each fix
### Diff summary: 13 verified defects fixed — 4 high (default-JWT-secret fail-open, audit hash-chain race under threadpool concurrency, TransitionPanel stale transition after refresh, MapLibre basemap-toggle throw/desync), 6 medium, 3 low. Every review finding was verified against source by the orchestrator before dispatch; every fixer diff was read and re-verified. All fixes are minimal and behavior-scoped; no dependencies, env values, or deploy config changed. Nothing committed.
### Verification: Backend: 276 passed (was 259), Ruff clean; JWT insecure-key warnings eliminated (122 warnings -> 3). Web: 336 passed across 48 files (was 309/47), ESLint clean, `tsc --noEmit` clean. All new tests confirmed red before each fix.
### Recommendations / Next steps: Human review of the uncommitted working tree; commit on request. Consider wiring `SceneRegistry` behind an endpoint now that it is thread-safe, and revisit `NEXT_PUBLIC_API_TOKEN` bundle exposure (documented tradeoff in DEPLOY.md) before any non-demo deployment.

## [AGENT: Codex] [2026-08-01T03:54Z]
### Action: Reviewed current release readiness and mapped remaining work against the pilot roadmap
### Files changed: `agents-build-log.md` only (required review log); no product code or configuration changed
### Diff summary: Confirmed `codex-s7-s8-workflows` is clean, pushed, and two commits ahead of `origin/main`. The automated defect batch is recorded green, but manual browser/print QA and merge/deploy closure remain. Identified release gaps (no web CI job or browser-level gate), pilot blockers (in-memory store; incomplete PostGIS schema and no Alembic path; demo HS256/browser-token auth instead of Keycloak/OIDC; no durable evidence, read-audit, case ownership/SLA/handover, inspection, or alert-disposition services), and later detection gaps (`SceneRegistry` is in-memory and not API-wired; no imagery ingest/detection/shadow-mode pipeline). No network or production checks were performed.
### Recommendations / Next steps: First add the web CI gate, run manual desktop/mobile/map/role/transition/print QA, then review and merge the two-commit branch and smoke-test the demo deployment. After release, build the pilot foundation in this order: PostGIS/Alembic persistence and schema parity; Keycloak/OIDC with server-only sessions; durable evidence/object storage and read auditing; officer assignment/SLA/handover and inspection workflows; only then imagery ingestion and shadow-mode detection.

## [AGENT: Codex] [2026-08-02T18:02Z]
### Action: Reviewed `codex-s7-s8-workflows` against `origin/main` and reran the full local verification gate
### Files changed: `agents-build-log.md` only (required review log); no product code or configuration changed
### Diff summary: Verdict: CHANGES REQUESTED. Found four merge-blocking coverage gaps: the non-demo JWT guard accepts an empty/whitespace secret; `BoundaryGradePatch` accepts a blank survey reference despite the audit contract requiring one; `AlertCreate.area_m2` accepts positive infinity and returns it as `null`, leaving frontend-incompatible data in the store; and the new notice workspace is rendered without role or case-stage gating, so viewer, closed, stayed, and survey-paused cases can generate/copy/print a training notice. Also confirmed the repository still has no web CI job or root `AGENTS.md`. Non-blocking follow-ups: add compare-imagery failure states, pin evidence-packet timestamps to an explicit timezone, avoid cases-index N+1 detail requests, and repair menu/row accessibility semantics. No network or production checks were performed.
### Verification: Backend `276 passed`, 99.71% coverage, Ruff clean; web `336 passed` across 48 files, ESLint clean, optimized Next.js build/type-check clean; `git diff --check` clean. Direct review probes confirmed whitespace-only JWT secrets start the non-demo app, whitespace-only survey references validate, and infinite alert area validates and serializes as `null` in a successful response.
### Recommendations / Next steps: Add red-first tests and minimal fixes for the four blockers, add the web CI job and repo-root `AGENTS.md`, rerun the full gate, then repeat manual browser and print-preview QA before merge.

## [AGENT: Claude-Reviewer] [2026-08-02T18:32Z]
### Action: Reviewed the uncommitted working-tree delta on `codex-s7-s8-workflows` (on top of the already-reviewed/committed PR #1 content) against the four blockers Codex's 2026-08-02T18:02Z entry raised, plus the new CI job, AGENTS.md, and dependency bumps.
### Files reviewed: backend/src/mapencroach/api/auth.py, backend/src/mapencroach/api/app.py, backend/tests/test_api.py, web/src/lib/notice-gate.ts (+test), web/src/lib/server-api.ts (+test), web/src/app/cases/[id]/page.tsx, .github/workflows/ci.yml, AGENTS.md (new), web/package.json, web/package-lock.json
### Diff summary: All four fixes verified correct and scoped to their stated defects, with no scope creep or weakened tests (backend/web diffs are additive only — 0 deletions in test_api.py, no assertions removed elsewhere).
- `auth._secret()`: None/empty/whitespace-only `MAPENCROACH_JWT_SECRET` now all fall back to `_DEFAULT_SECRET`, tripping `using_default_secret()`'s fail-closed guard in `create_app`. Manually confirmed `_secret()` returns the real value verbatim for non-blank secrets (no truncation/stripping of the actual value, only the blankness check strips for comparison).
- `BoundaryGradePatch.survey_reference`: now `Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)]` — whitespace-only values 422. Only call site (`app.py:316`) unaffected for real values.
- `AlertCreate.area_m2`: `Field(ge=0, allow_inf_nan=False)` plus a `mode="before"` validator normalizing non-finite floats to `None` (so the FastAPI 422 error body serializes cleanly instead of Starlette's `allow_nan=False` JSONResponse crashing on a raw Infinity/NaN in the echoed `"input"`). Manually verified in a REPL: string/int coercion (`"42.5"` -> 42.5, `0` -> 0.0) still works, `inf`/`nan` both raise `ValidationError`.
- `notice-gate.canDraftNotice`: role/state matrix manually cross-checked against `web/src/lib/types.ts` — `CASE_STATE_CHAIN` (11 states incl. terminal `CLOSED`) vs. `SpecialCaseState` (`STAYED_BY_COURT`, `SURVEY_REQUESTED`, `DISMISSED_FALSE_POSITIVE`, `LEGACY_REFERRED`). Gate is `IN_CHAIN_STATES.has(state) && state !== "CLOSED"` AND `role === undefined || role === "case_officer"`. Confirmed `"state_viewer"` is a real role (used in `WorkbenchSummary.tsx:43`), not a typo. `NoticeDraftWorkspace` has exactly one call site (`cases/[id]/page.tsx`), gated by `parcel && canDraft` — no bypass route found.
- `getPersonaRoleForRequest`: cookie shape (`{name, role, jurisdiction_id, jurisdiction_name}`) matches what `PersonaSwitcher.tsx` writes; try/catch covers missing cookie, malformed JSON, and non-string `role`, all resolving to `undefined` (default officer), matching `PersonaSwitcher`/`ViewingAsBanner`'s existing client-side parse pattern.
- `.github/workflows/ci.yml`: new `web` job validated with `ruby -ryaml` (repo has no PyYAML installed) — parses clean. `cache-dependency-path: web/package-lock.json` is correctly repo-root-relative despite `working-directory: web` (setup-node doesn't apply job `defaults` to its own inputs). Ran every step locally: `npm ci`(implicit via existing node_modules)/`npm run lint`/`npx tsc --noEmit`/`npm run test`/`npm audit --audit-level=high` all green.
- `web/package.json` overrides: `"sharp": "^0.35.0"`, `"postcss": "$postcss"` — valid npm overrides syntax (the `$postcss` self-reference pins transitive postcss to the devDependency's resolved version). Verified in the regenerated lock file: `next` 15.5.20→15.5.22, `sharp` 0.34.5→0.35.3, `postcss` unified to 8.5.25 (previously split 8.4.31/8.5.16, plus a `next`-nested duplicate that's now gone). `npm run build` (production) succeeds. No registry/resolved URLs point anywhere but registry.npmjs.org.
- AGENTS.md: accurately reflects current commands/gotchas (checked backend/web command table, JWT blank-secret note, and product guardrails against actual source — all consistent).
### Verification (rerun myself, not trusted from prior log entries):
- Backend: `.venv/bin/python -m pytest -v` → **282 passed**, 3 warnings, 0 failed (was 276 before this delta; +6 new tests: 2 secret-blank/whitespace, 1 blank survey-reference, 3 alert-area inf/nan/normal). `ruff check .` → clean. Targeted coverage on the two touched modules: `api/app.py` 99% (198 stmts, 2 missing — both pre-existing, unrelated to this diff), `api/auth.py` **100%**.
- Web: `npm run test` → **363 passed** across **50 files** (was 336/48; +22 notice-gate tests, +5 server-api tests). `npm run lint` clean. `npx tsc --noEmit` clean. `npm audit --audit-level=high` → 0 vulnerabilities. `npm run build` → production build succeeds.
- `git diff --check` → clean (no whitespace errors; the `web/package.json` missing-trailing-newline is not flagged by git but is a nitpick, see below).
### Issues found
1. NITPICK — `web/package.json:41` — file now ends without a trailing newline (`\ No newline at end of file` in diff). Cosmetic only; doesn't affect `npm`/JSON parsing. Fix: add trailing newline for consistency with the rest of the repo's file endings.
2. NITPICK — `backend/src/mapencroach/api/app.py:162-163` — the `mode="before"` validator returns `None` for non-finite floats, which surfaces as a pydantic "not a valid float" / missing-value message rather than a message naming the actual Infinity/NaN input. Status code (422) and safety are correct; only the error-message wording is a minor UX/debuggability tradeoff, and it's already called out honestly in the code comment. No action required before merge.
### Verdict: APPROVED
### Recommendations / Next steps: Ship as-is. Optional cleanup only: add trailing newline to web/package.json. No merge-blocking issues remain from Codex's 2026-08-02T18:02Z findings — all four are fixed and verified red-then-green; CI web job and root AGENTS.md (also flagged as missing) are both now present and correct.

## [AGENT: Codex] [2026-08-02T18:36Z]
### Action: Re-review of codex-s7-s8-workflows branch (verifying 4 prior blockers + 2 structural asks)
### Findings:
1. Blocker 1 — VERIFIED: `backend/src/mapencroach/api/auth.py:24-33` maps unset, empty, and whitespace-only `MAPENCROACH_JWT_SECRET` values to the dev default; `backend/src/mapencroach/api/app.py:222-230` then fails closed outside demo mode. The focused regression run passed all 9 selected API tests, including every `TestSecretGuard` case; the full backend run passed 282 tests.
2. Blocker 2 — VERIFIED: `backend/src/mapencroach/api/app.py:132-140` defines `survey_reference` as an `Annotated` string with `StringConstraints(strip_whitespace=True, min_length=1)`. `TestBoundaryGradePatch::test_blank_survey_reference_is_422` passed in the focused run, and the full backend run passed 282 tests.
3. Blocker 3 — VERIFIED: `backend/src/mapencroach/api/app.py:143-164` applies `Field(ge=0, allow_inf_nan=False)` and a before-validator that replaces non-finite float inputs with `None`, keeping the validation error JSON-safe. The Infinity, NaN, and normal finite-area focused tests all passed; the full backend run passed 282 tests.
4. Blocker 4 — VERIFIED in code/tests: `web/src/lib/notice-gate.ts:24-40` allows only the default/`case_officer` role in an in-chain non-`CLOSED` state; `web/src/app/cases/[id]/page.tsx:50-55,191-197` obtains the request persona role server-side and gates the sole `NoticeDraftWorkspace` render; `web/src/lib/server-api.ts:35-50` parses the persona cookie. Focused Vitest passed 22 gate-matrix tests plus 5 cookie-parsing tests, and the full web suite passed 363 tests across 50 files. The reported browser behavior was not independently browser-replayed, but it is consistent with seed code/tests showing `case-1` at `SHOW_CAUSE_ISSUED` and `case-2` at `CLOSED`.
5. Structural ask 1 — VERIFIED: `.github/workflows/ci.yml:28-49` has a web job with `npm ci`, ESLint, `npx tsc --noEmit`, Vitest via `npm run test`, and `npm audit --audit-level=high`. The corresponding local commands all exited 0; Vitest passed 363 tests and npm audit reported 0 vulnerabilities.
6. Structural ask 2 — VERIFIED: repo-root `AGENTS.md` exists and records the backend/web gates, branch/TDD/logging agreements, local gotchas, and product guardrails (`AGENTS.md:1-32`).
7. Structural ask 3 — VERIFIED: `web/package.json:32,37-40` sets PostCSS `^8.5.18` and overrides Sharp `^0.35.0` plus transitive PostCSS through `$postcss`; the lock/install tree resolves Next 15.5.22, Sharp 0.35.3, and PostCSS 8.5.25. `npm audit --audit-level=high` reported 0 vulnerabilities, `npm ls next sharp postcss --all` exited 0, and `npm run build` completed the optimized Next.js 15.5.22 production build successfully.
### Verdict: APPROVED
### Notes: The earlier non-blocking follow-ups remain post-merge backlog and were not reopened; no new non-blocking findings were identified.

## [AGENT: Claude] [2026-08-02T19:05Z]
### Action: Session Ritual Complete — merge gate for PR #1 (codex-s7-s8-workflows)
### Test suite: PASSING (web 363/50 files; backend 282, 99% cov — auth.py 100%, app.py 99%)
### Lint: CLEAN (eslint, tsc --noEmit, ruff)
### Security: CLEAN (npm audit 0 vulns after next 15.5.22 + sharp/postcss overrides; pip-audit clean; secrets scan clean; production build verified on patched deps)
### Fixes this gate: Codex's 4 CHANGES REQUESTED blockers (whitespace JWT secret, blank survey_reference, Infinity/NaN area_m2, ungated notice workspace) — all red-first TDD; plus web CI job and repo-root AGENTS.md
### Manual QA: browser pass (map markers/selection/deep-link, case pages, gating present/absent on case-1/case-2) + evidence-packet print-to-PDF (2 clean pages)
### PR description: updated on PR #1
### Sign-offs: Claude-Reviewer APPROVED (2026-08-02T18:32Z) · Codex APPROVED (2026-08-02, entry at log line ~338)
### Next: commit delta, merge PR #1, then reconcile PR #2 and redeploy demo

## [AGENT: Claude] [2026-08-04T03:53Z]
### Action: Completed and hardened the user's uncommitted H3 analytical-grid feature
### Files changed: `web/src/lib/h3-grid.ts` (created via Sonnet 5 subagent against the pre-existing test contract; NOTE: a user-authored version of this file appeared on disk mid-task and was rewritten in place — parcelIds now first-encountered order instead of Set+sort, an untested isSafeInteger(maxCells) guard was dropped, DEFAULT_MAX_H3_CELLS 5000→4000; both versions satisfied the tests); `web/src/components/MapLibreMap.tsx` + `MapLibreMap.test.tsx` (red-first fix: H3 visibility/data effects no longer gate on isStyleLoaded(), which reports false while tiles stream after pan/zoom and silently dropped updates; h3LayersReadyRef alone is the correct guard)
### Diff summary: buildH3Grid covers parcel polygons via polygonToCells (GeoJSON lng/lat), centroid-cell fallback for sub-cell parcels, cross-parcel dedup with contributing parcel ids, UNSUPPORTED_RESOLUTION/MAX_CELLS_EXCEEDED UI-safe errors with no partial output. Reviewed the user's uncommitted H3 wiring across console page, both map providers, MapLegend, map-types: sound apart from the fixed dropped-update window. Also confirmed commit 229b3c5 cleared all four Codex merge blockers plus web CI and AGENTS.md.
### Verification: web 381 passed across 52 files (was 361 + 2 unloadable), ESLint clean, tsc clean. Backend untouched since 229b3c5.
### Recommendations / Next steps: User to confirm or restore their own h3-grid.ts choices (order/guard/5000 constant). Commit the H3 batch on request; branch is otherwise merge-ready per Codex's blocker list.

## [AGENT: Claude] [2026-08-04T04:00Z]
### Action: Verified the production deployment of merged PR #1 and completed the DEMO.md dry-run against the live URLs
### Files changed: `agents-build-log.md` (deployment closeout only; release source merged to main as `81e46e5`)
### Diff summary: No code changed. PR #1 merged; Vercel auto-built production from `81e46e5` (Production deployment 2026-08-04T03:48Z) and Render redeployed the backend — the live OpenAPI schema shows the new validation constraints (`survey_reference` minLength 1, `area_m2` minimum 0), confirming the API is on new main. No environment variables, credentials, or hosting settings changed.
### Verification: GitHub CI green on the merge commit (backend + web jobs). Live checks: API returns 401 unauthenticated in 0.17s (warm); landing and `/console` return 200. Headless-browser pass over the DEMO.md stops on production: `/console` shows the Google satellite basemap, severity-numbered alert markers, KPI strip (30 parcels / 6 triage / 3 urgent / 4 in due process), and the workbench queue with relative seed dates; `/alerts` lists 10/10 with tier chips and severity bars; `/cases` groups due-process/paused/concluded with stage progress; `/cases/case-1` renders the 11-step rail at Show Cause Issued, stage-gated next steps, the notice workspace (training-only banner) for the default officer, humanized event history, and the evidence-packet manifest; `/parcels/parcel-1` renders the imagery timeline (honest 1985 gap + 1990/2000/2010 NASA GIBS scenes with attribution and the non-evidence warning) and the seeded `court-monitored` tag; `/console?alert=alert-1` deep-link pre-selects SN-101 with the enlarged marker and action card. Technical encore run live against Render: skipping to ORDER_ISSUED → 409 "cannot transition from SHOW_CAUSE_ISSUED to ORDER_ISSUED"; dismissal without evidence → 409 naming the missing dismissal_reason. Both refusals mutate nothing.
### Recommendations / Next steps: The demo token remains extractable from the public JS bundle in one grep (documented DEPLOY.md tradeoff — demo data only; must close before any pilot). PR #2's branch has grown into an active 12-commit feature train (imagery capture/watchlist) and conflicts with main — reconcile via its owning session or extract the unique security hardening into a fresh PR off new main; human to decide. Unmerged commit `14a0bbe` (H3 grid overlay, this branch) references the H3 demo stop in DEMO.md while main's DEMO.md does not — merge or hold deliberately; production has no H3 control until it lands.

## [AGENT: Claude] [2026-08-04T04:25Z]
### Action: Implemented Tracks B and C of the approved next-phase plan via three Sonnet 5 subagents (orchestrator-verified diffs, TDD throughout)
### Files changed:
- Track B (token out of the bundle): `web/src/app/api/backend/[...path]/route.ts` + `route.test.ts` (new server-side proxy: auth precedence Authorization header -> persona cookie -> server-only MAPENCROACH_API_TOKEN; 503 unconfigured, 502 unreachable, verbatim passthrough); `web/src/lib/api.ts` (getApiBase prefers server-only MAPENCROACH_BACKEND_URL server-side; authHeaders no longer reads NEXT_PUBLIC_API_TOKEN); `DEPLOY.md` (new env model, bundle-exposure caveat retired). Post-build grep confirms no token in .next/static.
- Track C backend: `backend/src/mapencroach/api/app.py` + `store.py` — POST /cases/{id}/transfer (CASE_OFFICER/DATA_ADMIN, scope-404, unknown-target/no-op 400, audited case.transfer with from/to/reason, cross-scope handover allowed), POST /imagery/scenes + GET /imagery/scenes/{id} (DATA_ADMIN ingest, base64 validation, DuplicateScene 409, audited, SceneRegistry now wired and live), GET /jurisdictions (unscoped admin reference data for handover targets), jurisdiction_id added to case detail payload, _case_to_detail serializer extracted.
- Track C web: `web/src/components/TransferPanel.tsx` + test (role-gated via cases/[id]/page.tsx, target picker excluding current jurisdiction, required reason, success deliberately avoids router.refresh() since cross-scope handover would 404 the page); `web/src/lib/api.ts` (getJurisdictions, transferCase), `types.ts`, `fixtures.ts`, `server-api.ts`, case page wiring.
### Diff summary: The public-bundle bearer token is eliminated (biggest pre-pilot security gap); S9-S10 transfer/handover workflow and the imagery evidentiary anchor are live end-to-end. Deploys now set NEXT_PUBLIC_API_URL=/api/backend plus server-only MAPENCROACH_BACKEND_URL and MAPENCROACH_API_TOKEN.
### Verification: Backend 305 passed (was 301 baseline this session, 276 at session start), Ruff clean. Web 413 passed across 54 files (was 381 at session start), ESLint clean, tsc clean, next build clean. Every subagent ran red-first; orchestrator read all diffs and re-ran all gates independently.
### Recommendations / Next steps: Uncommitted, awaiting human review/commit. Deployment configs must be migrated to the new env vars before the next deploy (old NEXT_PUBLIC_API_TOKEN deployments keep working only in fixture mode). Track D (PostGIS persistence) remains the next gated plan; Keycloak/OIDC per Codex's pilot-blocker list after that.

## [AGENT: Codex] [2026-08-04T04:58Z]
### Action: Audited the concurrently merged PR #2 tree and prepared a narrow post-merge correction with three Luna read-only reviews
### Files changed: `.github/workflows/ci.yml`; `backend/src/mapencroach/api/app.py`; `backend/tests/test_api.py`; `web/src/app/console/page.tsx`; `web/src/app/console/page.test.tsx`; `agents-build-log.md`
### Diff summary: Red-first test and fix ensure direct scene ingestion flushes the persistent scene index and audit record instead of leaving retained bytes orphaned after restart. Dependency audits now run inside the existing required backend/web checks instead of a non-blocking advisory job. A red-first UI assertion moves the H3 control below the 52px basemap toggle and active top safe-area inset. The merged binary-safe API proxy and its ETag/304 tests remain unchanged.
### Verification: Backend 711 tests passed, Ruff clean, pip-audit found no known vulnerabilities. Web 556 tests across 59 files passed, ESLint clean, TypeScript clean, Next.js production build clean, npm audit found 0 vulnerabilities. CI YAML resolves exactly `backend` and `web`, contains no `continue-on-error`, and `git diff --check` is clean. Existing jsdom navigation/act and test-key-length warnings remain non-failing.
### Recommendations / Next steps: Push this branch as a follow-up PR, require fresh backend/web/Vercel success, merge only after all required checks are green, and keep real-device notch behavior as a later browser acceptance check.

## [AGENT: Claude] [2026-08-04T06:10Z]
### Action: Session Ritual Complete — merge gate for the re-derived hardening PR (claude/harden-claims-authority, rebuilt on main 3327fff after PRs #2/#3/#4 merged mid-flight)
### Test suite: PASSING (backend 723, was 722 on main; web 557 across 59 files; all red-first for new behavior — persistence-migration and ordering/persona tests demonstrated red via stash-revert against unmodified sources)
### Lint: CLEAN (ruff, eslint, tsc --noEmit); git diff --check clean
### Coverage: api/app.py 99%, api/auth.py 100%, persistence.py 100%, audit/chain.py 95% (uncovered lines are defensive branches of the retired-encoding verifier)
### Scope this gate (delta on merged main, most of the original branch became redundant when PR #2 landed):
- audit/chain.py: constructor-tagged injective canonicalization replacing the forged-tag-collidable encoder that PR #2 shipped (Codex counterexample now a regression: a crafted {"__type__": ...} dict no longer hashes like the datetime it imitates); tuple→list normalization kept as a documented JSON-round-trip equivalence (Codex re-review accepted, not a blocker); legacy verifier + rehash_chain migration helpers
- persistence.py: _STATE_VERSION 2 with version-aware load — version-1 files verified under the encoding they were written with, then migrated (rehashed) in memory; tampered v1 refused; unknown versions refused; next save writes v2 (closes Codex's fail-closed-at-startup blocker; red-first: all 4 tests fail against the pre-change loader)
- api/app.py transitions: sequence pre-check (engine's 409 wording) BEFORE the legal-authority 403 — realigns code with the DEMO.md script both for the ORDER_ISSUED encore (was silently broken by PR #2's authority-first ordering) and the UI policy-guard demo; one merged test (unilateral CLOSED) rewritten to test authority at a sequence-legal close instead of conflating it with an out-of-order jump
- Legal Officer demo persona (legal-hrda, backend + web fixtures parity + roster test) so the authority gate is demonstrable; DEMO.md stop 4 now presents sequence/authority/evidence as three guards with verbatim refusal strings
- DEPLOY.md corrected: MAPENCROACH_DEMO=1 + custom MAPENCROACH_JWT_SECRET now refuses to boot (PR #2 behavior) but DEPLOY.md still instructed setting both — this is why the Render deploy of merged main is failing at startup and serving the stale PR #4 build; demo deployments must drop the secret and mint the proxy token with the dev default from current code
### Security: pip-audit clean, secrets scan clean, no dependency changes
### Sign-offs: Claude-Reviewer APPROVED (pre-rebase batch; adversarial probes incl. live pre-hardening comparison) · Codex first pass CHANGES REQUESTED (collision + base-moved) → collision fixed and re-verified, tuple/list equivalence accepted on re-review; final re-verdict on the pushed branch pending · Human authorized merge-on-green ("merge the PR once done")
### Production status observed during this gate: Vercel console down (server-side proxy missing MAPENCROACH_API_TOKEN env), Render serving stale PR #4 build (new deploys fail on the demo+secret refusal). Recovery runbook is in the PR description — one token mint covers everything if done after this PR merges.

## [AGENT: Codex] [2026-08-04T16:05Z]
### Action: Verified the concurrent PR #6, PR #7, and PR #8 merges against the current remote `main` and closed out the requested push-and-merge round
### Files changed: `agents-build-log.md` only; no product code, workflow, dependency, environment, or deployment configuration changed
### Diff summary: Confirmed PR #6 merged audit-hash/state-migration and demo-authority hardening at `6c1edc4`; PR #7 merged STAC scene discovery at `f1cad44`; and PR #8 merged backend H3 parcel/alert indexing at `679f7ff`. Those commits and the earlier PR #5 persistence/CI/H3 correction are ancestors of current `main`. GitHub reports zero open pull requests, so no duplicate reconciliation code was pushed.
### Verification: Exact post-merge `main` run 30927208801 is green: backend Ruff, 779 tests, and dependency audit; web ESLint, TypeScript, 557 tests across 59 files, production build, and dependency audit. Both audits found no known vulnerabilities. The production Vercel status for merge SHA `679f7ff` completed successfully. No production settings or secrets were accessed or changed.
### Recommendations / Next steps: Run an authenticated production smoke test before relying on the deployment. Treat H3 cells and STAC discoveries as analytical screening context, not legal evidence or authoritative cadastral boundaries.

## [AGENT: Claude] [2026-08-04T16:40Z]
### Action: Recorded Codex's post-merge verdict on PR #6 and fixed its one surviving finding
### Files changed: `DEMO.md` (pre-flight step 3), `agents-build-log.md`
### Diff summary: Codex's final review (completed after PR #6 merged as 6c1edc4) independently verified the v1->v2 state migration (own probe: legacy hashing -> load -> rehash -> v2 save/reload; tampered v1 and unknown versions refused), reproduced the legacy forgery collision and confirmed the constructor-tagged encoding separates it, accepted the tuple/list JSON equivalence, and confirmed the rewritten CLOSED test, persona parity, DEPLOY.md guidance, and documented refusal strings. Verdict reduced to one Medium documentation finding: DEMO.md's local pre-flight pointed NEXT_PUBLIC_API_URL directly at http://localhost:8000, where browser-side calls cannot authenticate (client code deliberately uses only the proxy token or a persona cookie) and which contradicts AGENTS.md's 127.0.0.1 rule. Fixed: pre-flight now routes through the /api/backend proxy with MAPENCROACH_BACKEND_URL=http://127.0.0.1:8000.
### Verification: Docs-only change; DEMO.md rendered and command syntax checked. Production verified live post-merge: backend on merged main (pagination + watchlist live, boots without custom secret), all three policy-guard refusals return DEMO.md's exact strings against Render, legal-hrda persona login works. Vercel console pending the user's two env fixes (MAPENCROACH_BACKEND_URL missing -> proxy 503; NEXT_PUBLIC_API_URL still the direct Render URL).
### Recommendations / Next steps: After the Vercel env fix + redeploy, re-run the console screenshot pass. Post-merge backlog remains: web pagination awareness (X-Total-Count), counsel-approved notice templates, OIDC before any pilot.
