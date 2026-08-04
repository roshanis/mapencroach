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

  it("renders an http(s) source_url as a real link", () => {
    render(<ParcelContextPanel context={FIXTURE_PARCEL_CONTEXTS["PCL-1001"]} />);

    const link = screen.getByRole("link", { name: "Source documentation" });
    expect(link).toHaveAttribute(
      "href",
      FIXTURE_PARCEL_CONTEXTS["PCL-1001"].sources[0].source_url
    );
  });

  it("refuses to render a javascript: source_url as a clickable link", () => {
    const context = FIXTURE_PARCEL_CONTEXTS["PCL-1001"];
    const maliciousContext = {
      ...context,
      sources: [
        { ...context.sources[0], source_url: "javascript:alert(document.cookie)" },
      ],
    };

    render(<ParcelContextPanel context={maliciousContext} />);

    expect(
      screen.queryByRole("link", { name: "Source documentation" })
    ).not.toBeInTheDocument();
    expect(screen.getByText("Source documentation unavailable")).toBeInTheDocument();
  });

  it("refuses to render an unparsable source_url as a clickable link", () => {
    const context = FIXTURE_PARCEL_CONTEXTS["PCL-1001"];
    const brokenContext = {
      ...context,
      sources: [{ ...context.sources[0], source_url: "not a url" }],
    };

    render(<ParcelContextPanel context={brokenContext} />);

    expect(
      screen.queryByRole("link", { name: "Source documentation" })
    ).not.toBeInTheDocument();
    expect(screen.getByText("Source documentation unavailable")).toBeInTheDocument();
  });
});
