import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { StateRail } from "./StateRail";
import { STATE_DESCRIPTIONS } from "@/lib/explanations";
import { CASE_STATE_CHAIN } from "@/lib/types";

describe("StateRail", () => {
  it("renders every state in the due-process chain in order", () => {
    render(<StateRail currentState="NEW" />);
    const steps = screen.getAllByTestId("state-rail-step");
    expect(steps).toHaveLength(CASE_STATE_CHAIN.length);
    steps.forEach((step, idx) => {
      expect(step).toHaveAttribute("data-state", CASE_STATE_CHAIN[idx]);
    });
  });

  it("marks only the current state as current", () => {
    render(<StateRail currentState="SHOW_CAUSE_ISSUED" />);
    const steps = screen.getAllByTestId("state-rail-step");
    const currentSteps = steps.filter(
      (s) => s.getAttribute("data-current") === "true"
    );
    expect(currentSteps).toHaveLength(1);
    expect(currentSteps[0]).toHaveAttribute("data-state", "SHOW_CAUSE_ISSUED");
  });

  it("highlights CLOSED as current when the case is closed", () => {
    render(<StateRail currentState="CLOSED" />);
    const closedStep = screen
      .getAllByTestId("state-rail-step")
      .find((s) => s.getAttribute("data-state") === "CLOSED");
    expect(closedStep).toHaveAttribute("data-current", "true");
  });

  it("renders an amber paused banner and no current highlight for a paused special state", () => {
    render(<StateRail currentState="STAYED_BY_COURT" />);
    const banner = screen.getByTestId("state-rail-special-banner");
    expect(banner).toHaveTextContent("This case is paused");
    expect(banner).toHaveTextContent("Stayed by Court");
    expect(banner).toHaveTextContent(
      "The chain resumes where it stopped."
    );
    expect(banner.className).toContain("amber");

    const steps = screen.getAllByTestId("state-rail-step");
    expect(steps).toHaveLength(CASE_STATE_CHAIN.length);
    const currentSteps = steps.filter(
      (s) => s.getAttribute("data-current") === "true"
    );
    expect(currentSteps).toHaveLength(0);
  });

  it("renders a gray terminal-off-chain banner for LEGACY_REFERRED with no current highlight", () => {
    render(<StateRail currentState="LEGACY_REFERRED" />);
    const banner = screen.getByTestId("state-rail-special-banner");
    expect(banner).toHaveTextContent("Referred — Legacy Process");
    expect(banner.className).toContain("gray");

    const steps = screen.getAllByTestId("state-rail-step");
    const currentSteps = steps.filter(
      (s) => s.getAttribute("data-current") === "true"
    );
    expect(currentSteps).toHaveLength(0);
  });

  it("renders a gray terminal-off-chain banner for DISMISSED_FALSE_POSITIVE", () => {
    render(<StateRail currentState="DISMISSED_FALSE_POSITIVE" />);
    const banner = screen.getByTestId("state-rail-special-banner");
    expect(banner).toHaveTextContent("Dismissed — False Positive");
    expect(banner.className).toContain("gray");
  });

  it("renders an amber paused banner for SURVEY_REQUESTED", () => {
    render(<StateRail currentState="SURVEY_REQUESTED" />);
    const banner = screen.getByTestId("state-rail-special-banner");
    expect(banner).toHaveTextContent("Paused — Survey Requested");
    expect(banner.className).toContain("amber");
  });

  it("does not render a special banner for chain states", () => {
    render(<StateRail currentState="NEW" />);
    expect(
      screen.queryByTestId("state-rail-special-banner")
    ).not.toBeInTheDocument();
  });

  it("sets a title on each step from STATE_DESCRIPTIONS (spot check NEW and SHOW_CAUSE_ISSUED)", () => {
    render(<StateRail currentState="NEW" />);
    const steps = screen.getAllByTestId("state-rail-step");

    const newStep = steps.find((s) => s.getAttribute("data-state") === "NEW");
    expect(newStep?.querySelector("[title]")).toHaveAttribute(
      "title",
      STATE_DESCRIPTIONS.NEW
    );

    const showCauseStep = steps.find(
      (s) => s.getAttribute("data-state") === "SHOW_CAUSE_ISSUED"
    );
    expect(showCauseStep?.querySelector("[title]")).toHaveAttribute(
      "title",
      STATE_DESCRIPTIONS.SHOW_CAUSE_ISSUED
    );
  });
});
