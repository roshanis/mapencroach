import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FIXTURE_PARCELS } from "@/lib/fixtures";
import { HistoricalImageryTimeline } from "./HistoricalImageryTimeline";

describe("HistoricalImageryTimeline", () => {
  it("offers three usable historical maps and preserves the 1985 coverage gap", () => {
    render(<HistoricalImageryTimeline parcel={FIXTURE_PARCELS[0]} />);

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
});
