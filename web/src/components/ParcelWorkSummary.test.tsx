import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ParcelWorkSummary } from "./ParcelWorkSummary";
import {
  FIXTURE_ALERTS,
  FIXTURE_CASES,
  FIXTURE_PARCELS,
} from "@/lib/fixtures";

describe("ParcelWorkSummary", () => {
  it("puts the active risk and case action ahead of parcel metadata", () => {
    render(
      <ParcelWorkSummary
        parcel={FIXTURE_PARCELS[0]}
        alerts={[FIXTURE_ALERTS[0]]}
        cases={[FIXTURE_CASES[0]]}
      />
    );

    expect(screen.getByText("Current work")).toBeInTheDocument();
    expect(screen.getByText("Urgent alert")).toBeInTheDocument();
    expect(screen.getByText("Show Cause Issued")).toBeInTheDocument();
    expect(screen.getByText("Open response window")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open active case" })).toHaveAttribute(
      "href",
      "/cases/CASE-9001"
    );
  });

  it("keeps risk and next action attached to the same alert when multiple cases exist", () => {
    const urgent = FIXTURE_ALERTS[0];
    const matching = {...FIXTURE_CASES[0], id:"matching", alert_id:urgent.id};
    const unrelated = {...matching, id:"other", alert_id:"other-alert"};
    render(<ParcelWorkSummary parcel={FIXTURE_PARCELS[0]} alerts={[urgent]} cases={[unrelated, matching]} />);
    expect(screen.getByRole("link", {name:"Open active case"})).toHaveAttribute("href", "/cases/matching");
  });

  it("warns that a Grade C boundary needs survey before legal action", () => {
    render(
      <ParcelWorkSummary
        parcel={FIXTURE_PARCELS[3]}
        alerts={[FIXTURE_ALERTS[2]]}
        cases={[]}
      />
    );

    expect(screen.getByText("Survey boundary before legal notice")).toBeInTheDocument();
  });

  it("renders a calm empty state when no active work remains", () => {
    render(
      <ParcelWorkSummary
        parcel={FIXTURE_PARCELS[5]}
        alerts={[{ ...FIXTURE_ALERTS[3], status: "closed" }]}
        cases={[FIXTURE_CASES[1]]}
      />
    );

    expect(screen.getByText("No active enforcement work")).toBeInTheDocument();
  });
});
