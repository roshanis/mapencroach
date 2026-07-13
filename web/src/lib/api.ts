// Typed data-access layer for the admin console.
//
// When NEXT_PUBLIC_API_URL is set, all functions fetch from the REST backend.
// Otherwise they fall back to the built-in fixtures so the UI can be demoed
// with zero backend.

import { FIXTURE_ALERTS, FIXTURE_CASES, FIXTURE_PARCELS } from "./fixtures";
import type {
  Alert,
  AlertFilters,
  BBox,
  Case,
  CaseEvent,
  LandCategory,
  BoundaryGrade,
  Parcel,
} from "./types";

export const TOKEN_COOKIE = "mapencroach_token";
export const PERSONA_COOKIE = "mapencroach_persona";

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
 * arrays through unchanged.
 */
function normalizeArtifacts(artifacts: unknown): string[] {
  if (Array.isArray(artifacts)) {
    return artifacts as string[];
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

function cookieValue(name: string): string | undefined {
  if (typeof document === "undefined") return undefined;
  const prefix = `${name}=`;
  const match = document.cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(prefix));
  if (!match) return undefined;
  return decodeURIComponent(match.slice(prefix.length));
}

function authHeaders(tokenOverride?: string): HeadersInit | undefined {
  const token =
    tokenOverride ??
    (typeof document !== "undefined" ? cookieValue(TOKEN_COOKIE) : undefined) ??
    process.env.NEXT_PUBLIC_API_TOKEN;
  return token ? { Authorization: `Bearer ${token}` } : undefined;
}

async function fetchJson<T>(url: string, token?: string): Promise<T> {
  const res = await fetch(url, { headers: authHeaders(token) });
  if (!res.ok) {
    throw new Error(`Request failed: ${res.status} ${res.statusText} (${url})`);
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
  } catch {
    return undefined;
  }
}

export async function getAlerts(
  filters?: AlertFilters,
  token?: string
): Promise<Alert[]> {
  const base = getApiBase();
  let alerts: Alert[];
  if (!base) {
    alerts = FIXTURE_ALERTS;
  } else {
    // Backend enums are uppercase (RED/OPEN); UI keys off lowercase.
    alerts = (await fetchJson<Alert[]>(`${base}/alerts`, token)).map((a) => ({
      ...a,
      tier: a.tier.toLowerCase() as Alert["tier"],
      status: a.status.toLowerCase() as Alert["status"],
    }));
  }

  return alerts.filter((a) => {
    if (filters?.tier && a.tier !== filters.tier) return false;
    if (filters?.status && a.status !== filters.status) return false;
    return true;
  });
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
  } catch {
    return undefined;
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
