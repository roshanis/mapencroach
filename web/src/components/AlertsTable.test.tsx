import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { AlertsTable } from "./AlertsTable";
import {
  ALERT_STATUS_DESCRIPTIONS,
  SEVERITY_EXPLANATION,
} from "@/lib/explanations";
import type { Alert } from "@/lib/types";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
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
});
