import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FIXTURE_PARCELS } from "@/lib/fixtures";
import { getLatestClearImagery } from "@/lib/api";
import { LatestClearImagery } from "./LatestClearImagery";

vi.mock("@/lib/api", () => ({getLatestClearImagery: vi.fn()}));
vi.mock("./HistoricalImageryTimeline", () => ({HistoricalImageryTimeline: () => <p>Unverified browse</p>}));
const clear = {
  status: "clear" as const, parcel_id: "PCL-1001", checked_scenes: 2, unassessed_scenes: 0,
  search_limited: false, from: "2026-06-11T00:00:00Z", to: "2026-09-09T00:00:00Z",
  captured_at: "2026-09-05T05:40:31Z", scene_id: "S2B_43RGP_20260905_0_L2A",
  source: "Sentinel-2 L2A / Earth Search", sensor: "sentinel-2b", mask_resolution_m: 20,
  sampled_pixels: 36, width: 12, height: 12, image_base64: "iVBORw0KGgo=",
};
afterEach(() => vi.resetAllMocks());

describe("Latest clear imagery", () => {
  it("shows the exact capture date and mask limits, without loading unverified browsing", async () => {
    vi.mocked(getLatestClearImagery).mockResolvedValue(clear);
    render(<LatestClearImagery parcel={FIXTURE_PARCELS[0]} />);
    await screen.findByRole("img", {name: /No clouds detected.*2026-09-05/});
    expect(screen.getByText(/20 m/)).toBeInTheDocument();
    expect(screen.getByText(/classification can miss clouds/i)).toBeInTheDocument();
    expect(screen.queryByText("Unverified browse")).not.toBeInTheDocument();
  });
  it("keeps no-clear and unavailable outcomes distinct and supports retry", async () => {
    vi.mocked(getLatestClearImagery).mockResolvedValueOnce({...clear, status: "no_clear"})
      .mockResolvedValueOnce({...clear, status: "provider_error"});
    render(<LatestClearImagery parcel={FIXTURE_PARCELS[0]} />);
    await screen.findByText("No clear image found");
    fireEvent.click(screen.getByRole("button", {name: "Search again"}));
    await screen.findByText("Imagery service unavailable");
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });
  it("discloses skipped scenes instead of implying the result is the newest observation", async () => {
    vi.mocked(getLatestClearImagery).mockResolvedValue({...clear, unassessed_scenes: 1});
    render(<LatestClearImagery parcel={FIXTURE_PARCELS[0]} />);
    await screen.findByText(/1 newer candidate could not be assessed/);
  });
  it("does not publish stale data after switching parcels", async () => {
    let resolveOld!: (value: typeof clear) => void;
    vi.mocked(getLatestClearImagery).mockImplementationOnce(() => new Promise(resolve => {resolveOld=resolve;}))
      .mockResolvedValueOnce({...clear, status: "no_clear"});
    const view = render(<LatestClearImagery parcel={FIXTURE_PARCELS[0]} />);
    view.rerender(<LatestClearImagery parcel={FIXTURE_PARCELS[1]} />);
    await screen.findByText("No clear image found");
    resolveOld(clear);
    await waitFor(() => expect(screen.queryByRole("img")).not.toBeInTheDocument());
  });
  it("a failed preview decode removes the clear-image claim", async () => {
    vi.mocked(getLatestClearImagery).mockResolvedValue(clear);
    render(<LatestClearImagery parcel={FIXTURE_PARCELS[0]} />);
    fireEvent.error(await screen.findByRole("img"));
    expect(screen.getByText("Preview could not be displayed")).toBeInTheDocument();
    expect(screen.queryByText("No clouds detected over this parcel")).not.toBeInTheDocument();
  });
});
