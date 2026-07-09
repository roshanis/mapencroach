import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { StateRail } from "./StateRail";
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
});
