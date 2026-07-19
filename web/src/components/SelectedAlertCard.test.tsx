import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { SelectedAlertCard } from "./SelectedAlertCard";
import { FIXTURE_ALERTS, FIXTURE_CASES, FIXTURE_PARCELS } from "@/lib/fixtures";

describe("SelectedAlertCard", () => {
  it("turns a map selection into an actionable parcel summary", () => {
    render(
      <SelectedAlertCard
        alert={FIXTURE_ALERTS[0]}
        parcel={FIXTURE_PARCELS[0]}
        onClose={() => undefined}
      />
    );

    expect(screen.getByText("Water Resources Department")).toBeInTheDocument();
    expect(screen.getByText("Survey 44/2")).toBeInTheDocument();
    expect(screen.getByText("Escalated")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Open parcel record" })
    ).toHaveAttribute("href", "/parcels/PCL-1001");
  });

  it("shows a humanized parcel secondary line instead of the raw parcel id", () => {
    render(
      <SelectedAlertCard
        alert={FIXTURE_ALERTS[0]}
        parcel={FIXTURE_PARCELS[0]}
        onClose={() => undefined}
      />
    );

    // FIXTURE_PARCELS[0] (PCL-1001): waterbody, grade A.
    expect(screen.getByText("Waterbody · Grade A")).toBeInTheDocument();
    expect(screen.queryByText("PCL-1001")).not.toBeInTheDocument();
  });

  it("rounds the severity score", () => {
    render(
      <SelectedAlertCard
        alert={{ ...FIXTURE_ALERTS[0], severity_score: 41.6 }}
        parcel={FIXTURE_PARCELS[0]}
        onClose={() => undefined}
      />
    );

    expect(screen.getByText("Severity 42")).toBeInTheDocument();
  });

  it('shows "Open case" only when a case is provided', () => {
    const { rerender } = render(
      <SelectedAlertCard
        alert={FIXTURE_ALERTS[0]}
        parcel={FIXTURE_PARCELS[0]}
        onClose={() => undefined}
      />
    );

    expect(
      screen.queryByRole("link", { name: "Open case →" })
    ).not.toBeInTheDocument();

    const caseForAlert = FIXTURE_CASES.find(
      (item) => item.alert_id === FIXTURE_ALERTS[0].id
    )!;
    rerender(
      <SelectedAlertCard
        alert={FIXTURE_ALERTS[0]}
        parcel={FIXTURE_PARCELS[0]}
        onClose={() => undefined}
        caseForAlert={caseForAlert}
      />
    );

    expect(
      screen.getByRole("link", { name: "Open case →" })
    ).toHaveAttribute("href", `/cases/${caseForAlert.id}`);
  });
});
