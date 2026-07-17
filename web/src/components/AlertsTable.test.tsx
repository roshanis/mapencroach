import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { AlertsTable } from "./AlertsTable";
import {
  ALERT_STATUS_DESCRIPTIONS,
  SEVERITY_EXPLANATION,
} from "@/lib/explanations";
import type { Alert } from "@/lib/types";

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
