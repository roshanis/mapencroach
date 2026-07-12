# mapencroach — 5-Minute Demo Script

Working software on **seeded demo data** (8 parcels across the Haridwar–Roorkee Development Authority area, 4 alerts, 2 cases).
Say that up front — it builds trust, and the workflow you're showing is fully real.

---

## Pre-demo checklist (10 minutes before)

```bash
# 1. Start the API with demo seed (from backend/)
MAPENCROACH_DEMO=1 .venv/bin/uvicorn "mapencroach.api.app:create_app" --factory

# 2. Mint an officer token (from backend/, second terminal)
.venv/bin/python -c "
from datetime import datetime, timedelta, UTC
from mapencroach.api.auth import create_token
print(create_token('officer-1', 'case_officer', 'state', 'dev-secret-do-not-deploy', datetime.now(UTC)+timedelta(hours=8)))"

# 3. Start the console (from web/, third terminal)
NEXT_PUBLIC_API_URL=http://localhost:8000 NEXT_PUBLIC_API_TOKEN=<token> npm run dev
```

Sanity check: open http://localhost:3000 — the map should show parcels and colored
alert markers. If the map is empty, the token is missing or expired: re-mint it and
restart `npm run dev`.

Close other tabs, hide bookmarks bar, zoom browser to 110%.

---

## The script (4 stops, ~1 minute each)

### Stop 1 — Command map (`/`)

> "This is the government estate of the Haridwar–Roorkee Development Authority —
> canal land along the Upper Ganga Canal, Rajaji forest fringe, SIDCUL industrial
> plots, municipal land — each parcel colored by category (legend, bottom-left),
> drawn over satellite imagery. The colored dots are alerts: places where imagery
> says something changed on government land. Red means act now."

The KPI strip (top) gives the executive summary at a glance: parcels monitored,
open alerts, red alerts, cases in due process. Point at the legend, then the red
marker. Click an alert in the left sidebar to show the map fly to it. The
satellite/streets toggle is top-left if anyone asks for context.

### Stop 2 — Alert queue (`/alerts`)

> "Officers don't watch a map all day — they work a queue, sorted by severity."

Filter **Tier → red**. Point at the severity score (60).

> "Severity isn't a guess. It's computed: how big the change is, what kind of land —
> a waterbody scores highest — and how much we trust the parcel boundary."

Click the red row — it opens the parcel.

### Stop 3 — Parcel profile (`/parcels/parcel-1`, then `/parcels/parcel-3`)

On parcel-1 (canal land):

> "Waterbody, Grade A boundary — DGPS-verified, enforcement can rely on it. That's
> why this alert is red: high-value land, trustworthy boundary, big change."

Go back to the alert queue, click the **amber** row (forest parcel, Grade C):

> "Same detection, weaker footing. Grade C — unverified: a notice cannot rely on this
> boundary; survey first. The system knows the difference between 'we detected
> something' and 'we can act on it' — that protects the department from
> wrongful-demolition litigation."

### Stop 4 — Case detail (open parcel-1 → click **case-1**)

**The strongest stop for a government audience.**

> "Every alert that survives triage becomes a case, and the case follows due process —
> the software physically cannot skip a step. This case is at Show Cause Issued. Look
> at the rail: every completed step, and under Event History, the evidence each step
> required — the inspection report, the notice document, the dispatch proof. Allowed
> Next Steps shows the only moves the law permits from here. There is no button for
> 'demolish' — the Supreme Court's November 2024 guidelines are encoded as the state
> machine."

**Now hand them the mouse.** In the transition panel, pick
"ORDER ISSUED — will be refused" and click **Attempt transition**:

> "Watch — I'm trying to jump straight to a demolition order."

The red banner shows the engine's own words: *cannot transition from
SHOW_CAUSE_ISSUED to ORDER_ISSUED*. Try "DISMISSED FALSE POSITIVE" after blanking
the evidence field — refused again, naming the missing dismissal reason.

Do refusals freely — they change nothing. Only advance the case legally (e.g.
RESPONSE WINDOW) as your finale if at all: it mutates the demo until the
free-tier API instance next restarts, which conveniently resets everything.

---

## Technical encore (60 seconds, only for a technical audience)

The refusals from Stop 4 are also demonstrable at the raw API level — same
engine, no UI in between:

```bash
# Skip straight to a demolition order → refused
curl -s -X POST http://localhost:8000/cases/case-1/transitions \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"to_state":"ORDER_ISSUED"}'
# → 409 "cannot transition from SHOW_CAUSE_ISSUED to ORDER_ISSUED"

# Dismiss a case without stating why → refused
curl -s -X POST http://localhost:8000/cases/case-1/transitions \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"to_state":"DISMISSED_FALSE_POSITIVE"}'
# → 409 "missing required artifact(s): dismissal_reason"
```

Worth mentioning: 200 backend tests at ~100% coverage; every mutation lands in a
tamper-evident hash-chained audit log (any edit to history is detectable — built for
evidence-integrity requirements under BSA 2023 §63); role-based access with
jurisdiction scoping — an officer literally cannot see, or even confirm the existence
of, parcels outside their jurisdiction.

---

## Be upfront about what's not in yet

| Not yet | Status |
|---------|--------|
| Real cadastral records | Ingestion + topology QA built and tested; needs the department's parcel files |
| Live satellite change detection | Pipeline plumbing (scene registry, hashing, tiles) built; Sentinel-2 fetch needs free Copernicus credentials |
| Persistent database | Demo runs in-memory; PostGIS models are written and ready |

Framing that works: *"Everything you just clicked is real, tested software. What's
seeded today is demo data — the next step is your data."*

## Likely questions

- **"What imagery, and what does it cost?"** — Sentinel-2: free, 10 m resolution, revisit
  every ~5 days. Good enough to flag *probable change*; officers verify on the ground.
- **"Can it be wrong?"** — Yes, and the design assumes it: detections are alerts, not
  accusations. Nothing legal happens without an inspection report by a human officer.
- **"What about old encroachments?"** — The legacy tier. Pre-existing occupation is
  routed to a separate track (LEGACY_REFERRED), never auto-escalated.
- **"Who can see what?"** — Seven roles, jurisdiction-scoped. A taluk officer sees
  their taluk. Every action is in the audit chain with the actor's identity.
