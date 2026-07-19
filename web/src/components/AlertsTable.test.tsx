import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { AlertsTable } from "./AlertsTable";
import {
  ALERT_STATUS_DESCRIPTIONS,
  SEVERITY_EXPLANATION,
} from "@/lib/explanations";
import type { Alert, Case, Parcel } from "@/lib/types";

const replaceMock = vi.fn();

vi.mock("next/navigation", () => ({
  usePathname: () => "/alerts",
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ replace: replaceMock }),
}));

const ALERTS: Alert[] = [
  {
    id: "ALT-1",
    parcel_id: "PCL-1",
    tier: "red",
    severity_score: 92,
    area_m2: 1000,
    status: "open",
    detected_at: "2026-06-01T00:00:00Z",
  },
  {
    id: "ALT-2",
    parcel_id: "PCL-2",
    tier: "amber",
    severity_score: 50,
    area_m2: 500,
    status: "escalated",
    detected_at: "2026-06-02T00:00:00Z",
  },
];

describe("AlertsTable — explainability (WP6)", () => {
  it("sets a title on the Severity header cell explaining the scoring formula", () => {
    render(<AlertsTable alerts={ALERTS} />);
    const header = screen.getByText("Severity");
    expect(header).toHaveAttribute("title", SEVERITY_EXPLANATION);
  });

  it("sets a title on each status cell from ALERT_STATUS_DESCRIPTIONS", () => {
    render(<AlertsTable alerts={ALERTS} />);
    const openCell = screen.getByText("open", { selector: "td" });
    expect(openCell).toHaveAttribute(
      "title",
      ALERT_STATUS_DESCRIPTIONS.open
    );
    const escalatedCell = screen.getByText("escalated", { selector: "td" });
    expect(escalatedCell).toHaveAttribute(
      "title",
      ALERT_STATUS_DESCRIPTIONS.escalated
    );
  });

  it("renders a footnote under the table with the severity explanation", () => {
    render(<AlertsTable alerts={ALERTS} />);
    expect(screen.getByTestId("severity-footnote")).toHaveTextContent(
      SEVERITY_EXPLANATION
    );
    expect(screen.getByTestId("severity-footnote").className).toContain(
      "text-gray-400"
    );
  });

  it("searches by alert or parcel id and reports the result count", () => {
    render(<AlertsTable alerts={ALERTS} />);

    fireEvent.change(screen.getByRole("searchbox", { name: "Search alerts" }), {
      target: { value: "PCL-2" },
    });

    expect(screen.getAllByTestId("alert-row")).toHaveLength(1);
    expect(screen.getByText("Showing 1 of 2 alerts")).toBeInTheDocument();
  });

  it("shows filter counts and persists filters in the URL", () => {
    render(<AlertsTable alerts={ALERTS} />);

    expect(screen.getByRole("option", { name: "Open (1)" })).toBeInTheDocument();
    fireEvent.change(screen.getByTestId("status-filter"), {
      target: { value: "escalated" },
    });

    expect(replaceMock).toHaveBeenCalledWith(
      "/alerts?status=escalated",
      { scroll: false }
    );
  });

  it("uses real parcel links instead of pointer-only table rows", () => {
    render(<AlertsTable alerts={ALERTS} />);

    expect(screen.getByRole("link", { name: "PCL-1" })).toHaveAttribute(
      "href",
      "/parcels/PCL-1"
    );
  });
});

describe("AlertsTable — actions column", () => {
  const CASES: Case[] = [
    {
      id: "CASE-1",
      alert_id: "ALT-1",
      parcel_id: "PCL-1",
      state: "NEW",
      events: [],
    },
  ];

  it("links each row's parcel-record action to the parcel detail page", () => {
    render(<AlertsTable alerts={ALERTS} />);

    expect(
      screen.getAllByRole("link", { name: "Parcel record" })[0]
    ).toHaveAttribute("href", "/parcels/PCL-1");
  });

  it("links the view-on-map action to the console deep link for that alert", () => {
    render(<AlertsTable alerts={ALERTS} />);

    expect(
      screen.getAllByRole("link", { name: "View on map" })[0]
    ).toHaveAttribute("href", "/console?alert=ALT-1");
  });

  it("shows a Case action link only when a case exists for the alert", () => {
    const casesByAlertId = new Map(CASES.map((item) => [item.alert_id, item]));
    render(<AlertsTable alerts={ALERTS} casesByAlertId={casesByAlertId} />);

    expect(screen.getByRole("link", { name: "Case" })).toHaveAttribute(
      "href",
      "/cases/CASE-1"
    );
  });

  it("omits the Case action link when no case mapping is provided", () => {
    render(<AlertsTable alerts={ALERTS} />);

    expect(screen.queryByRole("link", { name: "Case" })).not.toBeInTheDocument();
  });
});

describe("AlertsTable — parcel humanization and severity display", () => {
  const PARCELS: Parcel[] = [
    {
      id: "PCL-1",
      survey_no: "SN-101",
      ulpin: "UL-1",
      owning_department: "Water Resources Department",
      land_category: "waterbody",
      boundary_grade: "A",
      jurisdiction_id: "UK-URBAN-01",
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [0, 0],
            [0, 1],
            [1, 1],
            [1, 0],
            [0, 0],
          ],
        ],
      },
      centroid: [0, 0],
      tags: [],
    },
  ];

  const ALERTS_WITH_PARCELS: Alert[] = [
    {
      id: "ALT-10",
      parcel_id: "PCL-1",
      tier: "amber",
      severity_score: 41.6,
      area_m2: 200,
      status: "open",
      detected_at: "2026-06-01T00:00:00Z",
    },
    {
      id: "ALT-11",
      parcel_id: "PCL-999",
      tier: "red",
      severity_score: 80,
      area_m2: 300,
      status: "open",
      detected_at: "2026-06-02T00:00:00Z",
    },
  ];

  it("renders survey no, land category, and grade for a matched parcel, keeping the link target on the parcel id", () => {
    render(<AlertsTable alerts={ALERTS_WITH_PARCELS} parcels={PARCELS} />);

    expect(screen.getByRole("link", { name: "SN-101" })).toHaveAttribute(
      "href",
      "/parcels/PCL-1"
    );
    expect(screen.getByText("Waterbody · Grade A")).toBeInTheDocument();
  });

  it("falls back to the raw parcel id when no matching parcel is found", () => {
    render(<AlertsTable alerts={ALERTS_WITH_PARCELS} parcels={PARCELS} />);

    expect(screen.getByRole("link", { name: "PCL-999" })).toHaveAttribute(
      "href",
      "/parcels/PCL-999"
    );
  });

  it("rounds the severity score to a whole number", () => {
    render(<AlertsTable alerts={ALERTS_WITH_PARCELS} parcels={PARCELS} />);

    expect(screen.getByText("42")).toBeInTheDocument();
    expect(screen.queryByText("41.6")).not.toBeInTheDocument();
  });

  it("renders a decorative severity bar tinted by tier, with the number as the accessible value", () => {
    const { container } = render(
      <AlertsTable alerts={ALERTS_WITH_PARCELS} parcels={PARCELS} />
    );

    const bars = screen.getAllByTestId("severity-bar");
    expect(bars).toHaveLength(2);
    bars.forEach((bar) => expect(bar).toHaveAttribute("aria-hidden", "true"));

    const amberFill = container.querySelector(
      '[data-testid="severity-bar"][data-tier="amber"] > span'
    );
    expect(amberFill?.className).toContain("bg-tier-amber");
    expect((amberFill as HTMLElement)?.style.width).toBe("41.6%");
  });
});
