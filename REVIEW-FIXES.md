# Review fixes — 7 September 2026

Implemented in `codex/review-fixes`, based on merged PR #15 (`fbae491`).
The implementation round did not deploy or migrate existing state files.
The user subsequently authorized publishing and merging these changes.
The original checkout and its unrelated product edits were preserved.

## Implemented

| Area | Result |
|---|---|
| Map layout | Reserved toolbar, canvas, footer and selected-detail rows; compact controls; mobile summary disclosure; map canvas follows container resizing. |
| Map recovery | Initialization and tile errors have visible retries; tile retry invokes the real source API and preserves parcel overlays. |
| Demo exploration | Read-only users can select and inspect case steps while mutation submissions remain disabled. |
| Imagery truthfulness | Transport failures show service errors rather than “no clear pass”; stopped history avoids attributing every old gap to stopping; attempted coverage is distinguished from usable imagery. |
| Capture recovery | Explicit provider-error retries preserve attempt history, use the latest result for image lookup, and remain available after another failed attempt. |
| Lists and context | List clients follow reported pagination with explicit safety limits; missing selected-parcel context is fetched separately; case next steps arrive with list summaries rather than one detail fetch per row. |
| Workflow integrity | Required artifacts reject blank/nontext values; hearing dates must be real ISO calendar dates; transition audit entries retain full event detail. |
| Restart durability | Version 3 saves operational records alongside watch history, scenes and audit. A complete snapshot checksum detects in-place edits; a sidecar lock and revision check reject stale writers; failed publication makes the process unavailable until restart. |
| Release checks | Pinned Playwright and axe dependencies; offline fixture acceptance added to CI, including a real tile-retry request check and dynamic canvas-size regression. |

## Verification

- Backend: **879 tests passed**, Ruff clean.
- Web: **627 tests passed** across 65 files; ESLint, TypeScript and production build passed.
- npm and Python dependency audits: no known vulnerabilities.
- Headless Chrome: keyboard record navigation, survey search/reset, mobile focus/Escape/selection/resize, read-only alternate case steps, actual map-source retries, and decoding the backend-generated PNG passed.
- Nine routes at 390/768/1440px: no horizontal overflow or serious/critical axe WCAG A/AA findings.
- Map rows at 320/390/768/1440px: no overlap; rendered canvas fits the container, including after opening selected details without reloading.
- New regressions were observed failing before fixes, including blank artifacts, pagination truncation, retry recovery, stale persistence writers, snapshot edits, naive imagery timestamps, and dynamic canvas resizing.
- Original product-file hashes match the pre-work snapshot; `git diff --check` is clean.

External requests were blocked in Chrome. These results do not verify production authentication, live providers/map tiles, real devices, print layouts, or the new GitHub CI job running remotely.

## Remaining limits and follow-up work

This is a stronger stakeholder demo, not approval to handle real legal cases.

- The file store supports one active application writer. Stale competing writers fail rather than merge; a transactional database is still needed for multiple workers and operational scale. A failed save can discard that process's unsaved changes on restart.
- Back up existing state before upgrading to v3. Versions 1/2 never saved operational records, so their verified migration retains the boot seed for those records; older backends cannot read v3.
- Snapshot/audit hashes are unkeyed integrity checks. Detecting an attacker recomputing all hashes requires an externally trusted checkpoint.
- Artifact text/date validation does not establish that a referenced document exists, is authentic, or is legally sufficient. Retained artifact references and counsel-approved templates remain required for real workflows.
- Stay-exit/enforcement permissions, shared scene-metadata scope and transferred-case parcel access need explicit product/security policy. Existing authorization rules were preserved.
- Lists have a 10,000-record safety limit; the map remains bounded and warns about coverage. Server-side filtering, viewport loading, and complete queue search context for estates beyond the map page remain follow-up work.
- Capture reservations still use the existing in-process mechanism. A narrow pre-existing gap between releasing a completed reservation and appending results merits a dedicated concurrency regression before operational use.
- Retry is manual; automated retry/backoff and provider rate-limit handling remain future work.

## Review process

Luna reviewed independent slices. A stale persistence patch that removed newer inventory functionality was rejected and backed up; Codex rebuilt that slice additively and retained the migration/inventory tests. Final Luna integrity feedback produced additional failing tests and complete-snapshot coverage. No claim here relies solely on an agent's reported completion.
