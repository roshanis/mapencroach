import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { AlertsTable } from "./AlertsTable";
import {
  ALERT_STATUS_DESCRIPTIONS,
  SEVERITY_EXPLANATION,
} from "@/lib/explanations";
import type { Alert, Case, Parcel } from "@/lib/types";

// Kept in the next/navigation mock (though unused by AlertsTable now) so a
// regression back to router.replace — the per-keystroke RSC re-fetch this
// suite guards against — would be caught below.
const replaceMock = vi.fn();
let currentSearchParams = new URLSearchParams();

vi.mock("next/navigation", () => ({
  usePathname: () => "/alerts",
  useSearchParams: () => currentSearchParams,
  useRouter: () => ({ replace: replaceMock }),
}));

afterEach(() => {
  replaceMock.mockReset();
  currentSearchParams = new URLSearchParams();
  vi.restoreAllMocks();
});

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
    // Scoped to the desktop <table>: the mobile card list also labels a
    // field "Severity", so an unscoped query would be ambiguous.
    const table = screen.getByRole("table");
    const header = within(table).getByText("Severity");
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
    const replaceStateSpy = vi.spyOn(window.history, "replaceState");
    render(<AlertsTable alerts={ALERTS} />);

    expect(screen.getByRole("option", { name: "Open (1)" })).toBeInTheDocument();
    fireEvent.change(screen.getByTestId("status-filter"), {
      target: { value: "escalated" },
    });

    expect(replaceStateSpy).toHaveBeenCalledWith(
      null,
      "",
      "/alerts?status=escalated"
    );
    // No RSC navigation — that would force a full server re-fetch.
    expect(replaceMock).not.toHaveBeenCalled();
  });

  it("persists every keystroke in the search box via history.replaceState, never a router navigation (avoids refetching the list per keystroke)", () => {
    const replaceStateSpy = vi.spyOn(window.history, "replaceState");
    render(<AlertsTable alerts={ALERTS} />);

    const input = screen.getByRole("searchbox", { name: "Search alerts" });
    fireEvent.change(input, { target: { value: "P" } });
    fireEvent.change(input, { target: { value: "PC" } });
    fireEvent.change(input, { target: { value: "PCL" } });

    expect(replaceStateSpy).toHaveBeenCalledTimes(3);
    expect(replaceStateSpy).toHaveBeenLastCalledWith(null, "", "/alerts?q=PCL");
    expect(replaceMock).not.toHaveBeenCalled();
  });

  it("uses real parcel links instead of pointer-only table rows", () => {
    render(<AlertsTable alerts={ALERTS} />);

    const table = screen.getByRole("table");
    expect(within(table).getByRole("link", { name: "PCL-1" })).toHaveAttribute(
      "href",
      "/parcels/PCL-1"
    );
  });

  it("falls back to 'all' for an unrecognized ?tier= value instead of a blank select and a silently empty table", () => {
    currentSearchParams = new URLSearchParams("tier=bogus");
    render(<AlertsTable alerts={ALERTS} />);

    expect(screen.getByTestId("tier-filter")).toHaveValue("all");
    expect(screen.getAllByTestId("alert-row")).toHaveLength(ALERTS.length);
    expect(
      screen.getByText(`Showing ${ALERTS.length} of ${ALERTS.length} alerts`)
    ).toBeInTheDocument();
  });

  it("falls back to 'all' for an unrecognized ?status= value", () => {
    currentSearchParams = new URLSearchParams("status=bogus");
    render(<AlertsTable alerts={ALERTS} />);

    expect(screen.getByTestId("status-filter")).toHaveValue("all");
    expect(screen.getAllByTestId("alert-row")).toHaveLength(ALERTS.length);
  });

  it("still honors a valid ?tier= value", () => {
    currentSearchParams = new URLSearchParams("tier=red");
    render(<AlertsTable alerts={ALERTS} />);

    expect(screen.getByTestId("tier-filter")).toHaveValue("red");
    expect(screen.getAllByTestId("alert-row")).toHaveLength(1);
  });
});

describe("AlertsTable — mobile card presentation", () => {
  it("renders one card per alert alongside the table rows, from the same filtered data", () => {
    render(<AlertsTable alerts={ALERTS} />);

    const rows = screen.getAllByTestId("alert-row");
    const cards = screen.getAllByTestId("alert-card");
    expect(rows).toHaveLength(ALERTS.length);
    expect(cards).toHaveLength(ALERTS.length);
    expect(cards.map((c) => c.getAttribute("data-alert-id"))).toEqual(
      rows.map((r) => r.getAttribute("data-alert-id"))
    );
  });

  it("keeps every column's information reachable in the card layout — tier, parcel, severity, area, status, and age", () => {
    render(<AlertsTable alerts={ALERTS} />);

    const card = screen
      .getAllByTestId("alert-card")
      .find((c) => c.getAttribute("data-alert-id") === "ALT-1")!;

    expect(within(card).getByTestId("tier-chip")).toHaveTextContent("Red");
    expect(within(card).getByRole("link", { name: "PCL-1" })).toHaveAttribute(
      "href",
      "/parcels/PCL-1"
    );
    expect(within(card).getByText("92")).toBeInTheDocument(); // severity
    expect(within(card).getByText((1000).toLocaleString())).toBeInTheDocument(); // area
    const statusValue = within(card).getByText("open");
    expect(statusValue).toHaveAttribute("title", ALERT_STATUS_DESCRIPTIONS.open);
    expect(card).toHaveTextContent("ago"); // age (relative, e.g. "Xd ago")
  });

  it("filters the card list the same way it filters the table", () => {
    render(<AlertsTable alerts={ALERTS} />);

    fireEvent.change(screen.getByRole("searchbox", { name: "Search alerts" }), {
      target: { value: "PCL-2" },
    });

    const cards = screen.getAllByTestId("alert-card");
    expect(cards).toHaveLength(1);
    expect(cards[0]).toHaveAttribute("data-alert-id", "ALT-2");
  });

  it("shows the same no-results message in the card list as the table when filters exclude everything", () => {
    render(<AlertsTable alerts={ALERTS} />);

    fireEvent.change(screen.getByRole("searchbox", { name: "Search alerts" }), {
      target: { value: "no-such-alert" },
    });

    expect(screen.queryAllByTestId("alert-card")).toHaveLength(0);
    // "No alerts match..." appears once in the table body and once in the
    // card list fallback.
    expect(screen.getAllByText("No alerts match the current filters.")).toHaveLength(2);
  });
});

describe("AlertsTable — actions column", () => {
  const CASES: Case[] = [
    {
      id: "CASE-1",
      alert_id: "ALT-1",
      parcel_id: "PCL-1",
      jurisdiction_id: "UK-URBAN-01",
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

    // Scoped to the desktop <table>: the mobile card also renders a Case
    // action link for the same alert, so an unscoped query would be
    // ambiguous.
    const table = screen.getByRole("table");
    expect(
      within(table).getByRole("link", { name: "Case" })
    ).toHaveAttribute("href", "/cases/CASE-1");
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

    // Scoped to the desktop <table>: the mobile card renders the same
    // resolved parcel label and secondary line, so an unscoped query would
    // be ambiguous.
    const table = screen.getByRole("table");
    expect(
      within(table).getByRole("link", { name: "SN-101" })
    ).toHaveAttribute("href", "/parcels/PCL-1");
    expect(within(table).getByText("Waterbody · Grade A")).toBeInTheDocument();
  });

  it("falls back to the raw parcel id when no matching parcel is found", () => {
    render(<AlertsTable alerts={ALERTS_WITH_PARCELS} parcels={PARCELS} />);

    const table = screen.getByRole("table");
    expect(
      within(table).getByRole("link", { name: "PCL-999" })
    ).toHaveAttribute("href", "/parcels/PCL-999");
  });

  it("rounds the severity score to a whole number", () => {
    render(<AlertsTable alerts={ALERTS_WITH_PARCELS} parcels={PARCELS} />);

    const table = screen.getByRole("table");
    expect(within(table).getByText("42")).toBeInTheDocument();
    expect(screen.queryByText("41.6")).not.toBeInTheDocument();
  });

  it("renders a decorative severity bar tinted by tier, with the number as the accessible value", () => {
    render(<AlertsTable alerts={ALERTS_WITH_PARCELS} parcels={PARCELS} />);

    // Scoped to the desktop <table>: the mobile card renders its own
    // severity bar per alert too (2 alerts x 2 presentations = 4 total), so
    // this checks the table's copy specifically.
    const table = screen.getByRole("table");
    const bars = within(table).getAllByTestId("severity-bar");
    expect(bars).toHaveLength(2);
    bars.forEach((bar) => expect(bar).toHaveAttribute("aria-hidden", "true"));

    const amberBar = bars.find((bar) => bar.getAttribute("data-tier") === "amber");
    const amberFill = amberBar?.querySelector("span");
    expect(amberFill?.className).toContain("bg-tier-amber");
    expect((amberFill as HTMLElement)?.style.width).toBe("41.6%");
  });
});
