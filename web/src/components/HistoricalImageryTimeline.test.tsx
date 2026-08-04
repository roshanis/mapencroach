import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FIXTURE_PARCELS } from "@/lib/fixtures";
import {
  LATEST_MAX_OFFSET_DAYS,
  LATEST_START_OFFSET_DAYS,
} from "@/lib/latest-imagery";
import { HistoricalImageryTimeline } from "./HistoricalImageryTimeline";

describe("HistoricalImageryTimeline", () => {
  it("defaults to the Latest scene and keeps the historical years available", () => {
    render(<HistoricalImageryTimeline parcel={FIXTURE_PARCELS[0]} />);

    expect(
      screen.getByRole("heading", { name: "Imagery Timeline" })
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /1985/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /1990/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /2000/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /2010/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Latest/ })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    const image = screen.getByRole("img", {
      name: /Latest HLS Sentinel-2 true-color historical context/i,
    });
    expect(image).toHaveAttribute(
      "src",
      expect.stringContaining("gibs.earthdata.nasa.gov")
    );
    expect(image).toHaveAttribute(
      "src",
      expect.stringContaining("HLS_S30_Nadir_BRDF_Adjusted_Reflectance")
    );
    // requests a current date, not an archival one
    const currentYear = new Date().getFullYear().toString();
    expect(decodeURIComponent(image.getAttribute("src") ?? "")).toContain(
      `TIME=${currentYear}`
    );
  });

  it("keeps the 2010 MODIS scene reachable from the year switcher", () => {
    render(<HistoricalImageryTimeline parcel={FIXTURE_PARCELS[0]} />);

    fireEvent.click(screen.getByRole("button", { name: /2010/ }));

    expect(
      screen.getByRole("img", {
        name: /2010 MODIS Terra true-color historical context/i,
      })
    ).toHaveAttribute("src", expect.stringContaining("gibs.earthdata.nasa.gov"));
    expect(screen.getByText("2010-10-15 observation")).toBeInTheDocument();
  });

  it("steps the Latest search one day back per failed load, then reports a coverage gap", () => {
    render(<HistoricalImageryTimeline parcel={FIXTURE_PARCELS[0]} />);

    const requestedTimes = new Set<string>();
    // walk from the start offset past the max lookback
    for (let attempt = 0; attempt <= LATEST_MAX_OFFSET_DAYS; attempt += 1) {
      const image = screen.queryByRole("img", {
        name: /Latest HLS Sentinel-2 true-color historical context/i,
      });
      if (!image) break;
      const time = /TIME=([0-9-]+)/.exec(
        decodeURIComponent(image.getAttribute("src") ?? "")
      )?.[1];
      if (time) requestedTimes.add(time);
      fireEvent.error(image);
    }

    // each retry asked GIBS for a different (earlier) date
    expect(requestedTimes.size).toBe(
      LATEST_MAX_OFFSET_DAYS - LATEST_START_OFFSET_DAYS + 1
    );
    expect(screen.getByText(/No recent clear pass/i)).toBeInTheDocument();
    expect(
      screen.getByText(/No usable Harmonized Landsat Sentinel-2 pass/i)
    ).toBeInTheDocument();
  });

  it("accepts a Latest image whose pixels cannot be verified (no canvas in jsdom)", async () => {
    render(<HistoricalImageryTimeline parcel={FIXTURE_PARCELS[0]} />);

    const image = screen.getByRole("img", {
      name: /Latest HLS Sentinel-2 true-color historical context/i,
    });
    fireEvent.load(image);

    // next/image resolves the user onLoad asynchronously (img.decode())
    await waitFor(() =>
      expect(screen.queryByRole("status")).not.toBeInTheDocument()
    );
    expect(screen.getByText(/observation$/)).toBeInTheDocument();
  });

  it("switches scenes and explains source, resolution, and evidentiary limits", () => {
    render(<HistoricalImageryTimeline parcel={FIXTURE_PARCELS[0]} />);

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

  it("shows honest coverage and network failure states", () => {
    render(<HistoricalImageryTimeline parcel={FIXTURE_PARCELS[0]} />);

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

  it("exposes the year switcher to assistive tech as a labeled group, not a bare div", () => {
    render(<HistoricalImageryTimeline parcel={FIXTURE_PARCELS[0]} />);

    expect(
      screen.getByRole("group", { name: "Historical imagery year" })
    ).toBeInTheDocument();
  });

  it("offers an aligned same-sensor before and after comparison with the parcel boundary", () => {
    render(<HistoricalImageryTimeline parcel={FIXTURE_PARCELS[0]} />);

    fireEvent.click(screen.getByRole("button", { name: "Compare years" }));

    expect(screen.getByTestId("imagery-comparison")).toBeInTheDocument();
    expect(
      screen.getByRole("img", { name: /1990 before image/i })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("img", { name: /2000 after image/i })
    ).toBeInTheDocument();
    expect(screen.getByTestId("parcel-boundary-overlay")).toBeInTheDocument();
    expect(
      screen.getByText(/same Landsat WELD source, 30 m resolution, and map extent/i)
    ).toBeInTheDocument();
  });

  it("lets keyboard and touch users control how much of the after image is revealed", () => {
    render(<HistoricalImageryTimeline parcel={FIXTURE_PARCELS[0]} />);
    fireEvent.click(screen.getByRole("button", { name: "Compare years" }));

    const slider = screen.getByRole("slider", { name: "Reveal 2000 imagery" });
    expect(slider).toHaveValue("50");

    fireEvent.change(slider, { target: { value: "72" } });

    expect(slider).toHaveValue("72");
    expect(screen.getByTestId("after-image-layer")).toHaveStyle({
      clipPath: "inset(0 0 0 28%)",
    });
  });
});
