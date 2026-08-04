// Typed data-access layer for the admin console.
//
// When NEXT_PUBLIC_API_URL is set, all functions fetch from the REST backend.
// Otherwise they fall back to the built-in fixtures so the UI can be demoed
// with zero backend.

import { readCookie } from "./cookies";
import {
  CASE_IMAGERY_BACKFILL_FLOOR,
  FIXTURE_ALERTS,
  FIXTURE_CASES,
  FIXTURE_CASE_IMAGERY,
  FIXTURE_PARCELS,
  FIXTURE_PARCEL_CONTEXTS,
  FIXTURE_WATCH_ENTRIES,
} from "./fixtures";
import type {
  Alert,
  BBox,
  Case,
  CaseEvent,
  CaseImagery,
  CaptureAttempt,
  LandCategory,
  BoundaryGrade,
  Parcel,
  ParcelContext,
  WatchEntry,
} from "./types";

export const TOKEN_COOKIE = "mapencroach_token";
export const PERSONA_COOKIE = "mapencroach_persona";

// NEXT_PUBLIC_* env vars are inlined into the client bundle at build time —
// anything read from one is visible to every visitor. NEXT_PUBLIC_API_TOKEN
// used to be used as a Bearer fallback for both reads and writes, which meant
// any visitor could extract it and act as an authenticated user (including
// mutating case state and tags). It is no longer read for authentication;
// warn once if it is still configured so a misconfigured deployment is
// obvious instead of silently insecure.
if (process.env.NEXT_PUBLIC_API_TOKEN) {
  console.warn(
    "NEXT_PUBLIC_API_TOKEN is set but is ignored: it would be bundled into " +
      "client-side JavaScript and readable by any visitor. Remove it. " +
      "Server-side requests should use the MAPENCROACH_API_TOKEN " +
      "environment variable (see src/lib/server-api.ts); client-side " +
      "requests authenticate with the mapencroach_token session cookie."
  );
}

function getApiBase(): string | undefined {
  const base = process.env.NEXT_PUBLIC_API_URL;
  return base && base.length > 0 ? base.replace(/\/$/, "") : undefined;
}

interface ParcelFeatureProperties {
  id: string;
  survey_no: string;
  ulpin: string;
  owning_department: string;
  land_category: LandCategory;
  boundary_grade: BoundaryGrade;
  jurisdiction_id: string;
  jurisdiction_name?: string;
  tags?: string[];
}

interface ParcelFeature {
  type: "Feature";
  geometry: GeoJSON.Polygon;
  properties: ParcelFeatureProperties;
}

interface ParcelFeatureCollection {
  type: "FeatureCollection";
  features: ParcelFeature[];
}

function centroidOf(geometry: GeoJSON.Polygon): [number, number] {
  const ring = geometry.coordinates[0] ?? [];
  if (ring.length === 0) return [0, 0];
  let sumLng = 0;
  let sumLat = 0;
  for (const [lng, lat] of ring) {
    sumLng += lng;
    sumLat += lat;
  }
  return [sumLng / ring.length, sumLat / ring.length];
}

function featureToParcel(feature: ParcelFeature): Parcel {
  const { properties, geometry } = feature;
  return {
    id: properties.id,
    survey_no: properties.survey_no,
    ulpin: properties.ulpin,
    owning_department: properties.owning_department,
    land_category: properties.land_category,
    boundary_grade: properties.boundary_grade,
    jurisdiction_id: properties.jurisdiction_id,
    jurisdiction_name: properties.jurisdiction_name,
    geometry,
    centroid: centroidOf(geometry),
    tags: properties.tags ?? [],
  };
}

/**
 * Backend event artifacts may arrive as a dict (e.g.
 * `{"notice_document": "notice-001.pdf"}`) or as a string[]. UI components
 * expect string[]; normalize dicts to `"key: value"` entries and pass
 * arrays through, dropping any element that isn't actually a string (a
 * malformed backend response used to be cast through unchecked, which could
 * hand a non-string into a `key={artifact}` React list downstream).
 */
function normalizeArtifacts(artifacts: unknown): string[] {
  if (Array.isArray(artifacts)) {
    return artifacts.filter((item): item is string => typeof item === "string");
  }
  if (artifacts && typeof artifacts === "object") {
    return Object.entries(artifacts as Record<string, string>).map(
      ([key, value]) => `${key}: ${value}`
    );
  }
  return [];
}

function normalizeCase(raw: Case): Case {
  // The /cases list endpoint omits events; only GET /cases/{id} includes them.
  return {
    ...raw,
    events: (raw.events ?? []).map(
      (event: CaseEvent): CaseEvent => ({
        ...event,
        artifacts: normalizeArtifacts(event.artifacts),
      })
    ),
  };
}

/**
 * Exported so components that must fetch something other than JSON through
 * this same auth (e.g. WeeklySnapshotTimeline fetching a scene image blob
 * with credentials, since a plain `<img src>` cannot carry an Authorization
 * header) can reuse the exact precedence rule below instead of duplicating
 * or drifting from it.
 */
export function authHeaders(tokenOverride?: string): HeadersInit | undefined {
  // Precedence: an explicit override (e.g. the server-only token threaded in
  // by server-api.ts) beats the browser session cookie. There is no
  // client-exposed env var fallback — see the NEXT_PUBLIC_API_TOKEN warning
  // above.
  const token = tokenOverride ?? readCookie(TOKEN_COOKIE);
  return token ? { Authorization: `Bearer ${token}` } : undefined;
}

/**
 * A failed HTTP response, carrying the status code so callers can
 * distinguish "genuinely missing" (404) from every other failure (5xx,
 * 401/403, etc). Collapsing all of these into a single "not found" made a
 * backend restart or an auth lapse render an existing record as absent.
 */
export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

async function fetchJson<T>(url: string, token?: string): Promise<T> {
  const res = await fetch(url, { headers: authHeaders(token) });
  if (!res.ok) {
    throw new ApiError(
      `Request failed: ${res.status} ${res.statusText} (${url})`,
      res.status
    );
  }
  return (await res.json()) as T;
}

export async function getParcels(bbox?: BBox, token?: string): Promise<Parcel[]> {
  const base = getApiBase();
  if (!base) {
    if (!bbox) return FIXTURE_PARCELS;
    return FIXTURE_PARCELS.filter((p) => {
      const [lng, lat] = p.centroid;
      return (
        lng >= bbox.west &&
        lng <= bbox.east &&
        lat >= bbox.south &&
        lat <= bbox.north
      );
    });
  }

  const params = bbox
    ? `?bbox=${bbox.west},${bbox.south},${bbox.east},${bbox.north}`
    : "";
  const collection = await fetchJson<ParcelFeatureCollection>(
    `${base}/parcels${params}`,
    token
  );
  return collection.features.map(featureToParcel);
}

export async function getParcel(
  id: string,
  token?: string
): Promise<Parcel | undefined> {
  const base = getApiBase();
  if (!base) {
    return FIXTURE_PARCELS.find((p) => p.id === id);
  }
  try {
    const feature = await fetchJson<ParcelFeature>(
      `${base}/parcels/${id}`,
      token
    );
    return featureToParcel(feature);
  } catch (error) {
    // Only a genuine 404 means "this parcel does not exist" — any other
    // failure (5xx, an auth lapse, a network error) must propagate so the
    // page renders the error boundary instead of a misleading "not found".
    if (error instanceof ApiError && error.status === 404) return undefined;
    throw error;
  }
}

export async function getParcelContext(
  id: string,
  token?: string
): Promise<ParcelContext | undefined> {
  const base = getApiBase();
  if (!base) {
    const fixture = FIXTURE_PARCEL_CONTEXTS[id];
    if (fixture) return fixture;
    const parcel = FIXTURE_PARCELS.find((candidate) => candidate.id === id);
    if (!parcel) return undefined;
    return {
      parcel_id: parcel.id,
      canonical_id: parcel.id,
      aliases: [
        {
          scheme: "survey_no",
          value: parcel.survey_no,
          source: "Illustrative demo parcel register",
          valid_from: null,
          valid_to: null,
          match_method: "authoritative_identifier",
          confidence: 1,
        },
        {
          scheme: "ULPIN",
          value: parcel.ulpin,
          source: "Illustrative demo parcel register",
          valid_from: null,
          valid_to: null,
          match_method: "authoritative_identifier",
          confidence: 1,
        },
      ],
      lineage: [],
      geographic_links: [],
      observations: [],
      sources: [],
      classification: "context_only",
      disclaimer:
        "Contextual signals support prioritization only. They are not enforcement evidence and do not establish parcel ownership, boundaries, or encroachment.",
    };
  }
  try {
    return await fetchJson<ParcelContext>(
      `${base}/parcels/${id}/context`,
      token
    );
  } catch (error) {
    // Only a genuine 404 means "this context does not exist" — any other
    // failure must propagate rather than read as "no context".
    if (error instanceof ApiError && error.status === 404) return undefined;
    throw error;
  }
}

// Tier/status filtering happens entirely client-side, in AlertsTable's own
// component state — it filters the full `alerts` prop it's already been
// given, independent of this function. getAlerts() used to accept an
// AlertFilters argument that filtered its return value the same way, but
// nothing ever called it with one: no caller threads real filter values in,
// so the full alert set is always fetched (and always was) either way. That
// made the parameter dead weight that looked like server-side filtering
// without doing any — removed rather than wired up, since nothing here talks
// to a backend endpoint that accepts tier/status query params to filter on.
export async function getAlerts(token?: string): Promise<Alert[]> {
  const base = getApiBase();
  if (!base) return FIXTURE_ALERTS;
  // Backend enums are uppercase (RED/OPEN); UI keys off lowercase.
  return (await fetchJson<Alert[]>(`${base}/alerts`, token)).map((a) => ({
    ...a,
    tier: a.tier.toLowerCase() as Alert["tier"],
    status: a.status.toLowerCase() as Alert["status"],
  }));
}

export async function getCases(token?: string): Promise<Case[]> {
  const base = getApiBase();
  if (!base) return FIXTURE_CASES;
  const cases = await fetchJson<Case[]>(`${base}/cases`, token);
  return cases.map(normalizeCase);
}

export async function getCase(
  id: string,
  token?: string
): Promise<Case | undefined> {
  const base = getApiBase();
  if (!base) {
    return FIXTURE_CASES.find((c) => c.id === id);
  }
  try {
    const raw = await fetchJson<Case>(`${base}/cases/${id}`, token);
    return normalizeCase(raw);
  } catch (error) {
    // Only a genuine 404 means "this case does not exist" — any other
    // failure must propagate rather than read as "no case".
    if (error instanceof ApiError && error.status === 404) return undefined;
    throw error;
  }
}

export interface TransitionResult {
  ok: boolean;
  status: number;
  detail?: string;
}

export async function transitionCase(
  caseId: string,
  toState: string,
  artifacts: Record<string, string>,
  note?: string,
  token?: string
): Promise<TransitionResult> {
  const base = getApiBase();
  if (!base) {
    return {
      ok: false,
      status: 0,
      detail: "No backend configured — fixture mode is read-only.",
    };
  }

  const res = await fetch(`${base}/cases/${caseId}/transitions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(token),
    },
    body: JSON.stringify({ to_state: toState, artifacts, note }),
  });

  if (res.ok) {
    return { ok: true, status: res.status };
  }

  let detail: string = res.statusText;
  try {
    const body = (await res.json()) as { detail?: string };
    if (typeof body?.detail === "string") {
      detail = body.detail;
    }
  } catch {
    // fall back to statusText
  }

  return { ok: false, status: res.status, detail };
}

export interface Persona {
  id: string;
  name: string;
  role: string;
  jurisdiction_id: string;
  jurisdiction_name?: string;
  description: string;
  visible_parcels?: number;
  capabilities?: string[];
}

/**
 * Lists demo personas. Only present when the backend runs in demo mode
 * (404 otherwise); never throws — callers get [] for any failure so
 * non-demo deployments render nothing.
 */
export async function getPersonas(): Promise<Persona[]> {
  const base = getApiBase();
  if (!base) return [];
  try {
    const res = await fetch(`${base}/demo/personas`);
    if (!res.ok) return [];
    return (await res.json()) as Persona[];
  } catch {
    return [];
  }
}

/**
 * Logs in as a demo persona. Never throws — null on no-backend or any
 * failure (e.g. 404 unknown persona).
 */
export async function loginPersona(
  personaId: string
): Promise<{ token: string; persona: Persona } | null> {
  const base = getApiBase();
  if (!base) return null;
  try {
    const res = await fetch(`${base}/demo/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ persona_id: personaId }),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as {
      token: string;
      persona: Persona;
      expires_in_hours: number;
    };
    return { token: body.token, persona: body.persona };
  } catch {
    return null;
  }
}

export interface TagResult {
  ok: boolean;
  status: number;
  detail?: string;
  tags?: string[];
}

async function tagRequest(
  url: string,
  method: "POST" | "DELETE",
  body: Record<string, unknown> | undefined,
  token?: string
): Promise<TagResult> {
  const base = getApiBase();
  if (!base) {
    return {
      ok: false,
      status: 0,
      detail: "No backend configured — fixture mode is read-only.",
    };
  }

  try {
    const res = await fetch(url, {
      method,
      headers: {
        ...(body ? { "Content-Type": "application/json" } : {}),
        ...authHeaders(token),
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (res.ok) {
      try {
        const feature = (await res.json()) as ParcelFeature;
        return { ok: true, status: res.status, tags: feature.properties.tags ?? [] };
      } catch {
        return { ok: true, status: res.status };
      }
    }

    let detail: string = res.statusText;
    try {
      const errBody = (await res.json()) as { detail?: string };
      if (typeof errBody?.detail === "string") {
        detail = errBody.detail;
      }
    } catch {
      // fall back to statusText
    }

    return { ok: false, status: res.status, detail };
  } catch {
    return {
      ok: false,
      status: 0,
      detail: "Tag service could not be reached. Try again.",
    };
  }
}

export async function addParcelTag(
  parcelId: string,
  tag: string,
  token?: string
): Promise<TagResult> {
  const base = getApiBase();
  if (!base) {
    return {
      ok: false,
      status: 0,
      detail: "No backend configured — fixture mode is read-only.",
    };
  }
  return tagRequest(`${base}/parcels/${parcelId}/tags`, "POST", { tag }, token);
}

export async function removeParcelTag(
  parcelId: string,
  tag: string,
  token?: string
): Promise<TagResult> {
  const base = getApiBase();
  if (!base) {
    return {
      ok: false,
      status: 0,
      detail: "No backend configured — fixture mode is read-only.",
    };
  }
  return tagRequest(
    `${base}/parcels/${parcelId}/tags/${encodeURIComponent(tag)}`,
    "DELETE",
    undefined,
    token
  );
}

// Weekly-snapshot watchlist ---------------------------------------------
//
// POST/DELETE /alerts/{id}/watch and POST /watchlist/{id}/captures are
// mutations; like transitionCase/tagRequest above, fixture mode (no
// NEXT_PUBLIC_API_URL) refuses them with a read-only detail rather than
// pretending to succeed. GET /watchlist and GET /watchlist/{id} are reads,
// so they fall back to FIXTURE_WATCH_ENTRIES the same way getAlerts/getCases
// fall back to their fixtures.

/** Extracts a `detail` string from a failed JSON response body, falling
 * back to statusText when the body is missing or not JSON. */
async function readErrorDetail(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { detail?: string };
    if (typeof body?.detail === "string") return body.detail;
  } catch {
    // fall back to statusText
  }
  return res.statusText;
}

// Scene bytes / image_url derivation ------------------------------------
//
// See the blob-serving interface contract (contract-blobs.md), especially
// §4: CaptureAttempt gains `image_url`, populated in the API layer from the
// parent resource + week key so no component ever builds an image URL by
// string-concatenation itself. This is the one place that concatenation
// happens.
//
// The backend's CaptureAttempt.to_dict() (mapencroach.imagery.capture) does
// not, and per the shipped implementation will not, put a "was this week's
// scene actually retained" flag on the wire — `retained` lives only on the
// server's internal SceneRecord (contract-blobs.md §2), scoped to the scene
// registry, not serialized onto watch-entry/case-imagery JSON. So this
// layer cannot tell retained and not-retained apart in advance without an
// extra request per week, which would defeat the point of a single list
// fetch. Instead it emits the scoped image path (contract-blobs.md §3) for
// every `status: "captured"` week — the only path that could ever serve it
// — and lets the browser find out: the endpoint 404s for a week that was
// captured but not retained, and WeeklySnapshotTimeline's <img> treats that
// load failure as the same "hash on record, image not retained" state a
// null `image_url` produces. `image_url` is still `null` outright for any
// week that was never `status: "captured"` — there is provably nothing to
// serve, so there is no reason to ever attempt that request.

/** Wire shape of a capture attempt exactly as the backend's CaptureAttempt
 * dataclass serializes it (contract.md) — no `image_url`, that is derived
 * here. */
type RawCaptureAttempt = Omit<CaptureAttempt, "image_url">;

/**
 * Attaches `image_url` to each raw capture attempt: the scoped image path
 * (see module notes above) for every captured week, `null` for anything
 * else. `imagePath` encodes which of the two scoped serving routes applies
 * (watchlist vs. case imagery, contract-blobs.md §3), so this one function
 * serves both call sites below.
 */
function withImageUrls(
  base: string,
  captures: RawCaptureAttempt[],
  imagePath: (week: string) => string
): CaptureAttempt[] {
  return captures.map((capture) => ({
    ...capture,
    image_url:
      capture.status === "captured"
        ? `${base}${imagePath(capture.week)}`
        : null,
  }));
}

/** GET /watchlist/{alert_id}/weeks/{week}/image (contract-blobs.md §3). */
function watchImagePath(alertId: string): (week: string) => string {
  return (week) => `/watchlist/${alertId}/weeks/${week}/image`;
}

/** GET /cases/{case_id}/imagery/{week}/image (contract-blobs.md §3). */
function caseImagePath(caseId: string): (week: string) => string {
  return (week) => `/cases/${caseId}/imagery/${week}/image`;
}

/** Wire shape of a WatchEntry before `image_url` is derived onto its captures. */
type RawWatchEntry = Omit<WatchEntry, "captures"> & {
  captures: RawCaptureAttempt[];
};

function normalizeWatchEntry(base: string, raw: RawWatchEntry): WatchEntry {
  return {
    ...raw,
    captures: withImageUrls(base, raw.captures, watchImagePath(raw.alert_id)),
  };
}

export async function getWatchlist(token?: string): Promise<WatchEntry[]> {
  const base = getApiBase();
  if (!base) return FIXTURE_WATCH_ENTRIES;
  const entries = await fetchJson<RawWatchEntry[]>(`${base}/watchlist`, token);
  return entries.map((entry) => normalizeWatchEntry(base, entry));
}

export async function getWatchEntry(
  alertId: string,
  token?: string
): Promise<WatchEntry | undefined> {
  const base = getApiBase();
  if (!base) {
    return FIXTURE_WATCH_ENTRIES.find((entry) => entry.alert_id === alertId);
  }
  try {
    const raw = await fetchJson<RawWatchEntry>(
      `${base}/watchlist/${alertId}`,
      token
    );
    return normalizeWatchEntry(base, raw);
  } catch (error) {
    // A watch entry that genuinely does not exist (never watched, or out of
    // jurisdiction scope — the backend never distinguishes the two) is a
    // 404. Any other failure must propagate rather than read as "not
    // watched".
    if (error instanceof ApiError && error.status === 404) return undefined;
    throw error;
  }
}

export interface WatchResult {
  ok: boolean;
  status: number;
  detail?: string;
  entry?: WatchEntry;
}

/**
 * Starts watching a RED-tier alert. The backend enforces the tier rule
 * (422 for anything not RED) and the "already watched" rule (409) — callers
 * should still gate the control on tier client-side so officers aren't
 * invited to click into a 422.
 */
export async function watchAlert(
  alertId: string,
  token?: string
): Promise<WatchResult> {
  const base = getApiBase();
  if (!base) {
    return {
      ok: false,
      status: 0,
      detail: "No backend configured — fixture mode is read-only.",
    };
  }

  const res = await fetch(`${base}/alerts/${alertId}/watch`, {
    method: "POST",
    headers: { ...authHeaders(token) },
  });

  if (res.ok) {
    const raw = (await res.json()) as RawWatchEntry;
    return { ok: true, status: res.status, entry: normalizeWatchEntry(base, raw) };
  }
  return { ok: false, status: res.status, detail: await readErrorDetail(res) };
}

export interface UnwatchResult {
  ok: boolean;
  status: number;
  detail?: string;
}

export async function unwatchAlert(
  alertId: string,
  token?: string
): Promise<UnwatchResult> {
  const base = getApiBase();
  if (!base) {
    return {
      ok: false,
      status: 0,
      detail: "No backend configured — fixture mode is read-only.",
    };
  }

  const res = await fetch(`${base}/alerts/${alertId}/watch`, {
    method: "DELETE",
    headers: { ...authHeaders(token) },
  });

  if (res.ok) return { ok: true, status: res.status };
  return { ok: false, status: res.status, detail: await readErrorDetail(res) };
}

export interface RunCapturesResult {
  ok: boolean;
  status: number;
  detail?: string;
  /** Only the newly attempted weeks (ascending), per the contract — not the
   * full capture history. */
  attempts?: CaptureAttempt[];
}

/**
 * Runs every currently-due week for a watched alert. There is no
 * scheduler behind this — it is an explicit, officer-triggered action, and
 * UI copy calling it must say so rather than implying automatic capture.
 */
export async function runCaptures(
  alertId: string,
  token?: string
): Promise<RunCapturesResult> {
  const base = getApiBase();
  if (!base) {
    return {
      ok: false,
      status: 0,
      detail: "No backend configured — fixture mode is read-only.",
    };
  }

  const res = await fetch(`${base}/watchlist/${alertId}/captures`, {
    method: "POST",
    headers: { ...authHeaders(token) },
  });

  if (res.ok) {
    const raw = (await res.json()) as RawCaptureAttempt[];
    const attempts = withImageUrls(base, raw, watchImagePath(alertId));
    return { ok: true, status: res.status, attempts };
  }
  return { ok: false, status: res.status, detail: await readErrorDetail(res) };
}

// Case imagery backfill --------------------------------------------------
//
// GET /cases/{id}/imagery is a read, so it falls back to fixtures the same
// way getCase/getWatchEntry do. POST /cases/{id}/imagery/backfill is a
// mutation and, like watchAlert/runCaptures above, refuses with a read-only
// detail in fixture mode rather than pretending to succeed. There is ONE
// imagery timeline per alert (see the contract addendum) — a case reaches
// it through its alert_id, not a separate per-case record.

/**
 * Fetches a case's weekly imagery history. Works whether or not a timeline
 * exists yet (`started_on: null`, empty `captures`) — `watchable` tells the
 * caller whether backfill is offered at all (only RED-tier originating
 * alerts). In fixture mode, falls back to an explicit fixture entry when one
 * is authored, or otherwise derives a "no timeline yet" record from the
 * fixture case/alert so any case id resolves to something sensible.
 */
export async function getCaseImagery(
  caseId: string,
  token?: string
): Promise<CaseImagery | undefined> {
  const base = getApiBase();
  if (!base) {
    const fixture = FIXTURE_CASE_IMAGERY[caseId];
    if (fixture) return fixture;
    const caseRecord = FIXTURE_CASES.find((c) => c.id === caseId);
    if (!caseRecord) return undefined;
    const alert = FIXTURE_ALERTS.find((a) => a.id === caseRecord.alert_id);
    const watchable = alert?.tier === "red";
    return {
      case_id: caseRecord.id,
      alert_id: caseRecord.alert_id,
      parcel_id: caseRecord.parcel_id,
      alert_tier: (alert?.tier ?? "legacy").toUpperCase(),
      watchable,
      started_on: null,
      cadence: "weekly",
      captures: [],
      due_weeks: [],
      backfill_floor: CASE_IMAGERY_BACKFILL_FLOOR,
      // Illustrative-only: a case never touched by backfill has every week
      // from the floor through the demo's "today" (2026-W31) outstanding.
      remaining_backfill_weeks: watchable ? 31 : 0,
    };
  }
  try {
    const raw = await fetchJson<
      Omit<CaseImagery, "captures"> & { captures: RawCaptureAttempt[] }
    >(`${base}/cases/${caseId}/imagery`, token);
    return {
      ...raw,
      captures: withImageUrls(base, raw.captures, caseImagePath(caseId)),
    };
  } catch (error) {
    // A genuinely missing/out-of-scope case is a 404. Any other failure
    // must propagate rather than read as "no imagery".
    if (error instanceof ApiError && error.status === 404) return undefined;
    throw error;
  }
}

export interface CaseImageryBackfillOptions {
  /** Defaults to the backend's configured floor when omitted. */
  from?: string;
  /** Bounds one request's work (backend default 26, max 52, min 1). */
  maxWeeks?: number;
}

export interface BackfillCaseImageryResult {
  ok: boolean;
  status: number;
  detail?: string;
  attempted?: CaptureAttempt[];
  started_on?: string;
  remaining_backfill_weeks?: number;
}

/**
 * Runs one chunk of a case's imagery backfill. The endpoint is deliberately
 * chunked (a full Jan-2026 backfill is ~31 sequential provider fetches, too
 * slow for one HTTP request) — callers must repeat this until the returned
 * `remaining_backfill_weeks` is 0. Idempotent per week, so re-running the
 * loop after a failure never re-attempts an already-captured week.
 */
export async function backfillCaseImagery(
  caseId: string,
  options: CaseImageryBackfillOptions = {},
  token?: string
): Promise<BackfillCaseImageryResult> {
  const base = getApiBase();
  if (!base) {
    return {
      ok: false,
      status: 0,
      detail: "No backend configured — fixture mode is read-only.",
    };
  }

  const body: Record<string, unknown> = {};
  if (options.from) body.from = options.from;
  if (options.maxWeeks != null) body.max_weeks = options.maxWeeks;

  const res = await fetch(`${base}/cases/${caseId}/imagery/backfill`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(token),
    },
    body: JSON.stringify(body),
  });

  if (res.ok) {
    const payload = (await res.json()) as {
      attempted: RawCaptureAttempt[];
      started_on: string;
      remaining_backfill_weeks: number;
    };
    return {
      ok: true,
      status: res.status,
      attempted: withImageUrls(base, payload.attempted, caseImagePath(caseId)),
      started_on: payload.started_on,
      remaining_backfill_weeks: payload.remaining_backfill_weeks,
    };
  }
  return { ok: false, status: res.status, detail: await readErrorDetail(res) };
}

export interface BoundaryGradeResult {
  ok: boolean;
  status: number;
  detail?: string;
  grade?: BoundaryGrade;
}

export async function updateBoundaryGrade(
  parcelId: string,
  grade: BoundaryGrade,
  surveyReference: string,
  token?: string
): Promise<BoundaryGradeResult> {
  const base = getApiBase();
  if (!base) {
    return {
      ok: false,
      status: 0,
      detail: "No backend configured — fixture mode is read-only.",
    };
  }

  try {
    const res = await fetch(`${base}/parcels/${parcelId}/boundary-grade`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        ...authHeaders(token),
      },
      body: JSON.stringify({
        grade,
        survey_reference: surveyReference,
      }),
    });

    if (res.ok) {
      const feature = (await res.json()) as ParcelFeature;
      return {
        ok: true,
        status: res.status,
        grade: feature.properties.boundary_grade,
      };
    }

    let detail = res.statusText;
    try {
      const body = (await res.json()) as { detail?: string };
      if (typeof body.detail === "string") detail = body.detail;
    } catch {
      // Keep the HTTP status text when the backend body is not JSON.
    }
    return { ok: false, status: res.status, detail };
  } catch {
    return {
      ok: false,
      status: 0,
      detail: "Boundary-grade service could not be reached. Try again.",
    };
  }
}
