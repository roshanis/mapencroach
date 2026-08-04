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
