import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { BoundaryGradeBadge } from "./BoundaryGradeBadge";
import type { BoundaryGrade } from "@/lib/types";

describe("BoundaryGradeBadge", () => {
  const cases: { grade: BoundaryGrade; explanation: string }[] = [
    {
      grade: "A",
      explanation: "DGPS-verified — enforcement can rely on this boundary",
    },
    {
      grade: "B",
      explanation:
        "Georeferenced — suitable for notices; survey before demolition",
    },
    {
      grade: "C",
      explanation:
        "Unverified — a notice cannot rely on this boundary; survey first",
    },
  ];

  it.each(cases)(
    "renders grade $grade with explanation '$explanation'",
    ({ grade, explanation }) => {
      render(<BoundaryGradeBadge grade={grade} />);
      const badge = screen.getByTestId("boundary-grade-badge");
      expect(badge).toHaveAttribute("data-grade", grade);
      expect(badge).toHaveTextContent(`Grade ${grade}`);
      expect(badge).toHaveTextContent(explanation);
    }
  );

  it("omits the explanation text when showExplanation is false", () => {
    render(<BoundaryGradeBadge grade="A" showExplanation={false} />);
    const badge = screen.getByTestId("boundary-grade-badge");
    expect(badge).not.toHaveTextContent("DGPS-verified");
  });
});
