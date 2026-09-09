# Parcel cloud checks and imagery review — release notes

Prepared 2026-09-09 for the user-requested change and merge. The isolated branch
`codex/worldview-imagery` is based on refreshed main `5de1e28`. The original dirty
checkout, including its unrelated provider/persistence work, remains unchanged.
Publication and merge proceed only after required PR checks pass.

## User-visible change

Parcel profiles now default to **Latest clear view**. The service checks recent
Sentinel-2 scenes newest first and displays a parcel crop only when every touched
20 m SCL pixel is classified vegetation, bare soil, or water. It rejects clouds,
cloud shadows, cirrus, uncertain classes, invalid pixels, and incomplete parcel
coverage. It reads all native colour pixels for validity before downsampling.
The PNG and provider acquisition time come from the same exact scene.

No clear result, incomplete search, service failure, timeout, authorization
failure, and preview decoding failure have separate handling. Skipped candidates
and search limits remain visible. This rule does not guarantee perfect cloud
detection, certify cadastral alignment, or establish encroachment.

GIBS monthly imagery is now opt-in under **Browse imagery without cloud checks**.
The prior Worldview increment is included: independent A/B dates, swap, keyboard
comparison, bounded requests, source details, and weekly capture navigation.
Registered metadata stays parent-scoped, and image routes reject missing or
mismatched capture hashes. No saved-view persistence or scene migration was added.

## Data and request boundaries

- `GET /parcels/{id}/clear-imagery` is an authenticated read, returning metadata
  and a bounded inline PNG with `Cache-Control: private, no-store`.
- Every response rechecks current parcel access and exact geometry after I/O.
  Searches do not alter watches, cases, scene registrations, or persisted state.
- Search bounds: newest 24 catalog candidates within 90 days, a 35-second work
  budget checked between operations, 4-second HTTP timeouts, 64 MiB range-byte
  budget, 160 HTTP requests, one active search per user and two per API process.
  These are process-local limits, not a distributed deployment quota.
- Raster windows are capped at one million pixels; output is at most 768 pixels
  per edge and 3 MB PNG. HTTP timeout/decoder overhead can outlast the work budget;
  the client stops waiting after 45 seconds. Disconnects do not instantly cancel
  synchronous backend work, which remains bounded by its own limits.
- Only exact scene-derived SCL/TCI paths on the approved public Sentinel COG host
  are accepted. HTTPX handles bounded range reads through a custom Rasterio
  opener; GDAL never receives a remote URL. Redirects, wrong content types,
  inconsistent ranges and changed ETags are rejected; no credentials are used.
- The existing configurable STAC catalog URL remains trusted server configuration.
  Raw catalog/asset URLs are not returned by the new endpoint.
- Fixture-only mode reports service unavailability; successful browser fixtures
  are explicitly synthetic. The UI never substitutes a demo image for a live
  clear-view result.

## Validation and review

Red-first tests cover cloud/shadow/nodata rejection, partial footprints, holes,
multipolygons, scene ordering, request limits, exact source/date matching, corrupt
range responses, hidden native nodata during downsampling, scope/geometry changes,
concurrent searches, and UI failures/retries/stale results. Real small GeoTIFF
fixtures exercise the custom GDAL opener and PNG rendering without network calls.

Local gates passed: 650 web tests, 929 backend tests with 98.31% coverage, ESLint,
TypeScript, Ruff, production build, and offline Chrome acceptance. Both npm and Python audits report no
known vulnerabilities. The editable application is skipped by the Python audit.

Browser checks cover nine routes at 390/768/1440px, map layout down to 320px,
keyboard/focus/retry journeys, actual canvas resizing, the new clear-view flow,
opt-in A/B imagery and weekly source details. No serious/critical axe violations
or tested horizontal overflow were found. The mobile clear-view screenshot was
visually inspected. These checks use synthetic fixtures, not live map services.

Luna independently reviewed frontend behavior, the dependency migration, backend
authorization and raster-reading boundaries. Codex checked the findings and
closed the native-colour validity, MIME, and PNG-size items. No introduced
review disagreement remains.

Separate live evidence: a public request for seeded demo `parcel-9` inspected
five scenes in approximately 6.1 seconds and selected
`S2B_43RGP_20260826_0_L2A`, observed `2026-08-26T05:40:31.302Z`.
All 42 touched SCL pixels passed; the native colour crop was 11×13 pixels.
This demonstrates one functioning public scene/mask path, not universal coverage,
production availability, or building-level evidence.

Evidence logs/artifacts are local under `/private/tmp/worldview-clear-*`,
including `live.json`, `live.png`, `mobile.png`, `web-final.log`,
`backend-merge.log`, `browser2.log`, `npm-audit.log`, and `pip-audit-final.log`.

## Dependency changes and existing follow-ups

The release audit blockers were resolved through normal dependency updates:
Next 15.5.25, MapLibre 6.9.0, Vitest 4.1.11, sharp 0.35.4, and js-yaml 4.3.2
in the lockfile. MapLibre uses its v6 namespace export; its WebGL2 requirement
means real target-device compatibility still needs deployment validation.
Vitest mock cleanup/types were adjusted while retaining behavioral assertions.
Rasterio is added for native mask/colour reads. CI updates pip to at least 26.2.1
before installation so its installer also meets the advisory gate.

Two pre-existing backend issues remain separate follow-ups: capture/backfill can
race a case transfer during provider I/O, and the global authenticated scene-ID
metadata route remains unscoped. The new endpoint does not delegate to either
path or widen their behavior. These limits prevent treating this work as a
complete operational security certification.

No production deployment, credential/settings change, paid imagery request, or
real case operation is included. Test dependencies were installed into new
temporary environments; the existing runtime targets were preserved. The local
`backend/.venv` symlink is a test aid and is excluded from the commit.

## Sources

- [Sentinel-2 L2A classification and tile-cloud limitations](https://documentation.dataspace.copernicus.eu/APIs/SentinelHub/Data/S2L2A.html)
- [Earth Search Sentinel COG collections](https://github.com/Element84/earth-search/blob/main/README.md)
- [Rasterio custom filesystem openers](https://rasterio.readthedocs.io/en/stable/topics/vsi.html)
- [MapLibre v6 migration](https://maplibre.org/maplibre-gl-js/docs/guides/v5-to-v6-migration-guide/)
