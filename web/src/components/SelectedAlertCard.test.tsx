import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { SelectedAlertCard } from "./SelectedAlertCard";
import { FIXTURE_ALERTS, FIXTURE_PARCELS } from "@/lib/fixtures";

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
});
