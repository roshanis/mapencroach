import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { AlertSidebar } from "./AlertSidebar";
import { FIXTURE_ALERTS, FIXTURE_CASES, FIXTURE_PARCELS } from "@/lib/fixtures";
import type { Alert } from "@/lib/types";

describe("AlertSidebar", () => {
  it("shows only unresolved alerts under an accurate heading", () => {
    render(<AlertSidebar alerts={FIXTURE_ALERTS} />);

    expect(screen.getByText("Unresolved alerts")).toBeInTheDocument();
    expect(screen.getByText("4 need attention")).toBeInTheDocument();
    expect(screen.queryByText("PCL-1006")).not.toBeInTheDocument();
  });

  it("selects an alert without navigating away from the map", () => {
    const onSelect = vi.fn();
    render(<AlertSidebar alerts={FIXTURE_ALERTS} onSelect={onSelect} />);

    fireEvent.click(screen.getByRole("button", { name: /PCL-1001/i }));

    expect(onSelect).toHaveBeenCalledWith(FIXTURE_ALERTS[0]);
  });

  it("renders a useful empty state when no unresolved alerts remain", () => {
    render(
      <AlertSidebar
        alerts={FIXTURE_ALERTS.map((alert) => ({
          ...alert,
          status: "closed" as const,
        }))}
      />
    );

    expect(screen.getByText("No unresolved alerts in this jurisdiction.")).toBeInTheDocument();
  });

  it("shows survey no, land category, grade, and rounded severity for a matched parcel", () => {
    const alerts: Alert[] = [
      {
        id: "ALT-9001",
        parcel_id: "PCL-1001",
        tier: "red",
        severity_score: 41.6,
        area_m2: 500,
        status: "open",
        detected_at: "2026-06-18T05:12:00Z",
      },
    ];

    render(<AlertSidebar alerts={alerts} parcels={FIXTURE_PARCELS} />);

    // PCL-1001's fixture parcel: survey_no "44/2", waterbody, grade A.
    expect(screen.getByText("44/2")).toBeInTheDocument();
    expect(screen.getByText("Waterbody · Grade A")).toBeInTheDocument();
    expect(screen.getByText("Severity 42")).toBeInTheDocument();
  });

  it("falls back to the raw parcel id when no matching parcel is found", () => {
    const alerts: Alert[] = [
      {
        id: "ALT-9002",
        parcel_id: "PCL-UNKNOWN",
        tier: "amber",
        severity_score: 30,
        area_m2: 200,
        status: "open",
        detected_at: "2026-06-18T05:12:00Z",
      },
    ];

    render(<AlertSidebar alerts={alerts} parcels={FIXTURE_PARCELS} />);

    expect(screen.getByText("PCL-UNKNOWN")).toBeInTheDocument();
    expect(screen.queryByText(/Grade/)).not.toBeInTheDocument();
  });

  it("renders a parcel quick-action link on each row that does not trigger selection", () => {
    const onSelect = vi.fn();
    render(<AlertSidebar alerts={FIXTURE_ALERTS} onSelect={onSelect} />);

    const parcelLink = screen.getAllByRole("link", { name: "Parcel →" })[0];
    expect(parcelLink).toHaveAttribute("href", "/parcels/PCL-1001");

    fireEvent.click(parcelLink);

    expect(onSelect).not.toHaveBeenCalled();
  });

  it("renders a Case quick-action chip only when a case exists for the alert", () => {
    const casesByAlertId = new Map(
      FIXTURE_CASES.map((item) => [item.alert_id, item])
    );
    const onSelect = vi.fn();
    render(
      <AlertSidebar
        alerts={FIXTURE_ALERTS}
        onSelect={onSelect}
        casesByAlertId={casesByAlertId}
      />
    );

    // ALT-5001 has CASE-9001; ALT-5002/5003/5005 (unresolved) have no case.
    const caseLink = screen.getByRole("link", { name: "Case" });
    expect(caseLink).toHaveAttribute("href", "/cases/CASE-9001");

    fireEvent.click(caseLink);

    expect(onSelect).not.toHaveBeenCalled();
  });

  it("omits the Case chip entirely when no case mapping is provided", () => {
    render(<AlertSidebar alerts={FIXTURE_ALERTS} />);

    expect(screen.queryByRole("link", { name: "Case" })).not.toBeInTheDocument();
  });
});
