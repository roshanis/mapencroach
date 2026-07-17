# mapencroach — 5-Minute Demo Script

Working software on **seeded demo data** (30 parcels across six taluks of the Haridwar–Roorkee Development Authority, 10 alerts, 5 cases).
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

Sanity check: open http://localhost:3000/console — the map should show parcels and colored
alert markers, with the primary nav bar (Command map / Alerts / Cases) up top and the
"What am I looking at?" intro panel top right. If the map is empty, the token is
missing or expired: re-mint it and restart `npm run dev`.

Close other tabs, hide bookmarks bar, zoom browser to 110%.

---

## The script (4 stops, ~1 minute each)

### Stop 1 — Command map (`/console`)

> "This is the government estate of the Haridwar–Roorkee Development Authority —
> canal land along the Upper Ganga Canal, Rajaji forest fringe, SIDCUL industrial
> plots, municipal land — each parcel colored by category (legend, bottom-left),
> drawn over Google satellite imagery. The colored dots are alerts: places where imagery
> says something changed on government land. Red means act now."

The KPI strip (top) gives the executive summary at a glance: parcels monitored,
alerts needing triage, urgent alerts, and cases in due process. Point at the legend,
then the red marker. Click an alert in the work queue or on the map to select it,
then use the action card to open its parcel record. The
satellite/streets toggle is top-left if anyone asks for context. If Google is
unavailable, the console states that it has switched to the MapLibre fallback.

### Stop 2 — Alert queue (`/alerts`)

> "Officers don't watch a map all day — they work a queue, sorted by severity."

Filter **Tier → red**. Point at the severity score (60).

> "Severity isn't a guess. It's computed: how big the change is, what kind of land —
> a waterbody scores highest — and how much we trust the parcel boundary."

Click the parcel link in the red row — it opens the parcel record.

### Stop 3 — Parcel profile (`/parcels/parcel-1`, then `/parcels/parcel-3`)

On parcel-1 (canal land):

> "Waterbody, Grade A boundary — DGPS-verified, enforcement can rely on it. That's
> why this alert is red: high-value land, trustworthy boundary, big change."

Use the **Imagery Timeline** to switch between the verified 1990 and 2000
Landsat annual mosaics and the 2010 MODIS observation. The 1985 tab deliberately
shows a coverage gap rather than inventing a scene.

> "These historical maps give the officer visual planning context and retain their
> NASA source, capture date, and resolution. They are not enforcement evidence —
> the cadastral record, survey, and field inspection still control the finding."

Point at the **Tags** section — parcel-1 comes seeded with `court-monitored`. Add one
live (`repeat-offender`): tags are how officers layer their institutional knowledge
onto the record, and every add/remove lands in the audit chain with their identity.

Go back to the alert queue, click the **amber** row (forest parcel, Grade C):

> "Same detection, weaker footing. Grade C — unverified: a notice cannot rely on this
> boundary; survey first. The system knows the difference between 'we detected
> something' and 'we can act on it' — that protects the department from
> wrongful-demolition litigation."

### Stop 4 — Cases (open **Cases** in the nav, then case-1)

**The strongest stop for a government audience.** The queue shows every case
grouped by where it stands — in due process, paused (a court stay and a
pending survey), and concluded — each with its step on the 11-stage chain.
Open **case-1**:

> "Every alert that survives triage becomes a case, and the case follows due process —
> the software physically cannot skip a step. This case is at Show Cause Issued. Look
> at the rail: every completed step, and under Event History, the evidence each step
> required — the inspection report, the notice document, the dispatch proof. Allowed
> Next Steps shows the only moves the law permits from here. There is no button for
> 'demolish' — the Supreme Court's November 2024 guidelines are encoded as the state
> machine."

**Now hand them the mouse.** In **Demo: test the policy guard**, pick
**Order Issued** and click **Submit blocked transition**:

> "Watch — I'm trying to jump straight to a demolition order."

The red banner shows the engine's own words: *cannot transition from
SHOW_CAUSE_ISSUED to ORDER_ISSUED*. Try "DISMISSED FALSE POSITIVE" after blanking
the evidence field — refused again, naming the missing dismissal reason.

Do refusals freely — they change nothing. Only advance the case legally (e.g.
RESPONSE WINDOW) as your finale if at all: it mutates the demo until the
free-tier API instance next restarts, which conveniently resets everything.

### Stop 5 — Who sees what (personas)

Open **Demo roles** at the right side of the header:

> "Every login is scoped to a jurisdiction and a role — and this page shows it
> before you even switch. The Vice Chairman sees all 30 parcels; the Haridwar
> enforcement officer sees 15; the Roorkee City taluk officer sees just their 5."

Click **View as** on **Enforcement Officer, Haridwar**:

> "Same system, different officer. Watch the map."

The console reloads scoped to their jurisdiction — 15 Haridwar-side parcels and
an amber "Viewing as" banner on every page; the Roorkee parcels aren't hidden,
they *don't exist* for this officer (direct URLs 404 too). Then view as
**Vice Chairman, HRDA** and try to add a tag:

> "The Vice Chairman sees everything — and can change nothing."

The tag is refused with the role message on screen. Five demo personas cover the
spread: statewide viewer, district case officer, district survey officer,
taluk-level case officer, statewide data admin. "Exit persona" in the banner
returns to the default officer.

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

Worth mentioning: 230+ backend tests at ~100% coverage; every mutation lands in a
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
