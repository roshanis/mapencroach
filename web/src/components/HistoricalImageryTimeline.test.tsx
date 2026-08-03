import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FIXTURE_PARCELS } from "@/lib/fixtures";
import { getScenes } from "@/lib/api";
import type { Scene } from "@/lib/types";
import { HistoricalImageryTimeline } from "./HistoricalImageryTimeline";

vi.mock("@/lib/api", () => ({
  getScenes: vi.fn(),
}));

// BeforeAfterSlider has its own dedicated test suite (BeforeAfterSlider.test.tsx)
// covering tile fetching/rendering; here it is stubbed so these tests focus
// on HistoricalImageryTimeline's own gating and scene-list rendering.
vi.mock("./BeforeAfterSlider", () => ({
  BeforeAfterSlider: ({
    beforeScene,
    afterScene,
  }: {
    beforeScene: Scene;
    afterScene: Scene;
  }) => (
    <div data-testid="before-after-slider-stub">
      {beforeScene.scene_id} vs {afterScene.scene_id}
    </div>
  ),
}));

function scene(overrides: Partial<Scene>): Scene {
  return {
    scene_id: "scene-1",
    sha256: "a".repeat(64),
    cog_sha256: "b".repeat(64),
    captured_at: "2023-01-01T00:00:00Z",
    sensor: "Sentinel-2",
    resolution_m: 10,
    cloud_pct: 5,
    source: "aws-earth-search",
    href: "https://example.test/scene-1.tif",
    stac_item: { bbox: [77.0, 29.8, 77.1, 29.9], properties: {} },
    sidecar_sha256: "c".repeat(64),
    ...overrides,
  };
}

describe("HistoricalImageryTimeline", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("offers three usable historical maps and preserves the 1985 coverage gap", async () => {
    vi.mocked(getScenes).mockResolvedValue([]);
    render(<HistoricalImageryTimeline parcel={FIXTURE_PARCELS[0]} />);
    await waitFor(() => expect(getScenes).toHaveBeenCalled());

    expect(
      screen.getByRole("heading", { name: "Imagery Timeline" })
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /1985/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /1990/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /2000/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /2010/ })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    expect(
      screen.getByRole("img", {
        name: /2010 MODIS Terra true-color historical context/i,
      })
    ).toHaveAttribute("src", expect.stringContaining("gibs.earthdata.nasa.gov"));
  });

  it("switches scenes and explains source, resolution, and evidentiary limits", async () => {
    vi.mocked(getScenes).mockResolvedValue([]);
    render(<HistoricalImageryTimeline parcel={FIXTURE_PARCELS[0]} />);
    await waitFor(() => expect(getScenes).toHaveBeenCalled());

    fireEvent.click(screen.getByRole("button", { name: /2000/ }));

    expect(
      screen.getByRole("img", {
        name: /2000 Landsat WELD true-color historical context/i,
      })
    ).toBeInTheDocument();
    expect(screen.getByText("30 m annual composite")).toBeInTheDocument();
    expect(screen.getByText(/NASA GIBS · Landsat WELD/i)).toBeInTheDocument();
    expect(
      screen.getByText(/Planning context only.*not enforcement evidence/i)
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /NASA GIBS/i })).toHaveAttribute(
      "href",
      "https://nasa-gibs.github.io/gibs-api-docs/"
    );
  });

  it("shows honest coverage and network failure states", async () => {
    vi.mocked(getScenes).mockResolvedValue([]);
    render(<HistoricalImageryTimeline parcel={FIXTURE_PARCELS[0]} />);
    await waitFor(() => expect(getScenes).toHaveBeenCalled());

    fireEvent.click(screen.getByRole("button", { name: /1985/ }));
    expect(
      screen.getByText(/No usable 1985 Landsat coverage/i)
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /1990/ }));
    fireEvent.error(
      screen.getByRole("img", {
        name: /1990 Landsat WELD true-color historical context/i,
      })
    );
    expect(
      screen.getByText(/Historical image unavailable/i)
    ).toBeInTheDocument();
  });

  it("renders nothing extra when no registered scenes exist", async () => {
    vi.mocked(getScenes).mockResolvedValue([]);
    render(<HistoricalImageryTimeline parcel={FIXTURE_PARCELS[0]} />);
    await waitFor(() => expect(getScenes).toHaveBeenCalled());

    expect(
      screen.queryByText("Registered scene captures")
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("before-after-slider-stub")
    ).not.toBeInTheDocument();
  });

  it("lists a single registered scene chronologically without a before/after slider", async () => {
    vi.mocked(getScenes).mockResolvedValue([
      scene({ scene_id: "only-scene", captured_at: "2024-05-10T00:00:00Z" }),
    ]);
    render(<HistoricalImageryTimeline parcel={FIXTURE_PARCELS[0]} />);

    await waitFor(() => {
      expect(screen.getByText("Registered scene captures")).toBeInTheDocument();
    });
    expect(screen.getByText("2024-05-10")).toBeInTheDocument();
    expect(screen.getByText("Sentinel-2")).toBeInTheDocument();
    expect(screen.getByText("10 m resolution")).toBeInTheDocument();
    expect(screen.getByText("5% cloud")).toBeInTheDocument();
    expect(
      screen.queryByTestId("before-after-slider-stub")
    ).not.toBeInTheDocument();
  });

  it("orders scenes chronologically and feeds the earliest/latest pair to the before/after slider", async () => {
    vi.mocked(getScenes).mockResolvedValue([
      scene({ scene_id: "middle", captured_at: "2023-06-01T00:00:00Z" }),
      scene({ scene_id: "latest", captured_at: "2024-06-01T00:00:00Z" }),
      scene({ scene_id: "earliest", captured_at: "2022-01-01T00:00:00Z" }),
    ]);
    render(<HistoricalImageryTimeline parcel={FIXTURE_PARCELS[0]} />);

    await waitFor(() => {
      expect(screen.getByTestId("before-after-slider-stub")).toBeInTheDocument();
    });

    const listItems = screen.getAllByText(/^202\d-\d{2}-\d{2}$/);
    expect(listItems.map((el) => el.textContent)).toEqual([
      "2022-01-01",
      "2023-06-01",
      "2024-06-01",
    ]);
    expect(screen.getByTestId("before-after-slider-stub")).toHaveTextContent(
      "earliest vs latest"
    );
  });
});
