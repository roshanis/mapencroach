import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FIXTURE_PARCELS } from "@/lib/fixtures";
import { monthlyScenes } from "@/lib/latest-imagery";
import { HistoricalImageryTimeline } from "./HistoricalImageryTimeline";

// The component builds its scenes from the real clock; derive expectations the
// same way so the suite stays green as months roll over.
const SCENES = monthlyScenes();
const YEAR = SCENES[0].startDate.slice(0, 4);
const FIRST_MONTH = SCENES[0];

function latestImage() {
  return screen.getByRole("img", {
    name: /Latest .* HLS Sentinel-2 true-color snapshot/i,
  });
}

describe("HistoricalImageryTimeline", () => {
  it("offers only current-year monthly snapshots plus Latest, defaulting to Latest", () => {
    render(<HistoricalImageryTimeline parcel={FIXTURE_PARCELS[0]} />);

    expect(
      screen.getByRole("heading", { name: "Imagery Timeline" })
    ).toBeInTheDocument();
    expect(
      screen.getByText(new RegExp(`Monthly ${YEAR} true-color snapshots`))
    ).toBeInTheDocument();

    // no archival years anywhere
    for (const year of ["1985", "1990", "2000", "2010"]) {
      expect(
        screen.queryByRole("button", { name: new RegExp(year) })
      ).not.toBeInTheDocument();
    }

    const monthGroup = screen.getByRole("group", { name: "Imagery month" });
    expect(monthGroup).toBeInTheDocument();
    for (const scene of SCENES) {
      expect(
        screen.getByRole("button", { name: scene.label })
      ).toBeInTheDocument();
    }
    expect(screen.getByRole("button", { name: "Latest" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );

    const src = decodeURIComponent(latestImage().getAttribute("src") ?? "");
    expect(src).toContain("gibs.earthdata.nasa.gov");
    expect(src).toContain("HLS_S30_Nadir_BRDF_Adjusted_Reflectance");
    expect(src).toContain(`TIME=${SCENES[SCENES.length - 1].endDate}`);
  });

  it("switching to a month requests that month's window end date", () => {
    render(<HistoricalImageryTimeline parcel={FIXTURE_PARCELS[0]} />);

    fireEvent.click(screen.getByRole("button", { name: FIRST_MONTH.label }));

    const image = screen.getByRole("img", {
      name: new RegExp(
        `${FIRST_MONTH.label} ${YEAR} HLS Sentinel-2 true-color snapshot`,
        "i"
      ),
    });
    expect(decodeURIComponent(image.getAttribute("src") ?? "")).toContain(
      `TIME=${FIRST_MONTH.endDate}`
    );
    expect(
      screen.getByText(`searching back from ${FIRST_MONTH.endDate}…`)
    ).toBeInTheDocument();
  });

  it("steps a month's search day by day and reports a coverage gap at the window start", () => {
    render(<HistoricalImageryTimeline parcel={FIXTURE_PARCELS[0]} />);
    fireEvent.click(screen.getByRole("button", { name: FIRST_MONTH.label }));

    const daysInWindow =
      Number(FIRST_MONTH.endDate.slice(8, 10)) -
      Number(FIRST_MONTH.startDate.slice(8, 10)) +
      1;
    const requestedTimes = new Set<string>();
    for (let attempt = 0; attempt <= daysInWindow; attempt += 1) {
      const image = screen.queryByRole("img", {
        name: /HLS Sentinel-2 true-color snapshot/i,
      });
      if (!image) break;
      const time = /TIME=([0-9-]+)/.exec(
        decodeURIComponent(image.getAttribute("src") ?? "")
      )?.[1];
      if (time) requestedTimes.add(time);
      fireEvent.error(image);
    }

    expect(requestedTimes.size).toBe(daysInWindow);
    expect(screen.getByText(/No clear pass/)).toBeInTheDocument();
    expect(
      screen.getByText(
        new RegExp(
          `between ${FIRST_MONTH.startDate} and ${FIRST_MONTH.endDate}`
        )
      )
    ).toBeInTheDocument();
  });

  it("accepts an image whose pixels cannot be verified and shows its capture date", async () => {
    render(<HistoricalImageryTimeline parcel={FIXTURE_PARCELS[0]} />);

    fireEvent.load(latestImage());

    // next/image resolves the user onLoad asynchronously (img.decode())
    await waitFor(() =>
      expect(screen.queryByRole("status")).not.toBeInTheDocument()
    );
    expect(
      screen.getByText(
        `${SCENES[SCENES.length - 1].endDate} observation`
      )
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Harmonized Landsat Sentinel-2/)
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Planning context only.*not enforcement evidence/i)
    ).toBeInTheDocument();
  });

  it("compares the first month against Latest with the parcel boundary", () => {
    render(<HistoricalImageryTimeline parcel={FIXTURE_PARCELS[0]} />);

    fireEvent.click(screen.getByRole("button", { name: "Compare months" }));

    expect(screen.getByTestId("imagery-comparison")).toBeInTheDocument();
    expect(
      screen.getByRole("img", {
        name: new RegExp(`${FIRST_MONTH.label} ${YEAR} before image`, "i"),
      })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("img", { name: /Latest after image/i })
    ).toBeInTheDocument();
    expect(screen.getByTestId("parcel-boundary-overlay")).toBeInTheDocument();
    expect(
      screen.getByText(/same HLS Sentinel-2 source, 30 m resolution, and map extent/i)
    ).toBeInTheDocument();
  });

  it("lets keyboard and touch users control how much of the after image is revealed", () => {
    render(<HistoricalImageryTimeline parcel={FIXTURE_PARCELS[0]} />);
    fireEvent.click(screen.getByRole("button", { name: "Compare months" }));

    const slider = screen.getByRole("slider", { name: "Reveal Latest imagery" });
    expect(slider).toHaveValue("50");

    fireEvent.change(slider, { target: { value: "72" } });

    expect(slider).toHaveValue("72");
    expect(screen.getByTestId("after-image-layer")).toHaveStyle({
      clipPath: "inset(0 0 0 28%)",
    });
  });
});
