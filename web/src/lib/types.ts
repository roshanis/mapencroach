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
  /** GeoJSON Polygon geometry (lng/lat pairs). */
  geometry: GeoJSON.Polygon;
  /** Approximate centroid for map panning, [lng, lat]. */
  centroid: [number, number];
  /** Free-text tags applied by case officers / data admins. */
  tags: string[];
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

export interface CaseEvent {
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
  state: CaseState;
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
