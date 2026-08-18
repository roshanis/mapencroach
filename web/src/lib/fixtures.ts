// Built-in demo fixtures used when NEXT_PUBLIC_API_URL is not configured.
// Geography centers on the Haridwar–Roorkee corridor, Uttarakhand (~78.0E,
// 29.9N), with several parcels bordering the Upper Ganga Canal to illustrate
// the waterbody-encroachment storyline.

import type { Persona } from "./api";
import type {
  Alert,
  Case,
  CaseImagery,
  Jurisdiction,
  Parcel,
  ParcelContext,
  WatchEntry,
} from "./types";

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
    // Matches PCL-1001's jurisdiction_id — this case has not been transferred.
    jurisdiction_id: "UK-URBAN-01",
    state: "SHOW_CAUSE_ISSUED",
    // Matches the occurred_at of the SHOW_CAUSE_ISSUED event below — the
    // "Time in stage" column and days-in-stage sort need this to work in
    // demo mode (no backend).
    state_since: "2026-06-29T14:00:00Z",
    allowed_transitions: [
      "RESPONSE_WINDOW",
      "DISMISSED_FALSE_POSITIVE",
      "LEGACY_REFERRED",
      "SURVEY_REQUESTED",
      "STAYED_BY_COURT",
    ],
    // Exercises TransitionPanel's evidence-gating UI in demo mode: opening
    // the response window needs no evidence, but every other legal step
    // does, and submit stays disabled until it is supplied.
    required_artifacts: {
      RESPONSE_WINDOW: [],
      DISMISSED_FALSE_POSITIVE: ["dismissal_reason"],
      LEGACY_REFERRED: ["legacy_reference"],
      SURVEY_REQUESTED: ["survey_request_reference"],
      STAYED_BY_COURT: ["court_order_reference"],
    },
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
    // Matches PCL-1006's jurisdiction_id — this case has not been transferred.
    jurisdiction_id: "UK-RURAL-01",
    state: "CLOSED",
    state_since: "2026-06-22T09:00:00Z",
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
  {
    // A second in-due-process case with an older state_since than
    // CASE-9001, so the "In due process" section has more than one row and
    // the days-in-stage sort has something to actually order.
    id: "CASE-9003",
    alert_id: "ALT-5005",
    parcel_id: "PCL-1003",
    // Matches PCL-1003's jurisdiction_id — this case has not been transferred.
    jurisdiction_id: "UK-URBAN-01",
    state: "INSPECTED",
    state_since: "2026-06-08T08:30:00Z",
    allowed_transitions: [
      "SHOW_CAUSE_ISSUED",
      "DISMISSED_FALSE_POSITIVE",
      "LEGACY_REFERRED",
    ],
    required_artifacts: {
      SHOW_CAUSE_ISSUED: ["show_cause_notice"],
      DISMISSED_FALSE_POSITIVE: ["dismissal_reason"],
      LEGACY_REFERRED: ["legacy_reference"],
    },
    events: [
      {
        from_state: null,
        to_state: "NEW",
        actor: "system:detector",
        occurred_at: "2026-05-02T02:20:00Z",
        artifacts: [],
        note: "Case auto-opened from ALT-5005 (legacy tier, forest).",
      },
      {
        from_state: "NEW",
        to_state: "TRIAGED",
        actor: "Deputy Collector R. Sharma",
        occurred_at: "2026-05-05T09:00:00Z",
        artifacts: ["triage_note_9003.pdf"],
      },
      {
        from_state: "TRIAGED",
        to_state: "INSPECTION_ASSIGNED",
        actor: "Deputy Collector R. Sharma",
        occurred_at: "2026-05-20T10:00:00Z",
        artifacts: [],
        note: "Legacy-occupation queue; assigned to field inspector: A. Verma.",
      },
      {
        from_state: "INSPECTION_ASSIGNED",
        to_state: "INSPECTED",
        actor: "Inspector A. Verma",
        occurred_at: "2026-06-08T08:30:00Z",
        artifacts: ["site_inspection_9003.pdf"],
      },
    ],
  },
  {
    // Demonstrates StateRail's paused-progress display: the case is paused
    // at STAYED_BY_COURT (off-chain), but its event history reached
    // RESPONSE_WINDOW before the stay — the rail should show NEW through
    // RESPONSE_WINDOW as done, not reset every step to not-done.
    id: "CASE-9004",
    alert_id: "ALT-5003",
    parcel_id: "PCL-1004",
    // Matches PCL-1004's jurisdiction_id — this case has not been transferred.
    jurisdiction_id: "UK-URBAN-02",
    state: "STAYED_BY_COURT",
    state_since: "2026-07-06T09:00:00Z",
    allowed_transitions: [
      "RESPONSE_WINDOW",
      "DISMISSED_FALSE_POSITIVE",
      "LEGACY_REFERRED",
    ],
    required_artifacts: {
      RESPONSE_WINDOW: [],
      DISMISSED_FALSE_POSITIVE: ["dismissal_reason"],
      LEGACY_REFERRED: ["legacy_reference"],
    },
    events: [
      {
        from_state: null,
        to_state: "NEW",
        actor: "system:detector",
        occurred_at: "2026-07-01T04:10:00Z",
        artifacts: [],
        note: "Case auto-opened from ALT-5003 (amber tier, revenue).",
      },
      {
        from_state: "NEW",
        to_state: "TRIAGED",
        actor: "Deputy Collector S. Iyer",
        occurred_at: "2026-07-01T14:00:00Z",
        artifacts: [],
      },
      {
        from_state: "TRIAGED",
        to_state: "INSPECTION_ASSIGNED",
        actor: "Deputy Collector S. Iyer",
        occurred_at: "2026-07-02T09:00:00Z",
        artifacts: [],
      },
      {
        from_state: "INSPECTION_ASSIGNED",
        to_state: "INSPECTED",
        actor: "Inspector P. Rao",
        occurred_at: "2026-07-03T11:00:00Z",
        artifacts: ["site_inspection_9004.pdf"],
      },
      {
        from_state: "INSPECTED",
        to_state: "SHOW_CAUSE_ISSUED",
        actor: "Deputy Collector S. Iyer",
        occurred_at: "2026-07-04T10:00:00Z",
        artifacts: ["show_cause_notice_9004.pdf"],
      },
      {
        from_state: "SHOW_CAUSE_ISSUED",
        to_state: "RESPONSE_WINDOW",
        actor: "system:workflow",
        occurred_at: "2026-07-06T09:00:00Z",
        artifacts: [],
        note: "Occupant obtained a High Court stay before the response window closed; case paused pending the court's order.",
      },
    ],
  },
  {
    // A RED-tier case that has never been watched or backfilled — exercises
    // the case-imagery "no timeline yet" state (see FIXTURE_CASE_IMAGERY
    // below). ALT-5002/PCL-1008 is RED but, unlike ALT-5001, has no
    // FIXTURE_WATCH_ENTRIES record and no imagery captures at all yet.
    id: "CASE-9005",
    alert_id: "ALT-5002",
    parcel_id: "PCL-1008",
    // Matches PCL-1008's jurisdiction_id — this case has not been transferred.
    jurisdiction_id: "UK-URBAN-01",
    state: "TRIAGED",
    state_since: "2026-06-25T09:30:00Z",
    allowed_transitions: [
      "INSPECTION_ASSIGNED",
      "DISMISSED_FALSE_POSITIVE",
      "LEGACY_REFERRED",
    ],
    required_artifacts: {
      INSPECTION_ASSIGNED: [],
      DISMISSED_FALSE_POSITIVE: ["dismissal_reason"],
      LEGACY_REFERRED: ["legacy_reference"],
    },
    events: [
      {
        from_state: null,
        to_state: "NEW",
        actor: "system:detector",
        occurred_at: "2026-06-24T06:45:00Z",
        artifacts: [],
        note: "Case auto-opened from ALT-5002 (red tier, waterbody).",
      },
      {
        from_state: "NEW",
        to_state: "TRIAGED",
        actor: "Deputy Collector R. Sharma",
        occurred_at: "2026-06-25T09:30:00Z",
        artifacts: [],
      },
    ],
  },
];

// Weekly-snapshot watchlist fixtures. Both watched alerts are RED tier
// (ALT-5001/PCL-1001, ALT-5002/PCL-1008 — see FIXTURE_ALERTS), matching the
// "only RED alerts are watchable" rule. ALT-5001's capture history is the
// illustrative one: it deliberately includes every week state the timeline
// must render distinctly — captured (varying cloud %), a too-cloudy
// no_usable_scene week, a no-coverage no_usable_scene week, a
// provider_error week, and a due-but-not-yet-attempted current week. The
// gaps are not blank; each carries a real reason, because an unexplained
// hole in the evidence record is worse than a stated one.
//
// Every captured week below sets `image_url: null` deliberately, even
// though `status: "captured"`. Fixture/demo mode has no server behind it,
// so there is nothing that could actually serve scene bytes at any URL —
// pointing these at a fake URL would render a broken <img> in demo mode.
// WeeklySnapshotTimeline renders `image_url: null` on a captured week as
// the explicit "hash on record, image not retained" state, which is also
// literally true here: only the sha256 is fixture data, not the bytes it
// hashes.
export const FIXTURE_WATCH_ENTRIES: WatchEntry[] = [
  {
    alert_id: "ALT-5001",
    parcel_id: "PCL-1001",
    started_on: "2026-06-01",
    cadence: "weekly",
    watched_by: "Enforcement Officer, Haridwar",
    captures: [
      {
        week: "2026-W23",
        status: "captured",
        attempted_at: "2026-06-01T06:15:00Z",
        scene_id: "S2A_MSIL2A_20260601T051651_R000_T44RNA",
        sha256: "e57738c57fbbf69c54a29e1f16142c3d44b54990cd3ec625158fd01c63a973d",
        cloud_pct: 8.5,
        reason: null,
        image_url: null,
      },
      {
        week: "2026-W24",
        status: "captured",
        attempted_at: "2026-06-08T06:10:00Z",
        scene_id: "S2B_MSIL2A_20260608T051649_R000_T44RNA",
        sha256: "6f8194b1d3adfcb6f8d2542e43d5b5f019e14b142903d90a89da0a192d7e567",
        cloud_pct: 22.0,
        reason: null,
        image_url: null,
      },
      {
        week: "2026-W25",
        status: "no_usable_scene",
        attempted_at: "2026-06-15T06:20:00Z",
        scene_id: null,
        sha256: null,
        cloud_pct: 78.0,
        reason:
          "Cloud cover 78.0% exceeds the 40.0% usability threshold for this week's pass.",
        image_url: null,
      },
      {
        week: "2026-W26",
        status: "captured",
        attempted_at: "2026-06-22T06:05:00Z",
        scene_id: "S2A_MSIL2A_20260622T051651_R000_T44RNA",
        sha256: "464be070d5771986b44f4629c3f9174532d054affdd3b2cb734c19b6ab93476",
        cloud_pct: 15.0,
        reason: null,
        image_url: null,
      },
      {
        week: "2026-W27",
        status: "provider_error",
        attempted_at: "2026-06-29T06:12:00Z",
        scene_id: null,
        sha256: null,
        cloud_pct: null,
        reason:
          "Provider request failed: Copernicus Data Space token endpoint returned 503 Service Unavailable.",
        image_url: null,
      },
      {
        week: "2026-W28",
        status: "captured",
        attempted_at: "2026-07-06T06:08:00Z",
        scene_id: "S2B_MSIL2A_20260706T051649_R000_T44RNA",
        sha256: "140f480f450cd43892c9c16689555907834d71961e5f8c1ff4759547696ed3",
        cloud_pct: 30.0,
        reason: null,
        image_url: null,
      },
      {
        week: "2026-W29",
        status: "captured",
        attempted_at: "2026-07-13T06:14:00Z",
        scene_id: "S2A_MSIL2A_20260713T051651_R000_T44RNA",
        sha256: "c9d42a6749a9bd7ce0e04d09f48742666767874f81ae10ccabf0a9921575b03",
        cloud_pct: 12.0,
        reason: null,
        image_url: null,
      },
      {
        week: "2026-W30",
        status: "no_usable_scene",
        attempted_at: "2026-07-20T06:18:00Z",
        scene_id: null,
        sha256: null,
        cloud_pct: null,
        reason:
          "No Sentinel-2 scene intersects this parcel's footprint within the 2026-07-20–2026-07-26 catalog window.",
        image_url: null,
      },
    ],
    due_weeks: ["2026-W31"],
  },
  {
    // A watch that only just started: one clean capture, one week due. Shows
    // the timeline's early state, not just a long-running one.
    alert_id: "ALT-5002",
    parcel_id: "PCL-1008",
    started_on: "2026-07-20",
    cadence: "weekly",
    watched_by: "Enforcement Officer, Haridwar",
    captures: [
      {
        week: "2026-W30",
        status: "captured",
        attempted_at: "2026-07-20T06:05:00Z",
        scene_id: "S2A_MSIL2A_20260720T051651_R000_T44RNA",
        sha256: "773f8f6cabd790f4e5a48d5112c9fc91c89af553109db8213daff1932733d7c",
        cloud_pct: 5.0,
        reason: null,
        image_url: null,
      },
    ],
    due_weeks: ["2026-W31"],
  },
];

// Case imagery backfill fixtures (contract-backfill.md addendum). One
// CaseImagery per case_id, mirroring the same underlying alert timeline
// that FIXTURE_WATCH_ENTRIES exposes for the weekly-snapshot slice — per the
// contract, backfill extends that one record backwards rather than creating
// a second parallel one, so CASE-9001's captures for 2026-W23 onward match
// FIXTURE_WATCH_ENTRIES[0] (ALT-5001) exactly, with earlier weeks appended
// by a (fixture) backfill run.
export const CASE_IMAGERY_BACKFILL_FLOOR = "2026-01-01";

/** Deterministic stand-in for a sha256 digest, seeded per week so each
 * backfilled capture gets a distinct, plausible-looking hash without
 * hand-typing dozens of them. Not a real hash — content is irrelevant, only
 * that it is stable and unique per seed. */
function demoDigest(seed: string): string {
  let state = 0;
  for (let i = 0; i < seed.length; i += 1) {
    state = (state * 31 + seed.charCodeAt(i)) >>> 0;
  }
  let hex = "";
  while (hex.length < 64) {
    state = (Math.imul(state, 1103515245) + 12345) >>> 0;
    hex += state.toString(16).padStart(8, "0");
  }
  return hex.slice(0, 64);
}

// CASE-9001 / ALT-5001 / PCL-1001 — the illustrative RED case: a partially
// completed backfill. It reaches back to 2026-W11 (9 March 2026), 10 weeks
// short of the 2026-01-01 floor (2026-W01), and the tail (2026-W23 onward)
// is the exact same capture history FIXTURE_WATCH_ENTRIES already exposes
// for ALT-5001 — including its documented gaps (a too-cloudy week at
// 2026-W25, a provider error at 2026-W27, a no-coverage week at 2026-W30).
// The earlier weeks (2026-W11–2026-W22), added by backfill, include two
// more documented gaps of their own — a cloud gap and a no-coverage gap —
// so "honesty about gaps" holds for backfilled history too, not just the
// live-forward one. attempted_at for these earlier weeks is a single recent
// backfill run (1 Aug 2026), distinct from the historical week each scene
// covers, since that is when the backfill actually executed.
const CASE_9001_BACKFILLED_CAPTURES: CaseImagery["captures"] = [
  {
    week: "2026-W11",
    status: "captured",
    attempted_at: "2026-08-01T09:00:00Z",
    scene_id: "S2A_MSIL2A_20260309T051651_R000_T44RNA",
    sha256: demoDigest("PCL-1001-2026-W11"),
    cloud_pct: 9.0,
    reason: null,
    image_url: null,
  },
  {
    week: "2026-W12",
    status: "captured",
    attempted_at: "2026-08-01T09:04:00Z",
    scene_id: "S2B_MSIL2A_20260316T051649_R000_T44RNA",
    sha256: demoDigest("PCL-1001-2026-W12"),
    cloud_pct: 14.0,
    reason: null,
    image_url: null,
  },
  {
    week: "2026-W13",
    status: "captured",
    attempted_at: "2026-08-01T09:08:00Z",
    scene_id: "S2A_MSIL2A_20260323T051651_R000_T44RNA",
    sha256: demoDigest("PCL-1001-2026-W13"),
    cloud_pct: 22.0,
    reason: null,
    image_url: null,
  },
  {
    week: "2026-W14",
    status: "captured",
    attempted_at: "2026-08-01T09:12:00Z",
    scene_id: "S2B_MSIL2A_20260330T051649_R000_T44RNA",
    sha256: demoDigest("PCL-1001-2026-W14"),
    cloud_pct: 18.0,
    reason: null,
    image_url: null,
  },
  {
    week: "2026-W15",
    status: "captured",
    attempted_at: "2026-08-01T09:16:00Z",
    scene_id: "S2A_MSIL2A_20260406T051651_R000_T44RNA",
    sha256: demoDigest("PCL-1001-2026-W15"),
    cloud_pct: 11.0,
    reason: null,
    image_url: null,
  },
  {
    week: "2026-W16",
    status: "no_usable_scene",
    attempted_at: "2026-08-01T09:20:00Z",
    scene_id: null,
    sha256: null,
    cloud_pct: 65.0,
    reason:
      "Cloud cover 65.0% exceeds the 40.0% usability threshold for this week's pass.",
    image_url: null,
  },
  {
    week: "2026-W17",
    status: "captured",
    attempted_at: "2026-08-01T09:24:00Z",
    scene_id: "S2A_MSIL2A_20260420T051651_R000_T44RNA",
    sha256: demoDigest("PCL-1001-2026-W17"),
    cloud_pct: 16.0,
    reason: null,
    image_url: null,
  },
  {
    week: "2026-W18",
    status: "captured",
    attempted_at: "2026-08-01T09:28:00Z",
    scene_id: "S2B_MSIL2A_20260427T051649_R000_T44RNA",
    sha256: demoDigest("PCL-1001-2026-W18"),
    cloud_pct: 24.0,
    reason: null,
    image_url: null,
  },
  {
    week: "2026-W19",
    status: "captured",
    attempted_at: "2026-08-01T09:32:00Z",
    scene_id: "S2A_MSIL2A_20260504T051651_R000_T44RNA",
    sha256: demoDigest("PCL-1001-2026-W19"),
    cloud_pct: 10.0,
    reason: null,
    image_url: null,
  },
  {
    week: "2026-W20",
    status: "no_usable_scene",
    attempted_at: "2026-08-01T09:36:00Z",
    scene_id: null,
    sha256: null,
    cloud_pct: null,
    reason:
      "No Sentinel-2 scene intersects this parcel's footprint within the 2026-05-11–2026-05-17 catalog window.",
    image_url: null,
  },
  {
    week: "2026-W21",
    status: "captured",
    attempted_at: "2026-08-01T09:40:00Z",
    scene_id: "S2A_MSIL2A_20260518T051651_R000_T44RNA",
    sha256: demoDigest("PCL-1001-2026-W21"),
    cloud_pct: 13.0,
    reason: null,
    image_url: null,
  },
  {
    week: "2026-W22",
    status: "captured",
    attempted_at: "2026-08-01T09:44:00Z",
    scene_id: "S2B_MSIL2A_20260525T051649_R000_T44RNA",
    sha256: demoDigest("PCL-1001-2026-W22"),
    cloud_pct: 27.0,
    reason: null,
    image_url: null,
  },
];

export const FIXTURE_CASE_IMAGERY: Record<string, CaseImagery> = {
  "CASE-9001": {
    case_id: "CASE-9001",
    alert_id: "ALT-5001",
    parcel_id: "PCL-1001",
    alert_tier: "RED",
    watchable: true,
    started_on: "2026-03-09", // Monday of 2026-W11
    cadence: "weekly",
    captures: [
      ...CASE_9001_BACKFILLED_CAPTURES,
      ...FIXTURE_WATCH_ENTRIES[0].captures, // 2026-W23 – 2026-W30, same record
    ],
    due_weeks: FIXTURE_WATCH_ENTRIES[0].due_weeks, // ["2026-W31"]
    backfill_floor: CASE_IMAGERY_BACKFILL_FLOOR,
    // 2026-W01 through 2026-W10 (10 weeks) precede started_on and have not
    // been backfilled yet — the "continue backfill" state.
    remaining_backfill_weeks: 10,
  },
  "CASE-9002": {
    // ALT-5004 is GREEN tier — demonstrates the non-RED case: backfill is
    // never offered, and the UI must explain why rather than showing a
    // control that would 422 at the backend.
    case_id: "CASE-9002",
    alert_id: "ALT-5004",
    parcel_id: "PCL-1006",
    alert_tier: "GREEN",
    watchable: false,
    started_on: null,
    cadence: "weekly",
    captures: [],
    due_weeks: [],
    backfill_floor: CASE_IMAGERY_BACKFILL_FLOOR,
    remaining_backfill_weeks: 0,
  },
  "CASE-9005": {
    // ALT-5002 is RED but has never been watched or backfilled — the "no
    // timeline yet" state. All 31 weeks from the floor (2026-W01) through
    // the current week (2026-W31) remain to be backfilled.
    case_id: "CASE-9005",
    alert_id: "ALT-5002",
    parcel_id: "PCL-1008",
    alert_tier: "RED",
    watchable: true,
    started_on: null,
    cadence: "weekly",
    captures: [],
    due_weeks: [],
    backfill_floor: CASE_IMAGERY_BACKFILL_FLOOR,
    remaining_backfill_weeks: 31,
  },
};

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

const LEGAL_OFFICER_CAPABILITIES = [
  "Record hearings as held, issue orders, record court stays",
  "Dismiss, refer, or close a case",
  "Cannot upgrade boundary grades",
];

// Mirrors the 10 demo personas served by GET /demo/personas so the personas
// page, landing-page jurisdiction picker, and PersonaCard can be exercised
// without a backend. Fixture cards remain non-interactive: only the live
// demo login endpoint may mint a scoped bearer token.
export const FIXTURE_PERSONAS: Persona[] = [
  {
    id: "vc-hrda",
    name: "Vice Chairman, HRDA",
    role: "viewer",
    jurisdiction_id: "state",
    jurisdiction_name: "Haridwar–Roorkee Development Authority",
    authority_id: "state",
    authority_name: "Haridwar–Roorkee Development Authority",
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
    authority_id: "state",
    authority_name: "Haridwar–Roorkee Development Authority",
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
    authority_id: "state",
    authority_name: "Haridwar–Roorkee Development Authority",
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
    authority_id: "state",
    authority_name: "Haridwar–Roorkee Development Authority",
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
    authority_id: "state",
    authority_name: "Haridwar–Roorkee Development Authority",
    description:
      "Maintains parcel records and tags across the authority; does not act on cases.",
    visible_parcels: 30,
    capabilities: DATA_ADMIN_CAPABILITIES,
  },
  {
    id: "legal-hrda",
    name: "Legal Officer, HRDA",
    role: "legal_officer",
    jurisdiction_id: "state",
    jurisdiction_name: "Haridwar–Roorkee Development Authority",
    authority_id: "state",
    authority_name: "Haridwar–Roorkee Development Authority",
    description:
      "Holds legal authority across the whole Haridwar–Roorkee authority. Alone can record a hearing as held, issue an order, record a court stay, or end a case (dismissal, legacy referral, or closure).",
    visible_parcels: 30,
    capabilities: LEGAL_OFFICER_CAPABILITIES,
  },
  {
    id: "collector-alappuzha",
    name: "District Collector, Alappuzha",
    role: "viewer",
    jurisdiction_id: "dist-alappuzha",
    jurisdiction_name: "Alappuzha District",
    authority_id: "state-kl",
    authority_name: "Government of Kerala",
    description:
      "Sees Alappuzha district's estate with read-only visibility across its parcels, alerts, and cases.",
    visible_parcels: 5,
    capabilities: VIEWER_CAPABILITIES,
  },
  {
    id: "co-ambalapuzha",
    name: "Taluk Officer, Ambalapuzha",
    role: "case_officer",
    jurisdiction_id: "taluk-ambalapuzha",
    jurisdiction_name: "Ambalapuzha Taluk",
    authority_id: "state-kl",
    authority_name: "Government of Kerala",
    description:
      "Runs encroachment cases for Ambalapuzha taluk without visibility into other authorities.",
    visible_parcels: 5,
    capabilities: CASE_OFFICER_CAPABILITIES,
  },
  {
    id: "collector-pune",
    name: "District Collector, Pune",
    role: "viewer",
    jurisdiction_id: "dist-pune",
    jurisdiction_name: "Pune District",
    authority_id: "state-mh",
    authority_name: "Government of Maharashtra",
    description:
      "Sees the Pune demo estate with read-only visibility across both seeded taluks.",
    visible_parcels: 7,
    capabilities: VIEWER_CAPABILITIES,
  },
  {
    id: "co-haveli",
    name: "Taluk Officer, Haveli",
    role: "case_officer",
    jurisdiction_id: "taluk-haveli",
    jurisdiction_name: "Haveli Taluk",
    authority_id: "state-mh",
    authority_name: "Government of Maharashtra",
    description:
      "Runs encroachment cases for Haveli taluk without visibility into other authorities.",
    visible_parcels: 4,
    capabilities: CASE_OFFICER_CAPABILITIES,
  },
];

// Mirrors the demo jurisdiction tree served by GET /jurisdictions (see
// backend/src/mapencroach/api/store.py's JURISDICTION_NAMES and
// Store.seed_demo's jurisdiction_rows) so the transfer-target picker can be
// exercised without a backend.
// Mirrors the backend seed tree in store.py (JURISDICTION_NAMES + seed_demo
// rows), in the same stored order that GET /jurisdictions returns, so the
// transfer dropdown shows the same options in fixture/no-backend mode as it
// does against a live backend. The synthetic "deployment" root exists only
// because the backend JurisdictionTree is single-rooted by construction while
// the three authorities below it are genuine peers.
export const FIXTURE_JURISDICTIONS: Jurisdiction[] = [
  { id: "deployment", name: "mapencroach demo deployment", parent_id: null },
  { id: "state", name: "Haridwar–Roorkee Development Authority", parent_id: "deployment" },
  { id: "dist-a", name: "Haridwar Division", parent_id: "state" },
  { id: "dist-b", name: "Roorkee Division", parent_id: "state" },
  { id: "taluk-a1", name: "Haridwar City", parent_id: "dist-a" },
  { id: "taluk-a2", name: "Kankhal", parent_id: "dist-a" },
  { id: "taluk-a3", name: "Laksar", parent_id: "dist-a" },
  { id: "taluk-b1", name: "Roorkee City", parent_id: "dist-b" },
  { id: "taluk-b2", name: "Bahadarabad", parent_id: "dist-b" },
  { id: "taluk-b3", name: "Narsan", parent_id: "dist-b" },
  { id: "state-kl", name: "Government of Kerala", parent_id: "deployment" },
  { id: "dist-alappuzha", name: "Alappuzha District", parent_id: "state-kl" },
  { id: "taluk-ambalapuzha", name: "Ambalapuzha Taluk", parent_id: "dist-alappuzha" },
  { id: "state-mh", name: "Government of Maharashtra", parent_id: "deployment" },
  { id: "dist-pune", name: "Pune District", parent_id: "state-mh" },
  { id: "taluk-haveli", name: "Haveli Taluk", parent_id: "dist-pune" },
  { id: "taluk-mulshi", name: "Mulshi Taluk", parent_id: "dist-pune" },
];
