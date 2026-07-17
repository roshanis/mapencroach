import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { KpiStrip } from "./KpiStrip";
import type { Alert, Case, Parcel } from "@/lib/types";

function makeParcel(id: string): Parcel {
  return {
    id,
    survey_no: "44/2",
    ulpin: `UL-${id}`,
    owning_department: "Water Resources Department",
    land_category: "waterbody",
    boundary_grade: "A",
    jurisdiction_id: "UK-URBAN-01",
    geometry: {
      type: "Polygon",
      coordinates: [
        [
          [77.979, 29.913],
          [77.98, 29.913],
          [77.98, 29.914],
          [77.979, 29.914],
          [77.979, 29.913],
        ],
      ],
    },
    centroid: [77.979, 29.913],
    tags: [],
  };
}

function makeAlert(
  id: string,
  tier: Alert["tier"],
  status: Alert["status"]
): Alert {
  return {
    id,
    parcel_id: "PCL-1",
    tier,
    severity_score: 50,
    area_m2: 100,
    status,
    detected_at: "2026-01-01T00:00:00Z",
  };
}

function makeCase(id: string, state: Case["state"]): Case {
  return {
    id,
    alert_id: "ALT-1",
    parcel_id: "PCL-1",
    state,
    events: [],
  };
}

const PARCELS: Parcel[] = [
  makeParcel("PCL-1001"),
  makeParcel("PCL-1002"),
  makeParcel("PCL-1003"),
];

// 6 alerts: 3 open (1 red, 1 amber, 1 green), 3 not-open (1 escalated red,
// 1 under_review amber, 1 closed green).
// Open alerts = 3. Red alerts (any status) = 2. Distinct from parcels.length (3)
// only for red alerts count would collide with parcels.length, so make it 2
// to be unambiguous vs parcels.length=3 and open=3.
const ALERTS: Alert[] = [
  makeAlert("ALT-1", "red", "open"),
  makeAlert("ALT-2", "amber", "open"),
  makeAlert("ALT-3", "green", "open"),
  makeAlert("ALT-4", "red", "escalated"),
  makeAlert("ALT-5", "amber", "under_review"),
  makeAlert("ALT-6", "green", "closed"),
];

// Cases: one CLOSED, one DISMISSED_FALSE_POSITIVE, and several in-progress
// states — "in due process" should be everything except CLOSED and
// DISMISSED_FALSE_POSITIVE (and LEGACY_REFERRED, not present here).
const CASES: Case[] = [
  makeCase("CASE-1", "CLOSED"),
  makeCase("CASE-2", "DISMISSED_FALSE_POSITIVE" as Case["state"]),
  makeCase("CASE-3", "SHOW_CAUSE_ISSUED"),
  makeCase("CASE-4", "RESPONSE_WINDOW"),
  makeCase("CASE-5", "NEW"),
];

describe("KpiStrip", () => {
  it("renders the root container with the expected testid", () => {
    render(<KpiStrip parcels={PARCELS} alerts={ALERTS} cases={CASES} />);
    expect(screen.getByTestId("kpi-strip")).toBeInTheDocument();
  });

  it("shows all four labels", () => {
    render(<KpiStrip parcels={PARCELS} alerts={ALERTS} cases={CASES} />);
    expect(screen.getByText("Parcels monitored")).toBeInTheDocument();
    expect(screen.getByText("Needs triage")).toBeInTheDocument();
    expect(screen.getByText("Urgent alerts")).toBeInTheDocument();
    expect(screen.getByText("Cases in due process")).toBeInTheDocument();
  });

  it("computes parcels monitored as parcels.length", () => {
    render(<KpiStrip parcels={PARCELS} alerts={ALERTS} cases={CASES} />);
    expect(screen.getByTestId("kpi-parcels-monitored")).toHaveTextContent(
      "3"
    );
  });

  it("computes open alerts as count of status === open", () => {
    render(<KpiStrip parcels={PARCELS} alerts={ALERTS} cases={CASES} />);
    expect(screen.getByTestId("kpi-open-alerts")).toHaveTextContent("3");
  });

  it("computes urgent alerts as unresolved red alerts", () => {
    render(<KpiStrip parcels={PARCELS} alerts={ALERTS} cases={CASES} />);
    // 2 red alerts total: one open, one escalated.
    expect(screen.getByTestId("kpi-red-alerts")).toHaveTextContent("2");
  });

  it("does not count a closed red alert as urgent", () => {
    const alertsWithClosedRed: Alert[] = [
      ...ALERTS,
      makeAlert("ALT-7", "red", "closed"),
    ];
    render(
      <KpiStrip parcels={PARCELS} alerts={alertsWithClosedRed} cases={CASES} />
    );
    expect(screen.getByTestId("kpi-red-alerts")).toHaveTextContent("2");
  });

  it("computes cases in due process excluding CLOSED, DISMISSED_FALSE_POSITIVE, LEGACY_REFERRED", () => {
    render(<KpiStrip parcels={PARCELS} alerts={ALERTS} cases={CASES} />);
    // 5 cases total, minus CLOSED and DISMISSED_FALSE_POSITIVE = 3 in due process.
    expect(screen.getByTestId("kpi-cases-in-due-process")).toHaveTextContent(
      "3"
    );
  });

  it("excludes LEGACY_REFERRED cases from the due-process count", () => {
    const casesWithLegacy: Case[] = [
      ...CASES,
      makeCase("CASE-6", "LEGACY_REFERRED" as Case["state"]),
    ];
    render(
      <KpiStrip parcels={PARCELS} alerts={ALERTS} cases={casesWithLegacy} />
    );
    // Still 3 — LEGACY_REFERRED does not count as in due process.
    expect(screen.getByTestId("kpi-cases-in-due-process")).toHaveTextContent(
      "3"
    );
  });

  it("handles empty arrays without crashing, all zeros", () => {
    render(<KpiStrip parcels={[]} alerts={[]} cases={[]} />);
    expect(screen.getByTestId("kpi-parcels-monitored")).toHaveTextContent(
      "0"
    );
    expect(screen.getByTestId("kpi-open-alerts")).toHaveTextContent("0");
    expect(screen.getByTestId("kpi-red-alerts")).toHaveTextContent("0");
    expect(screen.getByTestId("kpi-cases-in-due-process")).toHaveTextContent(
      "0"
    );
  });
});
