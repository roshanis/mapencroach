import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MapLegend } from "./MapLegend";

describe("MapLegend", () => {
  it("dedupes categories, preserving first-seen order", () => {
    render(<MapLegend categories={["waterbody", "forest", "waterbody"]} />);
    const legend = screen.getByTestId("map-legend");
    expect(legend).toHaveTextContent("Waterbody");
    expect(legend).toHaveTextContent("Forest");

    const rows = screen.getAllByTestId("map-legend-category-row");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("Waterbody");
    expect(rows[1]).toHaveTextContent("Forest");
  });

  it("renders the label text for each distinct category", () => {
    render(<MapLegend categories={["municipal", "industrial", "housing"]} />);
    const legend = screen.getByTestId("map-legend");
    expect(legend).toHaveTextContent("Municipal");
    expect(legend).toHaveTextContent("Industrial");
    expect(legend).toHaveTextContent("Housing");
  });

  it("renders the four fixed alert-tier dots", () => {
    render(<MapLegend categories={["forest"]} />);
    expect(screen.getByText("Red")).toBeInTheDocument();
    expect(screen.getByText("Amber")).toBeInTheDocument();
    expect(screen.getByText("Green")).toBeInTheDocument();
    expect(screen.getByText("Legacy")).toBeInTheDocument();
  });
});
