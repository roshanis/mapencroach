import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { TierChip } from "./TierChip";
import type { AlertTier } from "@/lib/types";

describe("TierChip", () => {
  const cases: { tier: AlertTier; label: string }[] = [
    { tier: "green", label: "Green" },
    { tier: "amber", label: "Amber" },
    { tier: "red", label: "Red" },
    { tier: "legacy", label: "Legacy" },
  ];

  it.each(cases)(
    "renders the $label label and matching data-tier attribute for tier=$tier",
    ({ tier, label }) => {
      render(<TierChip tier={tier} />);
      const chip = screen.getByTestId("tier-chip");
      expect(chip).toHaveTextContent(label);
      expect(chip).toHaveAttribute("data-tier", tier);
    }
  );

  it("applies distinct color classes per tier", () => {
    const { rerender } = render(<TierChip tier="red" />);
    const redClasses = screen.getByTestId("tier-chip").className;

    rerender(<TierChip tier="green" />);
    const greenClasses = screen.getByTestId("tier-chip").className;

    expect(redClasses).not.toEqual(greenClasses);
    expect(redClasses).toContain("tier-red");
    expect(greenClasses).toContain("tier-green");
  });
});
