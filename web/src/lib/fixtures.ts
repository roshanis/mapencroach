// Built-in demo fixtures used when NEXT_PUBLIC_API_URL is not configured.
// Geography centers on the Haridwar–Roorkee corridor, Uttarakhand (~78.0E,
// 29.9N), with several parcels bordering the Upper Ganga Canal to illustrate
// the waterbody-encroachment storyline.

import type { Persona } from "./api";
import type { Alert, Case, Parcel, ParcelContext } from "./types";

function square(
  centerLng: number,
  centerLat: number,
  halfWidthDeg: number
): GeoJSON.Polygon {
  const w = centerLng - halfWidthDeg;
  const e = centerLng + halfWidthDeg;
  const s = centerLat - halfWidthDeg;
  const n = centerLat + halfWidthDeg;
  return {
    type: "Polygon",
    coordinates: [
      [
        [w, s],
        [e, s],
        [e, n],
        [w, n],
        [w, s],
      ],
    ],
  };
}

export const FIXTURE_PARCELS: Parcel[] = [
  {
    id: "PCL-1001",
    survey_no: "44/2",
    ulpin: "UK17HR0001001",
    owning_department: "Water Resources Department",
    land_category: "waterbody",
    boundary_grade: "A",
    jurisdiction_id: "UK-URBAN-01",
    geometry: square(77.979, 29.913, 0.003),
    centroid: [77.979, 29.913],
    tags: ["court-monitored"],
  },
  {
    id: "PCL-1002",
    survey_no: "44/5",
    ulpin: "UK17HR0001002",
    owning_department: "Water Resources Department",
    land_category: "waterbody",
    boundary_grade: "B",
    jurisdiction_id: "UK-URBAN-01",
    geometry: square(77.983, 29.915, 0.0028),
    centroid: [77.983, 29.915],
    tags: [],
  },
  {
    id: "PCL-1003",
    survey_no: "51/1",
    ulpin: "UK17HR0001003",
    owning_department: "Forest Department",
    land_category: "forest",
    boundary_grade: "B",
    jurisdiction_id: "UK-URBAN-01",
    geometry: square(77.97, 29.921, 0.004),
    centroid: [77.97, 29.921],
    tags: [],
  },
  {
    id: "PCL-1004",
    survey_no: "62/3",
    ulpin: "UK17HR0001004",
    owning_department: "Revenue Department",
    land_category: "revenue",
    boundary_grade: "C",
    jurisdiction_id: "UK-URBAN-02",
    geometry: square(78.02, 29.896, 0.0035),
    centroid: [78.02, 29.896],
    tags: ["legacy-review"],
  },
  {
    id: "PCL-1005",
    survey_no: "18/1",
    ulpin: "UK17HR0001005",
    owning_department: "Nagar Nigam Haridwar",
    land_category: "municipal",
    boundary_grade: "A",
    jurisdiction_id: "UK-URBAN-02",
    geometry: square(78.03, 29.891, 0.003),
    centroid: [78.03, 29.891],
    tags: [],
  },
  {
    id: "PCL-1006",
    survey_no: "77/4",
    ulpin: "UK17HR0001006",
    owning_department: "Revenue Department",
    land_category: "agricultural",
    boundary_grade: "C",
    jurisdiction_id: "UK-RURAL-01",
    geometry: square(78.06, 29.936, 0.0045),
    centroid: [78.06, 29.936],
    tags: [],
  },
  {
    id: "PCL-1007",
    survey_no: "33/2",
    ulpin: "UK17HR0001007",
    owning_department: "Revenue Department",
    land_category: "grazing",
    boundary_grade: "B",
    jurisdiction_id: "UK-RURAL-01",
    geometry: square(78.05, 29.946, 0.004),
    centroid: [78.05, 29.946],
    tags: [],
  },
  {
    id: "PCL-1008",
    survey_no: "44/9",
    ulpin: "UK17HR0001008",
    owning_department: "Water Resources Department",
    land_category: "waterbody",
    boundary_grade: "A",
    jurisdiction_id: "UK-URBAN-01",
    geometry: square(77.976, 29.91, 0.0025),
    centroid: [77.976, 29.91],
    tags: [],
  },
  {
    id: "PCL-1009",
    survey_no: "12/6",
    ulpin: "UK17HR0001009",
    owning_department: "Nagar Nigam Haridwar",
    land_category: "municipal",
    boundary_grade: "B",
    jurisdiction_id: "UK-URBAN-02",
    geometry: square(78.015, 29.884, 0.003),
    centroid: [78.015, 29.884],
    tags: [],
  },
  {
    id: "PCL-1010",
    survey_no: "58/1",
    ulpin: "UK17HR0001010",
    owning_department: "Forest Department",
    land_category: "forest",
    boundary_grade: "C",
    jurisdiction_id: "UK-RURAL-02",
    geometry: square(78.09, 29.956, 0.005),
    centroid: [78.09, 29.956],
    tags: [],
  },
];

const CONTEXT_DISCLAIMER =
  "Contextual signals support prioritization only. They are not enforcement evidence and do not establish parcel ownership, boundaries, or encroachment.";

export const FIXTURE_PARCEL_CONTEXTS: Record<string, ParcelContext> = {
  "PCL-1001": {
    parcel_id: "PCL-1001",
    canonical_id: "PCL-1001",
    aliases: [
      {
        scheme: "survey_no",
        value: "44/2",
        source: "Illustrative demo parcel register",
        valid_from: null,
        valid_to: null,
        match_method: "authoritative_identifier",
        confidence: 1,
      },
      {
        scheme: "ULPIN",
        value: "UK17HR0001001",
        source: "Illustrative demo parcel register",
        valid_from: null,
        valid_to: null,
        match_method: "authoritative_identifier",
        confidence: 1,
      },
    ],
    lineage: [],
    geographic_links: [
      {
        scheme: "SHRUG_SHRID2",
        geographic_unit_id: "demo-hrda-001",
        name: "Haridwar context unit (illustrative)",
        level: "village_or_town",
        match_method: "centroid_within_demo_geometry",
        confidence: 0.78,
        source_id: "shrug-compatible-demo",
        context_only: true,
      },
    ],
    observations: [
      {
        key: "tree_cover_change",
        label: "Tree-cover trend",
        value: -3.4,
        unit: "percentage points",
        period: "2015–2021",
        trend: "falling",
        source_id: "shrug-compatible-demo",
        context_only: true,
      },
      {
        key: "night_light_mean",
        label: "Night-light intensity",
        value: 4.2,
        unit: "illustrative index",
        period: "2021",
        trend: "rising",
        source_id: "shrug-compatible-demo",
        context_only: true,
      },
      {
        key: "road_access",
        label: "Road access",
        value: "Connected",
        unit: "illustrative category",
        period: "2021",
        trend: null,
        source_id: "shrug-compatible-demo",
        context_only: true,
      },
      {
        key: "canal_presence",
        label: "Canal presence",
        value: true,
        unit: "illustrative flag",
        period: "2021",
        trend: null,
        source_id: "shrug-compatible-demo",
        context_only: true,
      },
      {
        key: "population_pressure",
        label: "Settlement pressure",
        value: "Elevated",
        unit: "illustrative category",
        period: "2011–2021",
        trend: "rising",
        source_id: "shrug-compatible-demo",
        context_only: true,
      },
    ],
    sources: [
      {
        id: "shrug-compatible-demo",
        provider: "mapencroach demo",
        dataset: "SHRUG-compatible planning indicators",
        version: "Illustrative demo v1",
        vintage: "Illustrative demo period",
        license:
          "Illustrative data generated for this demo; no SHRUG data redistributed",
        source_url: "https://docs.devdatalab.org/",
        resolution: "Fictional SHRUG-compatible village/town unit",
        limitations: [
          "Illustrative values only; not sourced from Development Data Lab.",
          "Not a parcel measurement and not enforcement evidence.",
        ],
        is_demo: true,
      },
    ],
    classification: "context_only",
    disclaimer: CONTEXT_DISCLAIMER,
  },
  "PCL-1002": {
    parcel_id: "PCL-1002",
    canonical_id: "PCL-1002",
    aliases: [
      {
        scheme: "survey_no",
        value: "44/5",
        source: "Illustrative demo parcel register",
        valid_from: null,
        valid_to: null,
        match_method: "authoritative_identifier",
        confidence: 1,
      },
      {
        scheme: "ULPIN",
        value: "UK17HR0001002",
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
    disclaimer: CONTEXT_DISCLAIMER,
  },
};

export const FIXTURE_ALERTS: Alert[] = [
  {
    id: "ALT-5001",
    parcel_id: "PCL-1001",
    tier: "red",
    severity_score: 92,
    area_m2: 1840,
    status: "escalated",
    detected_at: "2026-06-18T05:12:00Z",
  },
  {
    id: "ALT-5002",
    parcel_id: "PCL-1008",
    tier: "red",
    severity_score: 87,
    area_m2: 1210,
    status: "under_review",
    detected_at: "2026-06-24T06:40:00Z",
  },
  {
    id: "ALT-5003",
    parcel_id: "PCL-1004",
    tier: "amber",
    severity_score: 61,
    area_m2: 640,
    status: "open",
    detected_at: "2026-07-01T04:05:00Z",
  },
  {
    id: "ALT-5004",
    parcel_id: "PCL-1006",
    tier: "green",
    severity_score: 22,
    area_m2: 300,
    status: "closed",
    detected_at: "2026-06-10T03:30:00Z",
  },
  {
    id: "ALT-5005",
    parcel_id: "PCL-1003",
    tier: "legacy",
    severity_score: 45,
    area_m2: 980,
    status: "open",
    detected_at: "2026-05-02T02:15:00Z",
  },
];

export const FIXTURE_CASES: Case[] = [
  {
    id: "CASE-9001",
    alert_id: "ALT-5001",
    parcel_id: "PCL-1001",
    state: "SHOW_CAUSE_ISSUED",
    allowed_transitions: [
      "RESPONSE_WINDOW",
      "DISMISSED_FALSE_POSITIVE",
      "LEGACY_REFERRED",
      "SURVEY_REQUESTED",
      "STAYED_BY_COURT",
    ],
    events: [
      {
        from_state: null,
        to_state: "NEW",
        actor: "system:detector",
        occurred_at: "2026-06-18T05:15:00Z",
        artifacts: [],
        note: "Case auto-opened from ALT-5001 (red tier, waterbody).",
      },
      {
        from_state: "NEW",
        to_state: "TRIAGED",
        actor: "Deputy Collector R. Sharma",
        occurred_at: "2026-06-19T09:00:00Z",
        artifacts: ["triage_note_9001.pdf"],
      },
      {
        from_state: "TRIAGED",
        to_state: "INSPECTION_ASSIGNED",
        actor: "Deputy Collector R. Sharma",
        occurred_at: "2026-06-20T10:30:00Z",
        artifacts: [],
        note: "Assigned to field inspector: A. Verma.",
      },
      {
        from_state: "INSPECTION_ASSIGNED",
        to_state: "INSPECTED",
        actor: "Inspector A. Verma",
        occurred_at: "2026-06-25T11:45:00Z",
        artifacts: ["site_inspection_9001.pdf", "site_photos_9001.zip"],
      },
      {
        from_state: "INSPECTED",
        to_state: "SHOW_CAUSE_ISSUED",
        actor: "Deputy Collector R. Sharma",
        occurred_at: "2026-06-29T14:00:00Z",
        artifacts: ["show_cause_notice_9001.pdf"],
        note: "Notice served to occupant under Section 122-B, U.P. Land Revenue Act (as applicable to Uttarakhand).",
      },
    ],
  },
  {
    id: "CASE-9002",
    alert_id: "ALT-5004",
    parcel_id: "PCL-1006",
    state: "CLOSED",
    events: [
      {
        from_state: null,
        to_state: "NEW",
        actor: "system:detector",
        occurred_at: "2026-06-10T03:35:00Z",
        artifacts: [],
      },
      {
        from_state: "NEW",
        to_state: "TRIAGED",
        actor: "Deputy Collector S. Iyer",
        occurred_at: "2026-06-10T12:00:00Z",
        artifacts: [],
        note: "Change identified as authorized agricultural activity.",
      },
      {
        from_state: "TRIAGED",
        to_state: "INSPECTION_ASSIGNED",
        actor: "Deputy Collector S. Iyer",
        occurred_at: "2026-06-11T09:00:00Z",
        artifacts: [],
      },
      {
        from_state: "INSPECTION_ASSIGNED",
        to_state: "INSPECTED",
        actor: "Inspector P. Rao",
        occurred_at: "2026-06-12T10:00:00Z",
        artifacts: ["site_inspection_9002.pdf"],
      },
      {
        from_state: "INSPECTED",
        to_state: "SHOW_CAUSE_ISSUED",
        actor: "Deputy Collector S. Iyer",
        occurred_at: "2026-06-13T10:00:00Z",
        artifacts: [],
        note: "Issued as a formality; landholder has valid permit on file.",
      },
      {
        from_state: "SHOW_CAUSE_ISSUED",
        to_state: "RESPONSE_WINDOW",
        actor: "system:workflow",
        occurred_at: "2026-06-13T10:05:00Z",
        artifacts: [],
      },
      {
        from_state: "RESPONSE_WINDOW",
        to_state: "HEARING_SCHEDULED",
        actor: "Deputy Collector S. Iyer",
        occurred_at: "2026-06-16T09:00:00Z",
        artifacts: ["hearing_notice_9002.pdf"],
      },
      {
        from_state: "HEARING_SCHEDULED",
        to_state: "HEARING_HELD",
        actor: "Deputy Collector S. Iyer",
        occurred_at: "2026-06-20T11:00:00Z",
        artifacts: ["hearing_minutes_9002.pdf"],
      },
      {
        from_state: "HEARING_HELD",
        to_state: "ORDER_ISSUED",
        actor: "Deputy Collector S. Iyer",
        occurred_at: "2026-06-21T15:00:00Z",
        artifacts: ["order_9002.pdf"],
        note: "Order: no violation found, permit valid.",
      },
      {
        from_state: "ORDER_ISSUED",
        to_state: "ACTION_TAKEN",
        actor: "system:workflow",
        occurred_at: "2026-06-21T15:05:00Z",
        artifacts: [],
      },
      {
        from_state: "ACTION_TAKEN",
        to_state: "CLOSED",
        actor: "Deputy Collector S. Iyer",
        occurred_at: "2026-06-22T09:00:00Z",
        artifacts: ["closure_summary_9002.pdf"],
      },
    ],
  },
];

const VIEWER_CAPABILITIES = [
  "See every parcel, alert and case in scope",
  "Cannot act on cases",
  "Cannot edit tags or boundary grades",
];

const CASE_OFFICER_CAPABILITIES = [
  "Move cases through due process",
  "Create alerts and tag parcels",
  "Cannot see other jurisdictions' parcels (even that they exist)",
  "Cannot upgrade boundary grades",
];

const SURVEY_OFFICER_CAPABILITIES = [
  "Upgrade boundary grades after ground survey",
  "Cannot transition cases",
];

const DATA_ADMIN_CAPABILITIES = [
  "Manage parcel records and tags in scope",
  "Cannot move cases through the legal chain",
];

// Mirrors the 5 demo personas served by GET /demo/personas so the personas
// page (and PersonaCard) can be exercised without a backend.
export const FIXTURE_PERSONAS: Persona[] = [
  {
    id: "vc-hrda",
    name: "Vice Chairman, HRDA",
    role: "viewer",
    jurisdiction_id: "state",
    jurisdiction_name: "Haridwar–Roorkee Development Authority",
    description:
      "Oversees the full authority with read-only visibility into every parcel, alert and case.",
    visible_parcels: 30,
    capabilities: VIEWER_CAPABILITIES,
  },
  {
    id: "eo-haridwar",
    name: "Enforcement Officer, Haridwar",
    role: "case_officer",
    jurisdiction_id: "dist-a",
    jurisdiction_name: "Haridwar Division",
    description:
      "Drives cases through due process for encroachments within Haridwar division.",
    visible_parcels: 15,
    capabilities: CASE_OFFICER_CAPABILITIES,
  },
  {
    id: "survey-roorkee",
    name: "Survey Officer, Roorkee",
    role: "survey_officer",
    jurisdiction_id: "dist-b",
    jurisdiction_name: "Roorkee Division",
    description:
      "Conducts ground surveys and upgrades boundary grades for parcels in Roorkee division.",
    visible_parcels: 15,
    capabilities: SURVEY_OFFICER_CAPABILITIES,
  },
  {
    id: "co-roorkee-city",
    name: "Case Officer, Roorkee City",
    role: "case_officer",
    jurisdiction_id: "taluk-b1",
    jurisdiction_name: "Roorkee City",
    description:
      "Handles enforcement cases scoped to Roorkee City taluk only.",
    visible_parcels: 5,
    capabilities: CASE_OFFICER_CAPABILITIES,
  },
  {
    id: "admin-hq",
    name: "Data Administrator, HRDA HQ",
    role: "data_admin",
    jurisdiction_id: "state",
    jurisdiction_name: "Haridwar–Roorkee Development Authority",
    description:
      "Maintains parcel records and tags across the authority; does not act on cases.",
    visible_parcels: 30,
    capabilities: DATA_ADMIN_CAPABILITIES,
  },
];
