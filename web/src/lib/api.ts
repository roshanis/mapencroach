// Typed data-access layer for the admin console.
//
// When NEXT_PUBLIC_API_URL is set, all functions fetch from the REST backend.
// Otherwise they fall back to the built-in fixtures so the UI can be demoed
// with zero backend.

import { readCookie } from "./cookies";
import {
  FIXTURE_ALERTS,
  FIXTURE_CASES,
  FIXTURE_PARCELS,
  FIXTURE_PARCEL_CONTEXTS,
} from "./fixtures";
import type {
  Alert,
  BBox,
  Case,
  CaseEvent,
  LandCategory,
  BoundaryGrade,
  Parcel,
  ParcelContext,
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

function authHeaders(tokenOverride?: string): HeadersInit | undefined {
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
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

async function fetchJson<T>(url: string, token?: string): Promise<T> {
  const res = await fetch(url, { headers: authHeaders(token) });
  if (!res.ok) {
    throw new ApiError(
      res.status,
      `Request failed: ${res.status} ${res.statusText} (${url})`
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
