import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import CommandMapPage from "./page";
import { getAlerts, getCases, getParcels, getWatchEntry } from "@/lib/api";
import {
  FIXTURE_ALERTS,
  FIXTURE_CASES,
  FIXTURE_PARCELS,
} from "@/lib/fixtures";

vi.mock("@/lib/api", () => ({
  getAlerts: vi.fn(),
  getCases: vi.fn(),
  getParcels: vi.fn(),
  getWatchEntry: vi.fn(),
  watchAlert: vi.fn(),
  unwatchAlert: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/console",
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("@/components/TopBar", () => ({
  TopBar: () => <div>Top bar</div>,
}));

vi.mock("@/components/MapIntroPanel", () => ({
  MapIntroPanel: () => null,
}));

vi.mock("@/components/MapLegend", () => ({
  MapLegend: () => null,
}));

vi.mock("@/components/MapView", () => ({
  default: ({
    alerts,
    onAlertClick,
  }: {
    alerts: typeof FIXTURE_ALERTS;
    onAlertClick?: (id: string) => void;
  }) => (
    <button
      type="button"
      onClick={() => alerts[0] && onAlertClick?.(alerts[0].id)}
    >
      Select first map alert
    </button>
  ),
}));

beforeEach(() => {
  vi.mocked(getParcels).mockResolvedValue(FIXTURE_PARCELS);
  vi.mocked(getAlerts).mockResolvedValue(FIXTURE_ALERTS);
  vi.mocked(getCases).mockResolvedValue(FIXTURE_CASES);
  vi.mocked(getWatchEntry).mockResolvedValue(undefined);
});

describe("CommandMapPage", () => {
  it("shows an honest loading state before map data is ready", () => {
    vi.mocked(getParcels).mockReturnValue(new Promise(() => undefined));
    vi.mocked(getAlerts).mockReturnValue(new Promise(() => undefined));
    vi.mocked(getCases).mockReturnValue(new Promise(() => undefined));

    render(<CommandMapPage />);

    expect(screen.getByText("Loading jurisdiction data…")).toBeInTheDocument();
  });

  it("shows a retryable error instead of an empty map when data fails", async () => {
    vi.mocked(getParcels).mockRejectedValue(new Error("offline"));

    render(<CommandMapPage />);

    expect(
      await screen.findByText("Jurisdiction data could not be loaded")
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });

  it("uses the same selection flow for a map marker and exposes the parcel action", async () => {
    render(<CommandMapPage />);

    await waitFor(() => {
      expect(screen.getByText("Select first map alert")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText("Select first map alert"));

    expect(
      await screen.findByRole("link", { name: "Open parcel record" })
    ).toHaveAttribute("href", "/parcels/PCL-1001");
  });

  it("hides the floating trigger while the mobile work queue is open, and both the × and the backdrop bring it back", async () => {
    render(<CommandMapPage />);

    const openButton = await screen.findByRole("button", {
      name: "Open work queue",
    });
    expect(
      screen.queryByTestId("alert-sidebar-backdrop")
    ).not.toBeInTheDocument();

    fireEvent.click(openButton);

    // The trigger is unmounted while the queue is open — otherwise it
    // would sit, hidden behind the now-open panel, as a dead but still
    // focusable button. The panel's own backdrop + close control take
    // over from here.
    expect(
      screen.queryByRole("button", { name: "Open work queue" })
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("alert-sidebar-backdrop")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Close work queue" }));

    expect(
      await screen.findByRole("button", { name: "Open work queue" })
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("alert-sidebar-backdrop")
    ).not.toBeInTheDocument();

    // Tapping the backdrop is equivalent to the × button.
    fireEvent.click(screen.getByRole("button", { name: "Open work queue" }));
    fireEvent.click(screen.getByTestId("alert-sidebar-backdrop"));

    expect(
      await screen.findByRole("button", { name: "Open work queue" })
    ).toBeInTheDocument();
  });
});
