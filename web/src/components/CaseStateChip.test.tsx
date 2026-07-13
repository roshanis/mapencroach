import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { CaseStateChip } from "./CaseStateChip";

describe("CaseStateChip", () => {
  it("renders an active family chip for a chain state (not CLOSED)", () => {
    render(<CaseStateChip state="SHOW_CAUSE_ISSUED" />);
    const chip = screen.getByTestId("case-state-chip");
    expect(chip).toHaveAttribute("data-family", "active");
    expect(chip).toHaveTextContent("Show Cause Issued");
    expect(chip.className).toContain("bg-gov/10");
    expect(chip.className).toContain("text-gov");
    expect(chip.className).toContain("ring-gov/30");
  });

  it("renders CLOSED as a terminal family chip", () => {
    render(<CaseStateChip state="CLOSED" />);
    const chip = screen.getByTestId("case-state-chip");
    expect(chip).toHaveAttribute("data-family", "terminal");
    expect(chip).toHaveTextContent("Closed");
    expect(chip.className).toContain("bg-gray-100");
    expect(chip.className).toContain("text-gray-600");
  });

  it("renders paused states with amber styling, family=paused, and a helpful title", () => {
    render(<CaseStateChip state="STAYED_BY_COURT" />);
    const chip = screen.getByTestId("case-state-chip");
    expect(chip).toHaveAttribute("data-family", "paused");
    expect(chip.className).toContain("bg-amber-50");
    expect(chip.className).toContain("text-amber-800");
    expect(chip).toHaveAttribute(
      "title",
      "The forward chain is frozen; it resumes exactly where it stopped."
    );
  });

  it("renders SURVEY_REQUESTED as paused too", () => {
    render(<CaseStateChip state="SURVEY_REQUESTED" />);
    expect(screen.getByTestId("case-state-chip")).toHaveAttribute(
      "data-family",
      "paused"
    );
  });

  it("renders the two terminal off-chain states with gray terminal styling", () => {
    render(<CaseStateChip state="DISMISSED_FALSE_POSITIVE" />);
    const chip = screen.getByTestId("case-state-chip");
    expect(chip).toHaveAttribute("data-family", "terminal");
    expect(chip.className).toContain("bg-gray-100");
    expect(chip).toHaveTextContent("Dismissed — False Positive");
  });

  it("renders LEGACY_REFERRED with the correct label", () => {
    render(<CaseStateChip state="LEGACY_REFERRED" />);
    expect(screen.getByTestId("case-state-chip")).toHaveTextContent(
      "Referred — Legacy Process"
    );
  });
});
