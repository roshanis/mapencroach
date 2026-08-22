import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useRouter, useSearchParams } from "next/navigation";
import CommandMapPage from "./page";
import { getAlerts, getCases, getParcelPage, getWatchEntry } from "@/lib/api";
import {
  FIXTURE_ALERTS,
  FIXTURE_CASES,
  FIXTURE_PARCELS,
} from "@/lib/fixtures";

vi.mock("@/lib/api", () => ({
  getAlerts: vi.fn(),
  getCases: vi.fn(),
  getParcelPage: vi.fn(),
  getWatchEntry: vi.fn(),
  watchAlert: vi.fn(),
  unwatchAlert: vi.fn(),
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
    h3Cells,
    h3Visible,
  }: {
    alerts: typeof FIXTURE_ALERTS;
    onAlertClick?: (id: string) => void;
    h3Cells?: GeoJSON.FeatureCollection<GeoJSON.Polygon>;
    h3Visible?: boolean;
  }) => (
    <div
      data-testid="operational-map"
      data-h3-visible={String(Boolean(h3Visible))}
      data-h3-resolution={h3Cells?.features[0]?.properties?.resolution}
    >
      <button
        type="button"
        onClick={() => alerts[0] && onAlertClick?.(alerts[0].id)}
      >
        Select first map alert
      </button>
    </div>
  ),
}));

beforeEach(() => {
  vi.mocked(getParcelPage).mockResolvedValue({
    parcels: FIXTURE_PARCELS,
    total: FIXTURE_PARCELS.length,
    truncated: false,
  });
  vi.mocked(getAlerts).mockResolvedValue(FIXTURE_ALERTS);
  vi.mocked(getCases).mockResolvedValue(FIXTURE_CASES);
  vi.mocked(getWatchEntry).mockResolvedValue(undefined);
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
    vi.mocked(getParcelPage).mockReturnValue(new Promise(() => undefined));
    vi.mocked(getAlerts).mockReturnValue(new Promise(() => undefined));
    vi.mocked(getCases).mockReturnValue(new Promise(() => undefined));

    render(<CommandMapPage />);

    expect(screen.getByText("Loading jurisdiction data…")).toBeInTheDocument();
  });

  it("shows a retryable error instead of an empty map when data fails", async () => {
    vi.mocked(getParcelPage).mockRejectedValue(new Error("offline"));

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

  describe("incomplete map coverage", () => {
    it("says so when the server holds more parcels than it returned", async () => {
      vi.mocked(getParcelPage).mockResolvedValue({
        parcels: FIXTURE_PARCELS,
        total: 50000,
        truncated: true,
      });
      render(<CommandMapPage />);
      const warning = await screen.findByTestId("parcel-coverage-warning");
      expect(warning.textContent).toContain("incomplete");
      expect(warning.textContent).toContain("50,000");
      expect(warning).toHaveAttribute("role", "alert");
    });

    it("stays silent when the page covers the whole jurisdiction", async () => {
      // A standing "incomplete" banner over a complete map would train
      // officers to ignore it, which is worse than not having one.
      vi.mocked(getParcelPage).mockResolvedValue({
        parcels: FIXTURE_PARCELS,
        total: FIXTURE_PARCELS.length,
        truncated: false,
      });
      render(<CommandMapPage />);
      await screen.findByTestId("operational-map");
      expect(screen.queryByTestId("parcel-coverage-warning")).toBeNull();
    });

    it("stays silent when coverage is unknown", async () => {
      vi.mocked(getParcelPage).mockResolvedValue({
        parcels: FIXTURE_PARCELS,
        total: undefined,
        truncated: false,
      });
      render(<CommandMapPage />);
      await screen.findByTestId("operational-map");
      expect(screen.queryByTestId("parcel-coverage-warning")).toBeNull();
    });
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

  it("shows an off-by-default H3 control and updates the live map without replacing parcels", async () => {
    render(<CommandMapPage />);

    const toggle = await screen.findByRole("checkbox", {
      name: "H3 analytical grid",
    });
    const map = screen.getByTestId("operational-map");
    const resolution = screen.getByRole("combobox", { name: "H3 resolution" });
    const positioner = screen.getByTestId("h3-grid-control").parentElement;

    expect(toggle).not.toBeChecked();
    expect(positioner?.className).toContain(
      "top-[calc(4rem_+_env(safe-area-inset-top,0px))]"
    );
    expect(map).toHaveAttribute("data-h3-visible", "false");
    expect(map).toHaveAttribute("data-h3-resolution", "11");
    expect(resolution).toBeDisabled();

    fireEvent.click(toggle);
    expect(map).toHaveAttribute("data-h3-visible", "true");
    expect(resolution).toBeEnabled();
    expect(screen.getByText(/\d+ cells/)).toBeInTheDocument();

    fireEvent.change(resolution, { target: { value: "10" } });
    await waitFor(() => {
      expect(map).toHaveAttribute("data-h3-resolution", "10");
    });
  });
});
