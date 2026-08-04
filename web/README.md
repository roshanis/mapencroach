# mapencroach — Admin Web UI

Government console for monitoring land parcel encroachment alerts and
due-process cases. Built with Next.js 15 (App Router), TypeScript, Tailwind
CSS, Google Maps JavaScript API, and a MapLibre GL JS fallback.

## Pages

- `/` — Public product landing page.
- `/console` — Command map: full-height Google map with parcel boundaries
  (colored by land category) and alert markers (colored by tier), plus a
  severity-sorted alert sidebar.
- `/parcels/[id]` — Parcel profile: attributes card, mini map, historical
  imagery comparison, linked alerts and cases, and a role-gated boundary-grade
  review control.
- `/alerts` — Alert queue: filterable (tier, status), severity-sorted table.
- `/cases/[id]` — Case detail: due-process state rail, event history,
  non-authoritative notice drafting, and evidence review.
- `/cases/[id]/evidence-packet` — Print-ready case, parcel, event, and artifact
  packet with explicit legal-review and signature-readiness status.

## Getting started

Requires Node.js 20+ (developed against Node 26) and npm.

```bash
npm install
npm run dev
```

Open http://localhost:3000.

## Build

```bash
npm run build
npm run start
```

`npm run build` must pass with zero TypeScript errors before shipping.

## Tests

```bash
npm test          # runs the vitest suite once
npm run test:watch
```

Tests run in `jsdom` via Vitest + Testing Library. `MapView.tsx` dynamically
loads the configured provider client-side, so neither Google Maps nor
MapLibre requires a browser map context during builds or unit tests.

## Map provider

Set both values to use Google Maps on the command map and parcel mini-maps:

```bash
NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=your_restricted_browser_key
NEXT_PUBLIC_GOOGLE_MAP_ID=your_javascript_map_id
```

If either value is missing, or Google cannot load, the interface explicitly
falls back to the existing MapLibre satellite/street map. Restrict the browser
key by website referrer and to the Maps JavaScript API; do not commit it.

## Historical imagery

The parcel profile requests true-color historical context directly from the
public NASA Global Imagery Browse Services (GIBS) WMS. The timeline offers
Landsat WELD 30 m annual mosaics for 1990 and 2000 and a MODIS Terra 250 m
observation from 2010. Compare mode places the 1990 and 2000 scenes over the
same WMS extent, adds a drag-to-reveal control, and keeps the parcel boundary
fixed over both images. The 1985 choice is retained as an explicit
coverage gap because NASA GIBS does not return a usable scene for the demo
area and date.

Every scene identifies its source, capture date, and resolution. This imagery
is for planning context only; it must not be treated as enforcement evidence
or as a substitute for cadastral records, surveys, or field inspection.
Availability and cloud cover can vary, and the interface displays a recoverable
error state when the remote service cannot load a selected scene.

## Connecting to a real backend

By default (no environment variable set) the app serves built-in fixture
data from `src/lib/fixtures.ts` — 10 demo parcels around Bhopal (including
several lakeside waterbody parcels), 5 alerts across all tiers, and 2 cases
(one mid-chain at `SHOW_CAUSE_ISSUED`, one `CLOSED`) — so the UI works with
zero backend.

To point the app at a real REST API, set `NEXT_PUBLIC_API_URL`:

```bash
# .env.local
NEXT_PUBLIC_API_URL=https://api.example.gov.in
```

The client (`src/lib/api.ts`) then expects:

- `GET {NEXT_PUBLIC_API_URL}/parcels` — GeoJSON `FeatureCollection`; feature
  `properties`: `id`, `survey_no`, `ulpin`, `owning_department`,
  `land_category`, `boundary_grade`, `jurisdiction_id`.
- `GET {NEXT_PUBLIC_API_URL}/parcels/{id}` — a single GeoJSON `Feature` with
  the same properties.
- `PATCH {NEXT_PUBLIC_API_URL}/parcels/{id}/boundary-grade` — update the
  boundary grade with `{ grade, survey_reference }`; restricted to survey and
  data-administration roles and recorded in the audit chain.
- `GET {NEXT_PUBLIC_API_URL}/alerts` — JSON list of `{ id, parcel_id, tier,
  severity_score, area_m2, status, detected_at }`.
- `GET {NEXT_PUBLIC_API_URL}/cases` — JSON list of case summaries.
- `GET {NEXT_PUBLIC_API_URL}/cases/{id}` — `{ id, alert_id, parcel_id, state,
  events: [{ from_state, to_state, actor, occurred_at, artifacts, note }] }`.

The notice workspace is intentionally a demo-safe drafting surface. Its output
is marked `DRAFT — NOT FOR SERVICE` and does not replace an approved legal
template, authoritative evidence, legal review, or an authorized signature.
Evidence packets are print-ready review artifacts, not digitally signed or
legally certified records.

An optional `bbox` query parameter (`west,south,east,north`) is appended to
the `/parcels` request when a bounding box is supplied to `getParcels(bbox)`.

## Project layout

```
web/
  src/
    app/
      page.tsx                 Public landing page
      console/page.tsx         Command map
      parcels/[id]/page.tsx    Parcel profile
      alerts/page.tsx          Alert queue
      cases/[id]/page.tsx      Case detail
      cases/[id]/
        evidence-packet/       Print-ready evidence packet
    components/                Shared UI (TierChip, BoundaryGradeBadge,
                                BoundaryGradeEditor, EvidencePacketDocument,
                                NoticeDraftWorkspace, maps, etc.)
    lib/
      api.ts                   Typed data client (REST or fixtures)
      fixtures.ts               Built-in demo data
      types.ts                  Domain types
      format.ts                 Formatting/sorting helpers
```
