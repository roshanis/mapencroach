# Worldview-inspired imagery improvements

Prepared: 2026-09-08 (America/Chicago). Original status: implementation proposal.
The user subsequently approved increment 1, which is implemented on the isolated
`codex/worldview-imagery` worktree. See [implementation and verification status](WORLDVIEW-INCREMENT-1.md).
The subsequent user-approved cloud-check change and merge are documented in
[CLEAR-IMAGERY-RELEASE.md](CLEAR-IMAGERY-RELEASE.md).
Increments 2–4 remain proposals. The historical planning baseline below is retained
for context; the implementation handoff records the refreshed baseline and current gates.

## Outcome and delivery order

An officer should be able to open a parcel, find relevant imagery dates, compare observations, inspect their sources, and save a view that another authorized officer can reopen. A review export should explain exactly which observations were used and which information remains unavailable.

Deliver four independently reviewable increments:

1. **Dates and timeline:** selectable A/B dates, explicit availability states, and source details.
2. **Map layers:** coordinated layer controls and spatially verified retained-scene comparison.
3. **Saved review views:** authenticated, persistent views with pinned scene references.
4. **Review manifests:** structured imagery provenance in JSON and the existing draft packet.

Start with increment 1. Keep the current Google Maps/MapLibre architecture and implement the selected interaction patterns in our own components. Animation, spy-glass comparison, a large public layer marketplace, automatic change detection, and new imagery-provider acquisition are outside these increments. Browse imagery remains planning context; saving or exporting it does not make it authoritative evidence.

## Verified baseline and integration approach

The current checkout is `codex-s7-s8-workflows` at `f6d2fe5`, with existing uncommitted imagery/provider/persistence work. The locally recorded `origin/main` is `5de1e28`, containing PR #16. This plan uses that recorded main as its implementation baseline; remote freshness has not been checked in this planning round.

- Main already has monthly GIBS HLS browsing, a fixed first/last comparison, image-load recovery, and weekly capture-history states. Extend those implementations; do not reintroduce the checkout's older fixed-year browser.
- `CaptureAttempt` records the week and attempt time. `SceneRecord` separately holds the provider-reported observation time, sensor, resolution, hash, source, and retention status. The weekly API does not currently expose all of that metadata.
- `/parcels/{id}/scenes` already discovers Sentinel-2 candidates through STAC. It is a separate collection and workflow from GIBS HLS browsing; a matching date does not prove the two images represent the same source item.
- Map props support selection, camera initialization, H3, and pan-to, but lack a shared layer/date state and camera-change callbacks. URLs currently preserve alert selection rather than a complete review view.
- Persistence version 3 and draft evidence packets exist. Neither currently supplies a saved-view model or a structured imagery-review manifest.

After implementation GO, recheck target main and create a separate `codex/worldview-imagery` branch/worktree from it. Preserve this checkout and its dirty files. Compare the newer base with the reviewed baseline before editing. Reconcile any dependency on the uncommitted provider work explicitly in the implementation review; do not copy that work wholesale. Commit only when requested; human approval remains required before merge.

## Shared data and display contract

Define these rules before adding controls:

| Information | Contract |
| --- | --- |
| Observation identity | Use a discriminated type for an external browse request, a discovered candidate, and a registered scene. Carry collection/product identity where known. Never infer a registered scene from a matching date or URL. |
| Time | Keep observation time or composite interval, requested date/window, and fetch/attempt time separate. For GIBS, show the requested/resolved browse date; label exact acquisition time unknown unless source metadata verifies it. |
| Availability | Keep loading/unattempted, preview available, empty preview in the searched window, recorded no-usable-scene, provider error, and monitoring-history gaps distinct. Preserve the backend's existing capture statuses; add presentation state separately. |
| Quality | A nonblank raster proves a preview rendered, not that the parcel is clear. Unknown cloud/quality is unknown; SAR cloud applicability is not an optical quality score. Avoid claiming a failed search proves no satellite pass or no change. |
| Geometry | Match map extent, CRS, render grid, and imagery-to-parcel alignment before swipe comparison. Same pixel dimensions or a catalog thumbnail are insufficient. Sensor, processing, season, and resolution differences remain visible. |
| Retention | Keep registered metadata, retained bytes, successful retrieval, and hash verification distinct. A screenshot/export hash is not the source-scene hash. |
| Provenance | Show source/product, sensor, nominal source resolution versus display sampling where known, date precision, quality scope, attribution/license, and limitations. Missing fields remain unknown. |

GIBS GetCapabilities/DescribeDomains can supply candidate dates, not parcel-specific usable coverage; DescribeDomains does not filter availability by its bounding-box parameter. WMS can select a nearest available time. Any metadata-assisted date discovery must preserve these distinctions. Initially retain bounded requests over the existing date windows rather than adding a new catalog service dependency.

## Increment 1 — selectable dates and a truthful timeline

**User journey:** Open a parcel, select two dates from the available browsing windows, inspect each source, and drag a keyboard-accessible comparison slider. In a case's weekly history, select a capture to inspect its recorded time, source, quality, and retention status without triggering a new capture.

**Changes:**

| File(s), relative to repository root | Intended change |
| --- | --- |
| `web/src/lib/imagery-view.ts` (new) | Typed observation references, comparison selection, and presentation-state rules. Freeze date-window inputs per view; keep A/B identity independent of array position. |
| `web/src/lib/latest-imagery.ts` | Reuse monthly windows and bounded lookup; clarify blank-preview and unverifiable-pixel outcomes. Use request identity so stale results cannot replace a newly selected parcel/date. |
| `web/src/components/HistoricalImageryTimeline.tsx` | Replace fixed first/last choices with independent A/B selectors. Preserve same-extent rendering, retries, boundary overlay, and context wording. Default to two distinct available previews when possible; explain why comparison is unavailable otherwise. |
| `web/src/components/ImageryAvailabilityTimeline.tsx`, `ImagerySourceDetails.tsx` (new) | Compact date/week navigation plus a text/list alternative; labelled states and accessible source details. Preserve the full weekly history as the detailed record. |
| `web/src/components/WeeklySnapshotTimeline.tsx`, `CaseImageryHistory.tsx` | Wire selection and details while preserving capture/backfill/retry controls and current demo/role restrictions. Browsing does not start watching or backfill. |
| `backend/src/mapencroach/imagery/view.py` (new), `backend/src/mapencroach/api/app.py` | Add a reusable read-only projection of registered scene metadata to existing case/watch capture responses. Resolve through the authorized parent and capture reference, not the unscoped scene-by-ID endpoint. Return explicit missing metadata rather than fabricate it. |
| `web/src/lib/types.ts`, `api.ts`, `server-api.ts`, `fixtures.ts` | Add optional scene details consistently across reads and capture/backfill responses; preserve older response compatibility and mark fixtures synthetic. |

Case scenes remain individually viewable in this increment. Enable their swipe comparison only after increment 2 establishes alignment metadata; arbitrary retained clips and STAC thumbnails must not be stretched into a common frame.

**Acceptance and red-first tests:**

- Select two distinct browse dates, swap A/B, and change either side without losing the other selection. Empty/single-date ranges and January/year boundaries remain usable.
- A provider timeout stays an error; a blank preview stays an empty search result; unreadable pixels and absent quality metadata never produce a clear-image claim.
- Show a resolved browse date only when provider metadata or a verified source-item mapping identifies it. Otherwise show the requested date/window and source time unverified. Pixel blankness cannot establish an acquisition date.
- GIBS A/B uses the same product, requested extent, CRS, and render grid for contextual visual comparison. It does not establish source-image registration accuracy, parcel-level change, or evidentiary comparability.
- Rapid parcel/date changes cannot publish stale results. Bound in-flight image searches to the active single view or A/B pair; deduplicate identical requests, cancel/ignore superseded requests, and avoid loading the full history at once.
- Week label, attempt time, and provider-reported observation time appear separately. Missing registry data, hash disagreement, non-retained bytes, 401/403, and transient image errors have distinct handling.
- Parent-resource authorization is checked before metadata enrichment, including transferred cases. Display state never bypasses existing image authorization or hash checks.
- All controls work by keyboard; slider labels name both dates. Status is communicated in text, not color alone. At 390px, controls and details fit without covering imagery.

Extend the existing historical/weekly/case component tests and API tests; add `imagery-view.test.ts`, component tests for the new controls, and backend projection tests. Extend `web/scripts/demo-smoke.mjs` with mocked image/date responses, keyboard comparison, and mobile checks.

**Exit:** The first parcel comparison and case-history journeys pass unit/API and offline-browser checks. No saved-view persistence, new provider integration, or schema migration is required for this increment.

## Increment 2 — map layers and aligned retained images

**User journey:** Open the console, switch approved layers on/off, adjust imagery opacity, inspect attribution, and use the same date selection across the map and parcel detail. Compare registered observations only when their spatial metadata supports it.

**Files:** Add `web/src/lib/imagery-layers.ts` and `web/src/components/ImageryLayerPanel.tsx`; extend `map-types.ts`, `MapProviderMap.tsx`, `MapLibreMap.tsx`, `GoogleMap.tsx`, and `web/src/app/console/page.tsx`. Reuse the increment-1 state and source-detail components.

- Begin with existing basemaps, parcel boundaries, H3, and the already-used HLS context product. Use a small typed catalog with attribution, coverage, resolution, permitted uses, and map-provider support; layer availability is an explicit per-provider capability.
- Give both map adapters the same layer/date state and viewport callbacks. Retain state across Google-to-MapLibre fallback. Show unsupported/unavailable layers explicitly; never silently replace an imagery product.
- Add new raster imagery only after checking its EPSG:3857 tile-matrix compatibility, maximum zoom, allowed display/export use, and attribution. Preserve current parcel selection and canvas resizing.
- For registered scenes, first establish verified clip bounds, CRS, width/height, pixel mapping, processing/product, and nodata information. Extend `imagery/registry.py`, provider/render contracts, response projection, and persistence serialization only where that metadata can be recorded accurately. Old scenes may have unknown alignment; do not backfill invented values.
- Enable retained-scene A/B only for images projected into the same verified frame. Surface optical/SAR and resolution differences; retain single-image inspection for unsupported combinations.

**Acceptance:** Provider-parity tests for state, opacity, attribution, selected parcels, and fallback; geometry fixtures including polygon holes/multipolygons for supported overlays; known control-point alignment; unavailable-layer recovery; no mobile overlap; regression checks for current H3 and selection behavior. If scene serialization changes, include legacy round-trip and integrity checks. Existing dirty provider changes require explicit reconciliation before this portion is implemented.

**Exit:** Supported layers behave consistently on both providers, and imagery comparison cannot imply alignment where it is unknown.

## Increment 3 — authenticated saved review views

**User journey:** Save a review, copy its link, and have another currently authorized officer reopen the same extent, layer settings, selected observations, and source details.

**Files:** Add `backend/src/mapencroach/domain/review_view.py`, a focused `api/review_views.py` router, `web/src/lib/review-view.ts`, `SaveReviewViewButton.tsx`, and `web/src/app/review-views/[id]/page.tsx`. Extend `api/app.py`, `api/store.py`, `operational_state.py`, `persistence.py`, web API/types, and tests.

- Proposed endpoints: `POST /cases/{case_id}/review-views`, `GET /review-views/{id}`, and `POST /review-views/{id}/revoke`. Start case-scoped; parcel-only private view persistence is a later extension.
- Store schema version, creator, server timestamps, parent case/parcel relationships, viewport, allowed layer IDs/settings, A/B references, and source metadata. Registered references pin scene ID and hash plus the authorized capture relationship. Freeze relative labels such as Latest into explicit dates at save time.
- A link contains an opaque ID, never a credential or embedded case details. The ID grants no access: every open/image/export rechecks the case's current jurisdiction and every referenced resource. A changed week-to-scene relationship must show an unavailable pinned reference, never substitute newer bytes.
- Case officers/data admins with access may create views. Creators with current case access and scoped data admins may revoke; other roles may open only within existing read scope. Keep synthetic demo exploration available without real writes.
- Distinguish a saved browse configuration from reproducible retained imagery. External live imagery may change; preserve its request/source metadata and show that limitation. Do not promise byte-identical reopening without verified retained bytes.
- Save and revoke through existing locking, audit helpers, and persistence. Read logging follows accountable artifact access conventions. Recheck after case transfer/revocation; enforce `private, no-store` on sensitive view/manifest responses and clear client state on auth failure.
- Add a versioned snapshot migration with old-snapshot fixtures and integrity verification. The exact new version is selected against the implementation baseline. Back up saved state before deployment; an older app may refuse the new format, so rollback must preserve new records and use a validated compatible reader or an explicitly approved restore.

**Acceptance:** Same view after restart; frozen dates/settings and hashes; missing/non-retained/unrelated scenes; changed capture relationship; expired auth; current-scope and transfer checks; revoked view; viewer write denial; duplicate submission handling; durable audit entries; failed persistence; older schema migration; tamper and unknown-version rejection. No unscoped scene lookup can authorize access.

**Exit:** A saved link reproducibly restores the authorized configuration and either verifies retained content or clearly explains why reproduction is unavailable.

## Increment 4 — source-linked review manifests

**User journey:** From a saved review, download its JSON manifest and include the same imagery section in the existing printable draft packet.

**Files:** Add `backend/src/mapencroach/imagery/review_manifest.py` and `web/src/components/ImageryReviewManifest.tsx`; extend the review-view router, web API/types, `EvidencePacketDocument.tsx`, and `web/src/app/cases/[id]/evidence-packet/page.tsx`. Keep `EvidenceManifest.tsx`'s case-event artifact list intact; do not stuff structured imagery into artifact strings.

- Use one versioned server-built manifest for JSON and print: saved-view identity, generated time in UTC, viewport/CRS, layers/settings, source/product IDs, observation dates or intervals, quality scope, attribution/license, registered scene IDs/hashes, retention/read verification, and limitations.
- Resolve metadata and permissions server-side. Never claim retention or hash verification from a client-supplied field. Preserve authoritative identifiers separately from external browse URLs.
- Render only validated public source links; omit credentials, signed query strings, and internal storage paths. Unknown provenance stays visible. A JSON manifest remains useful when cross-origin imagery cannot be embedded or redistribution permission is unknown.
- Keep draft, unsigned, uncertified, and planning-context wording in the output. Saving/exporting does not advance a case, serve a notice, or attach an approved legal artifact.
- Log manifest access/export through existing audit helpers. Captured bytes, rendered previews, and document hashes have different labels.

**Acceptance:** JSON and print use identical scene identities, hashes, and dates; authorization is repeated at export time; omissions/errors stay visible; revoked/transferred views cannot bypass access; hostile URLs do not become active links; long IDs and source text fit printed pages; source hash differs from any generated-file hash; legal-state wording persists.

**Exit:** Another reviewer can trace each displayed observation to recorded provenance without mistaking the manifest for certification.

## Validation and review gates

For every increment: demonstrate a failing behavior test first, implement the smallest change, run the relevant suite, and obtain Luna review against target main. Codex independently checks the findings and final diff. Surface unresolved agent disagreements to the human.

| Area | Checks before closing an implementation increment |
| --- | --- |
| Web | `npm test`, `npm run lint`, `npx tsc --noEmit`, `npm run build`, `npm run test:browser` from `web/`. Reuse the existing Playwright/axe harness and fixtures. |
| Backend when changed | `.venv/bin/python -m pytest -q` and the installed Ruff check from `backend/`; include auth, imagery, persistence, and audit regressions relevant to that increment. |
| Dependencies/release | Existing required CI jobs, `npm audit --audit-level=high`, `pip-audit --skip-editable`, and `git diff --check`; review any network/install step in the implementation gate. Do not modify credentials/settings as part of this plan. |
| Live acceptance | Separately record an approved public-GIBS smoke check over a demo area. Google and Copernicus checks require their configured authorized access. Fixture/unit/browser results do not establish live-provider or real-device behavior. |
| Review | Explicit file staging and commit only on request; required CI green and human merge approval. Append `agents-build-log.md` for each round. |

Implementation is complete only when the intended officer journey for that increment passes, including failure and recovery states. Do not expand testing into unrelated work after the relevant gates pass.

Planning review: Luna reviewed the baseline contracts and this proposal; Codex checked the findings against source. The final acceptance list incorporates the review's date-verification and contextual-comparison clarifications. No unresolved reviewer disagreement remains. This planning review does not authorize implementation or establish runtime correctness.

## Initial implementation approval gate

The supplied AGENTS.md instructions require the following gate before code/configuration edits. This initial gate covers **increment 1 only**; later increments receive their own concrete file-level gate.

## Plan

1. [File: `web/src/lib/imagery-view.ts`, `latest-imagery.ts`, `components/HistoricalImageryTimeline.tsx`, new timeline/source-detail components] — add selectable A/B dates, bounded request handling, and truthful preview/quality states on an isolated branch based on revalidated main.
2. [File: `backend/src/mapencroach/imagery/view.py`, `api/app.py`, web API/types/fixtures and weekly/case components] — expose parent-scoped recorded scene details and connect timeline selection without capture side effects.
3. [File: adjacent existing/new tests and `web/scripts/demo-smoke.mjs`] — run the baseline, then red-first date/state/auth/metadata tests before implementation; run the relevant full gates afterward. Read-only remote baseline/provider checks and existing dependency-audit requests are included; no provider credential changes or paid imagery requests.

## Tests

- [ ] Date selection/swap, single-date range, UTC/year boundaries, and stale-response handling.
- [ ] Preview versus quality, empty search versus provider error, observation versus attempt time, and missing/retained/corrupt imagery states.
- [ ] Parent-resource authorization, transferred cases, synthetic demo behavior, and no browsing-induced capture/backfill.
- [ ] Desktop/mobile keyboard comparison, responsive layout, and existing offline browser/accessibility checks.
- [ ] Relevant web/backend tests, lint/types/build, dependency audits, independent review, and clean whitespace diff.

## Risk

- Principal risks: falsely precise dates, overstated parcel coverage, stale image responses, and cross-scope metadata access. The acceptance cases above are the controls.
- Preserve the existing dirty checkout and branch. Increment 1 is additive and requires no state migration; retain the prior build as the rollback artifact. No deletion, reset, force push, settings/credential edits, notice service, or deployment is included.
- Public source requests disclose their requested map area; use the existing approved demo extent for live verification. Do not send private case details to external services.

Waiting for human GO or reviewer feedback before proceeding.

## Primary references

- [Worldview repository and architecture](https://github.com/nasa-gibs/worldview)
- [Worldview comparison, timeline, and saved URL state](https://github.com/nasa-gibs/worldview/blob/main/doc/url_parameters.md)
- [Worldview layer configuration](https://github.com/nasa-gibs/worldview/blob/main/doc/config/layers.md)
- [GIBS service/time behavior, including DescribeDomains and nearest time](https://nasa-gibs.github.io/gibs-api-docs/access-basics/#time-dimension)
- [Worldview source-data handoffs](https://github.com/nasa-gibs/worldview/blob/main/doc/smart_handoffs.md)
- [NASA-1.3 license](https://github.com/nasa-gibs/worldview/blob/main/LICENSE.md): copying code introduces source/distribution/modification obligations. This proposal uses independently implemented interaction patterns; review license compatibility before any future direct code reuse.
