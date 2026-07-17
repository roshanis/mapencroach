import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { WorkbenchSummary } from "./WorkbenchSummary";
import {
  FIXTURE_ALERTS,
  FIXTURE_CASES,
  FIXTURE_PARCELS,
} from "@/lib/fixtures";

describe("WorkbenchSummary", () => {
  it("frames the default case-officer view around action", () => {
    render(
      <WorkbenchSummary
        role="case_officer"
        parcels={FIXTURE_PARCELS}
        alerts={FIXTURE_ALERTS}
        cases={FIXTURE_CASES}
      />
    );

    expect(screen.getByText("Officer workbench")).toBeInTheDocument();
    expect(screen.getByText("Urgent alerts")).toBeInTheDocument();
    expect(screen.getByText("Active cases")).toBeInTheDocument();
  });

  it("changes the summary for a survey officer", () => {
    render(
      <WorkbenchSummary
        role="survey_officer"
        parcels={FIXTURE_PARCELS}
        alerts={FIXTURE_ALERTS}
        cases={FIXTURE_CASES}
      />
    );

    expect(screen.getByText("Survey workbench")).toBeInTheDocument();
    expect(screen.getByText("Grade C boundaries")).toBeInTheDocument();
  });

  it("changes the summary for a read-only executive", () => {
    render(
      <WorkbenchSummary
        role="viewer"
        parcels={FIXTURE_PARCELS}
        alerts={FIXTURE_ALERTS}
        cases={FIXTURE_CASES}
      />
    );

    expect(screen.getByText("Executive overview")).toBeInTheDocument();
    expect(screen.getByText("Monitored parcels")).toBeInTheDocument();
  });
});
