# Agent Guide — mapencroach

Satellite encroachment monitoring for Indian state governments. Product plan in `PLAN.md`, demo script in `DEMO.md`, deploy notes in `DEPLOY.md`. This file is the shared contract for all coding agents (Codex, Claude, others).

## Build & test

| Area | Commands (run from the area's directory) |
|------|------------------------------------------|
| `backend/` | `.venv/bin/python -m pytest -q` · `ruff check .` · `pip-audit --skip-editable` |
| `web/` | `npm run test` · `npm run lint` · `npx tsc --noEmit` |

CI (`.github/workflows/ci.yml`) runs both suites, lint/type checks, and dependency audits on every PR. Nothing merges to `main` with a red gate.

## Working agreements

- **TDD is mandatory** — red test first, minimal fix, full suite green. Docs/config-only changes need lint/format validation instead.
- **Log every session** in `agents-build-log.md`: `## [AGENT: name] [ISO timestamp]` with Action / Files changed / Diff summary / Recommendations. Read entries added since your last one before starting work.
- **Branches**: agents work on their own branches (`codex-*`, `claude-*`), never directly on `main`. Reviewer diffs `main...HEAD` before any merge. Commit only when asked; stage files explicitly.
- **Disagreements between agents** are surfaced to the human with both positions, not resolved unilaterally.

## Local dev gotchas

- Backend must be reached at `127.0.0.1:8000`, **not** `localhost:8000` — a `kuzu-explorer` Docker container on this machine owns `::1:8000`. Do not stop that container.
- Demo tokens (`DEMO.md` pre-flight) expire after 8 hours; a sudden 401 from a working backend means re-mint and restart the web dev server (the token is baked in via `NEXT_PUBLIC_API_TOKEN`).
- Demo seed (`MAPENCROACH_DEMO=1`) generates timestamps relative to boot time; restart the backend to refresh them.
- Outside demo mode the API refuses to boot without a real `MAPENCROACH_JWT_SECRET` (blank/whitespace values count as unset).

## Product guardrails

- Screening signals are context, not evidence: nothing in the UI or API may present detections, notice drafts, or evidence packets as legally authoritative. Notice output stays watermarked `DRAFT — NOT FOR SERVICE` until counsel-approved templates exist.
- Every case mutation must go through the case engine's transition rules; never bypass required artifacts.
- The audit chain is tamper-evident; all mutations must be recorded through the existing audit helpers.
