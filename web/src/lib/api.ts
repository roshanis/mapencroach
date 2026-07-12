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
    geometry,
    centroid: centroidOf(geometry),
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

function authHeaders(): HeadersInit | undefined {
  const token = process.env.NEXT_PUBLIC_API_TOKEN;
  return token ? { Authorization: `Bearer ${token}` } : undefined;
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: authHeaders() });
  if (!res.ok) {
    throw new Error(`Request failed: ${res.status} ${res.statusText} (${url})`);
  }
  return (await res.json()) as T;
}

export async function getParcels(bbox?: BBox): Promise<Parcel[]> {
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
    `${base}/parcels${params}`
  );
  return collection.features.map(featureToParcel);
}

export async function getParcel(id: string): Promise<Parcel | undefined> {
  const base = getApiBase();
  if (!base) {
    return FIXTURE_PARCELS.find((p) => p.id === id);
  }
  try {
    const feature = await fetchJson<ParcelFeature>(`${base}/parcels/${id}`);
    return featureToParcel(feature);
  } catch {
    return undefined;
  }
}

export async function getAlerts(filters?: AlertFilters): Promise<Alert[]> {
  const base = getApiBase();
  let alerts: Alert[];
  if (!base) {
    alerts = FIXTURE_ALERTS;
  } else {
    // Backend enums are uppercase (RED/OPEN); UI keys off lowercase.
    alerts = (await fetchJson<Alert[]>(`${base}/alerts`)).map((a) => ({
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

export async function getCases(): Promise<Case[]> {
  const base = getApiBase();
  if (!base) return FIXTURE_CASES;
  const cases = await fetchJson<Case[]>(`${base}/cases`);
  return cases.map(normalizeCase);
}

export async function getCase(id: string): Promise<Case | undefined> {
  const base = getApiBase();
  if (!base) {
    return FIXTURE_CASES.find((c) => c.id === id);
  }
  try {
    const raw = await fetchJson<Case>(`${base}/cases/${id}`);
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
  note?: string
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
      ...authHeaders(),
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
