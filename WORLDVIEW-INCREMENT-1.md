# Worldview increment 1 — implementation handoff

Historical handoff from the first implementation round. The user subsequently
authorized parcel cloud checks, dependency remediation, and merge. Current
verification and release status are in [CLEAR-IMAGERY-RELEASE.md](CLEAR-IMAGERY-RELEASE.md);
the earlier security-gate findings below are retained as dated review history.

Implemented for review on 2026-09-08 (America/Chicago), after the user's GO.
Branch: `codex/worldview-imagery`; base: freshly fetched `origin/main` at
`5de1e288ec98cad335ac25f038914607c5b1a785`.
Worktree: `/private/tmp/mapencroach-worldview-imagery`.

Functional acceptance passes. The release security gate remains blocked by
advisories in unchanged npm dependencies. No commit, push, merge, or deployment
was performed. Increments 2–4 remain proposals in `WORLDVIEW-ADOPTION-PLAN.md`.

## Delivered behavior

- Parcel browsing has independent A/B windows, swapping, a keyboard slider,
  and a compact availability timeline with native select alternatives.
- Requests are limited to the active single view or pair. Identical requested
  dates render once and disable comparison. Superseded callbacks are ignored;
  failed reloads remain visible and retryable. Blank searches stay within their
  selected windows; provider errors do not masquerade as empty coverage.
- Source details distinguish requested browse dates from unverified acquisition
  times. Pixel blankness does not certify cloud conditions or parcel coverage.
  Comparison uses the same product and requested extent, with explicit limits
  on source alignment and parcel-level change claims.
- Case/watch histories offer week selection and recorded source details without
  starting captures or backfills. Provider observation time and capture-attempt
  time are separate UTC fields; fixtures are explicitly synthetic.
- Existing authorized capture responses expose a derived `scene_details` object.
  Missing registry data and mismatched hashes stay explicit. Raw STAC items and
  asset URLs are omitted, and source text is constrained to a provider label.
  Image endpoints reject missing/mismatched capture hashes with HTTP 409.
- Metadata projection is resolved through the current watch/case parent. Added
  transfer coverage verifies incoming case access separately from watch scope.
  The existing persistence format and capture records are unchanged.

Implementation is independent code inspired by Worldview interactions. No NASA
source code or new dependency was copied into the application.

## Verification

| Check | Result |
| --- | --- |
| Baseline | 627 web tests and 879 backend tests passed before implementation |
| Final web suite | 645 tests across 68 files passed |
| Final backend suite | 894 tests passed; 27 existing warning instances |
| Web quality/build | ESLint, TypeScript and production build passed |
| Backend quality | Ruff passed |
| Offline Chrome | Existing nine-route checks passed at 390/768/1440px; map layout at 320/390/768/1440px |
| New browser journeys | One active initial image request, A/B selection/swap, keyboard slider, side-specific failure/retry, and separate case timestamps passed |
| Accessibility/layout | No serious/critical axe findings in tested routes and new imagery controls; no tested horizontal overflow; mobile/desktop screenshots inspected |
| Python advisory audit | No known vulnerabilities reported; editable project skipped |
| npm advisory audit | Failed: 6 findings, comprising 2 moderate, 2 high and 2 critical |
| Diff/preservation | Whitespace and smoke-script syntax checks passed; 11 protected original-checkout file hashes unchanged |

Red-first evidence covers absent A/B behaviors, metadata projection, hash
rejection, missing/inconsistent metadata, source-label URL leakage, request
identity stability, and failed reloads. The final same-date test was also rerun
after simplifying its fixture setup; all six component tests passed.

Evidence logs are under `/private/tmp/worldview-*`, including
`worldview-web-final.log`, `worldview-backend-final.log`,
`worldview-build-final.log`, `worldview-browser3.log`,
`worldview-npm-audit.log`, and `worldview-pip-audit.log`.
Visual evidence: `worldview-imagery-mobile.png` and
`worldview-imagery-desktop.png`; imagery in these screenshots is mocked and
visibly marked DEMO.

The separate public NASA GIBS check requested only the existing Haridwar demo
extent, using `TIME=2026-09-07`. It returned HTTP 200 and a 960×540 PNG, 2,090
bytes, with all alpha values zero. This establishes a reachable service and a
blank response, not a usable observation or an acquisition date. Google,
Copernicus, private data, real devices, and operational deployment were not
validated by the fixture browser run.

## Release findings and follow-up scope

The dependency manifests and web lockfile match `origin/main` byte for byte.
Current npm findings therefore apply to the existing dependency set:

- Critical: `maplibre-gl` and `next`.
- High: `js-yaml` and `sharp`.
- Moderate: `@vitest/mocker` and its dependent `vitest`.

Use the audit log's advisory links to plan a separate dependency remediation.
Some offered updates cross major versions; no automatic audit fix was applied.
The required audit gate must pass before a release is considered ready.

Luna reviews found no remaining introduced regression. Codex checked the findings
and independently verified both existing backend issues against `origin/main`:

1. A backfill started before a case transfer can still register scenes during
   provider I/O and apply results after the transfer. The added final scope check
   prevents the new metadata response from being disclosed to the outgoing
   scope; it does not solve the existing mutation race. A separate fix needs
   reservations or staged results and concurrent transfer/backfill tests.
2. The authenticated global `GET /imagery/scenes/{scene_id}` route remains
   unscoped and can return raw STAC/asset metadata. The new capture projection
   never uses it and tests exclude those fields. Scope or retire that existing
   route separately, with cross-jurisdiction access regression tests.

These follow-ups are not part of the approved increment 1 implementation.
Registered-scene swipe comparison remains deferred until spatial alignment
metadata is verified in increment 2.

## Local review and rollback

The original checkout and its unrelated dirty provider/persistence work are
unchanged. This implementation is entirely uncommitted on the isolated branch.
Review all modified and new source/tests plus this handoff and the plan; stage
specific files only when a commit is requested.

No dependency installation or configuration change was needed. Local runtime
links reuse existing test dependencies: `web/node_modules` and `backend/.venv`.
The backend `.venv` symlink appears untracked and is a local test aid, not a
deliverable; do not stage it. Backend checks used `PYTHONPATH=src` to ensure the
worktree's source was tested. No secrets or `.env` files were copied.

There is no state migration. Rollback of a future authorized deployment can use
the prior application build; retain existing operational data and audit history.
