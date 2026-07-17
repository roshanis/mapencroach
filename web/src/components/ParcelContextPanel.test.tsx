import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FIXTURE_PARCEL_CONTEXTS } from "@/lib/fixtures";
import { ParcelContextPanel } from "./ParcelContextPanel";

describe("ParcelContextPanel", () => {
  it("keeps context separate from evidence and shows identity, trends, and provenance", () => {
    render(<ParcelContextPanel context={FIXTURE_PARCEL_CONTEXTS["PCL-1001"]} />);

    expect(
      screen.getByText(/contextual signals are not enforcement evidence/i)
    ).toBeInTheDocument();
    expect(screen.getByText("UK17HR0001001")).toBeInTheDocument();
    expect(screen.getByText("Night-light intensity")).toBeInTheDocument();
    expect(screen.getByText("Illustrative demo")).toBeInTheDocument();
    expect(screen.getByText("mapencroach demo")).toBeInTheDocument();
    expect(screen.getByText(/not a parcel measurement/i)).toBeInTheDocument();
  });

  it("shows an honest empty state for a parcel with no geographic match", () => {
    render(<ParcelContextPanel context={FIXTURE_PARCEL_CONTEXTS["PCL-1002"]} />);

    expect(screen.getByText(/no context dataset is linked/i)).toBeInTheDocument();
    expect(screen.queryByText("Night-light intensity")).not.toBeInTheDocument();
  });

  it("distinguishes unavailable context from an empty result", () => {
    render(<ParcelContextPanel context={undefined} />);

    expect(screen.getByText(/context could not be loaded/i)).toBeInTheDocument();
  });
});
