import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { AlertsTable } from "./AlertsTable";
import {
  ALERT_STATUS_DESCRIPTIONS,
  SEVERITY_EXPLANATION,
} from "@/lib/explanations";
import type { Alert } from "@/lib/types";

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
