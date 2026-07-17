# mapencroach — Admin Web UI

Government console for monitoring land parcel encroachment alerts and
due-process cases. Built with Next.js 15 (App Router), TypeScript, Tailwind
CSS, Google Maps JavaScript API, and a MapLibre GL JS fallback.

## Pages

- `/` — Public product landing page.
- `/console` — Command map: full-height Google map with parcel boundaries
  (colored by land category) and alert markers (colored by tier), plus a
  severity-sorted alert sidebar.
- `/parcels/[id]` — Parcel profile: attributes card, mini map, imagery
  timeline placeholder, linked alerts and cases.
- `/alerts` — Alert queue: filterable (tier, status), severity-sorted table.
- `/cases/[id]` — Case detail: due-process state rail, event history,
  evidence packet placeholder.

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
- `GET {NEXT_PUBLIC_API_URL}/alerts` — JSON list of `{ id, parcel_id, tier,
  severity_score, area_m2, status, detected_at }`.
- `GET {NEXT_PUBLIC_API_URL}/cases` — JSON list of case summaries.
- `GET {NEXT_PUBLIC_API_URL}/cases/{id}` — `{ id, alert_id, parcel_id, state,
  events: [{ from_state, to_state, actor, occurred_at, artifacts, note }] }`.

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
    components/                Shared UI (TierChip, BoundaryGradeBadge,
                                StateRail, GoogleMap, MapLibreMap, MapView, etc.)
    lib/
      api.ts                   Typed data client (REST or fixtures)
      fixtures.ts               Built-in demo data
      types.ts                  Domain types
      format.ts                 Formatting/sorting helpers
```
