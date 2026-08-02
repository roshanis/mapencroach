import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { SelectedAlertCard } from "./SelectedAlertCard";
import { getWatchEntry } from "@/lib/api";
import { FIXTURE_ALERTS, FIXTURE_PARCELS } from "@/lib/fixtures";

vi.mock("@/lib/api", () => ({
  getWatchEntry: vi.fn(),
  watchAlert: vi.fn(),
  unwatchAlert: vi.fn(),
}));

describe("SelectedAlertCard", () => {
  it("turns a map selection into an actionable parcel summary", async () => {
    vi.mocked(getWatchEntry).mockResolvedValue(undefined);

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

    // The watch toggle is rendered for this RED alert, once its watch
    // status has loaded.
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Watch alert ALT-5001" })
      ).toBeInTheDocument();
    });
  });
});
