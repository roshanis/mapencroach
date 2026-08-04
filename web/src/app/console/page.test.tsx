import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useRouter, useSearchParams } from "next/navigation";
import CommandMapPage from "./page";
import { getAlerts, getCases, getParcels } from "@/lib/api";
import {
  FIXTURE_ALERTS,
  FIXTURE_CASES,
  FIXTURE_PARCELS,
} from "@/lib/fixtures";

vi.mock("@/lib/api", () => ({
  getAlerts: vi.fn(),
  getCases: vi.fn(),
  getParcels: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/console",
  useRouter: vi.fn(),
  useSearchParams: vi.fn(),
}));

const replaceMock = vi.fn();

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
  vi.mocked(useRouter).mockReturnValue({
    replace: replaceMock,
  } as unknown as ReturnType<typeof useRouter>);
  vi.mocked(useSearchParams).mockReturnValue(
    new URLSearchParams() as unknown as ReturnType<typeof useSearchParams>
  );
});

afterEach(() => {
  replaceMock.mockReset();
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

  describe("URL-persisted selection", () => {
    it("selects the alert named in ?alert= once data has loaded", async () => {
      vi.mocked(useSearchParams).mockReturnValue(
        new URLSearchParams(
          "alert=ALT-5002"
        ) as unknown as ReturnType<typeof useSearchParams>
      );

      render(<CommandMapPage />);

      expect(
        await screen.findByRole("link", { name: "Open parcel record" })
      ).toHaveAttribute("href", "/parcels/PCL-1008");
    });

    it("ignores an unknown ?alert= id without crashing or selecting anything", async () => {
      vi.mocked(useSearchParams).mockReturnValue(
        new URLSearchParams(
          "alert=ALT-DOES-NOT-EXIST"
        ) as unknown as ReturnType<typeof useSearchParams>
      );

      render(<CommandMapPage />);

      await waitFor(() => {
        expect(screen.getByText("Select first map alert")).toBeInTheDocument();
      });
      expect(
        screen.queryByRole("link", { name: "Open parcel record" })
      ).not.toBeInTheDocument();
    });

    it("replaces the URL with the alert id when a sidebar row is selected", async () => {
      render(<CommandMapPage />);

      const row = await screen.findByRole("button", { name: /PCL-1001/i });
      fireEvent.click(row);

      await waitFor(() => {
        expect(replaceMock).toHaveBeenCalledWith("/console?alert=ALT-5001", {
          scroll: false,
        });
      });
    });

    it("clears the alert param when the selected-alert card is closed", async () => {
      render(<CommandMapPage />);

      const row = await screen.findByRole("button", { name: /PCL-1001/i });
      fireEvent.click(row);
      await screen.findByRole("link", { name: "Open parcel record" });

      fireEvent.click(screen.getByRole("button", { name: "Close selected alert" }));

      await waitFor(() => {
        expect(replaceMock).toHaveBeenLastCalledWith("/console", {
          scroll: false,
        });
      });
    });
  });

  it("shows the KPI strip on all viewports: a floating strip on lg+ and a compact in-flow grid below lg", async () => {
    render(<CommandMapPage />);

    await waitFor(() => {
      expect(
        screen.getByTestId("kpi-strip-floating-wrapper")
      ).toBeInTheDocument();
    });

    const floatingWrapper = screen.getByTestId("kpi-strip-floating-wrapper");
    const compactWrapper = screen.getByTestId("kpi-strip-compact-wrapper");

    // lg+ keeps the floating strip (hidden below lg, shown at lg+).
    expect(floatingWrapper.className).toContain("hidden");
    expect(floatingWrapper.className).toContain("lg:block");
    expect(floatingWrapper.className).toContain("absolute");

    // Below lg, the compact grid sits in normal flow (not absolute, and not
    // unconditionally hidden — only hidden at lg+ via the "lg:hidden" class).
    const compactClasses = compactWrapper.className.split(/\s+/);
    expect(compactClasses).not.toContain("hidden");
    expect(compactClasses).toContain("lg:hidden");
    expect(compactWrapper.className).not.toContain("absolute");

    expect(screen.getAllByTestId("kpi-strip")).toHaveLength(2);
  });
});
