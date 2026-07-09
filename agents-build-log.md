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
