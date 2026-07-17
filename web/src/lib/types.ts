// Core domain types for the mapencroach admin console.

export type AlertTier = "green" | "amber" | "red" | "legacy";

export type AlertStatus = "open" | "under_review" | "escalated" | "closed";

export type BoundaryGrade = "A" | "B" | "C";

export const BOUNDARY_GRADE_EXPLANATIONS: Record<BoundaryGrade, string> = {
  A: "DGPS-verified — enforcement can rely on this boundary",
  B: "Georeferenced — suitable for notices; survey before demolition",
  C: "Unverified — a notice cannot rely on this boundary; survey first",
};

export type LandCategory =
  | "waterbody"
  | "forest"
  | "revenue"
  | "municipal"
  | "agricultural"
  | "grazing"
  | "irrigation"
  | "housing"
  | "industrial";

export const LAND_CATEGORY_COLORS: Record<LandCategory, string> = {
  waterbody: "#1d7fbf",
  forest: "#1e8f4e",
  irrigation: "#12918a",
  municipal: "#c98a12",
  housing: "#b0578d",
  industrial: "#64748b",
  revenue: "#8a5a2b",
  agricultural: "#7da33c",
  grazing: "#a3903c",
};

export const LAND_CATEGORY_LABELS: Record<LandCategory, string> = {
  waterbody: "Waterbody",
  forest: "Forest",
  irrigation: "Irrigation",
  municipal: "Municipal",
  housing: "Housing",
  industrial: "Industrial",
  revenue: "Revenue",
  agricultural: "Agricultural",
  grazing: "Grazing",
};

export interface Parcel {
  id: string;
  survey_no: string;
  ulpin: string;
  owning_department: string;
  land_category: LandCategory;
  boundary_grade: BoundaryGrade;
  jurisdiction_id: string;
  jurisdiction_name?: string;
  /** GeoJSON Polygon geometry (lng/lat pairs). */
  geometry: GeoJSON.Polygon;
  /** Approximate centroid for map panning, [lng, lat]. */
  centroid: [number, number];
  /** Free-text tags applied by case officers / data admins. */
  tags: string[];
}

export interface ParcelAlias {
  scheme: string;
  value: string;
  source: string;
  valid_from: string | null;
  valid_to: string | null;
  match_method: string;
  confidence: number;
}

export interface ParcelLineageEdge {
  related_parcel_id: string;
  relation: "split_from" | "merged_from" | "renumbered_from";
  effective_on: string | null;
  source: string;
  confidence: number;
}

export interface ParcelGeographicLink {
  scheme: string;
  geographic_unit_id: string;
  name: string;
  level: string;
  match_method: string;
  confidence: number;
  source_id: string;
  context_only: true;
}

export interface ParcelContextObservation {
  key: string;
  label: string;
  value: number | string | boolean;
  unit: string;
  period: string;
  trend: string | null;
  source_id: string;
  context_only: true;
}

export interface ParcelContextSource {
  id: string;
  provider: string;
  dataset: string;
  version: string;
  vintage: string;
  license: string;
  source_url: string;
  resolution: string;
  limitations: string[];
  is_demo: boolean;
}

export interface ParcelContext {
  parcel_id: string;
  canonical_id: string;
  aliases: ParcelAlias[];
  lineage: ParcelLineageEdge[];
  geographic_links: ParcelGeographicLink[];
  observations: ParcelContextObservation[];
  sources: ParcelContextSource[];
  classification: "context_only";
  disclaimer: string;
}

export interface Alert {
  id: string;
  parcel_id: string;
  tier: AlertTier;
  severity_score: number;
  area_m2: number;
  status: AlertStatus;
  detected_at: string;
}

export type CaseState =
  | "NEW"
  | "TRIAGED"
  | "INSPECTION_ASSIGNED"
  | "INSPECTED"
  | "SHOW_CAUSE_ISSUED"
  | "RESPONSE_WINDOW"
  | "HEARING_SCHEDULED"
  | "HEARING_HELD"
  | "ORDER_ISSUED"
  | "ACTION_TAKEN"
  | "CLOSED";

export const CASE_STATE_CHAIN: CaseState[] = [
  "NEW",
  "TRIAGED",
  "INSPECTION_ASSIGNED",
  "INSPECTED",
  "SHOW_CAUSE_ISSUED",
  "RESPONSE_WINDOW",
  "HEARING_SCHEDULED",
  "HEARING_HELD",
  "ORDER_ISSUED",
  "ACTION_TAKEN",
  "CLOSED",
];

export const STATE_LABELS: Record<CaseState, string> = {
  NEW: "New",
  TRIAGED: "Triaged",
  INSPECTION_ASSIGNED: "Inspection Assigned",
  INSPECTED: "Inspected",
  SHOW_CAUSE_ISSUED: "Show Cause Issued",
  RESPONSE_WINDOW: "Response Window",
  HEARING_SCHEDULED: "Hearing Scheduled",
  HEARING_HELD: "Hearing Held",
  ORDER_ISSUED: "Order Issued",
  ACTION_TAKEN: "Action Taken",
  CLOSED: "Closed",
};

/** Case states outside the 11-step due-process chain. */
export type SpecialCaseState =
  | "DISMISSED_FALSE_POSITIVE"
  | "LEGACY_REFERRED"
  | "SURVEY_REQUESTED"
  | "STAYED_BY_COURT";

export type AnyCaseState = CaseState | SpecialCaseState;

export const SPECIAL_STATE_LABELS: Record<SpecialCaseState, string> = {
  DISMISSED_FALSE_POSITIVE: "Dismissed — False Positive",
  LEGACY_REFERRED: "Referred — Legacy Process",
  SURVEY_REQUESTED: "Paused — Survey Requested",
  STAYED_BY_COURT: "Paused — Stayed by Court",
};

/** Special states where the forward chain is frozen but resumable. */
export const PAUSED_STATES: ReadonlySet<string> = new Set([
  "SURVEY_REQUESTED",
  "STAYED_BY_COURT",
]);

/** Special states that end the case outside the normal chain (never resume). */
export const TERMINAL_OFF_CHAIN_STATES: ReadonlySet<string> = new Set([
  "DISMISSED_FALSE_POSITIVE",
  "LEGACY_REFERRED",
]);

/** All states (chain + special) that mean the case is no longer moving:
 * CLOSED (terminal, on-chain) plus the two terminal off-chain states. */
export const TERMINAL_STATES: ReadonlySet<string> = new Set([
  "CLOSED",
  "DISMISSED_FALSE_POSITIVE",
  "LEGACY_REFERRED",
]);

export const NON_CHAIN_STATES: SpecialCaseState[] = [
  "DISMISSED_FALSE_POSITIVE",
  "LEGACY_REFERRED",
  "SURVEY_REQUESTED",
  "STAYED_BY_COURT",
];

export interface CaseEvent {
  // TODO: widen to AnyCaseState once the backend event-history contract
  // confirms special states (DISMISSED_FALSE_POSITIVE, etc.) can appear as
  // from_state/to_state — today only chain transitions are observed here.
  from_state: CaseState | null;
  to_state: CaseState;
  actor: string;
  occurred_at: string;
  artifacts: string[];
  note?: string;
}

export interface Case {
  id: string;
  alert_id: string;
  parcel_id: string;
  state: AnyCaseState;
  state_since?: string | null;
  events: CaseEvent[];
  allowed_transitions?: string[];
  required_artifacts?: Record<string, string[]>;
}

export interface BBox {
  west: number;
  south: number;
  east: number;
  north: number;
}

export interface AlertFilters {
  tier?: AlertTier;
  status?: AlertStatus;
}
