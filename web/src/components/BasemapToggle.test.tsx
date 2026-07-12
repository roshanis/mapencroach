import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { BasemapToggle } from "./BasemapToggle";

describe("BasemapToggle", () => {
  it("renders the container and both buttons", () => {
    render(<BasemapToggle mode="satellite" onChange={vi.fn()} />);
    expect(screen.getByTestId("basemap-toggle")).toBeInTheDocument();
    expect(screen.getByTestId("basemap-satellite")).toBeInTheDocument();
    expect(screen.getByTestId("basemap-streets")).toBeInTheDocument();
  });

  it("marks the satellite button active when mode is satellite", () => {
    render(<BasemapToggle mode="satellite" onChange={vi.fn()} />);
    const satelliteButton = screen.getByTestId("basemap-satellite");
    const streetsButton = screen.getByTestId("basemap-streets");
    expect(satelliteButton).toHaveClass("bg-gov");
    expect(streetsButton).not.toHaveClass("bg-gov");
  });

  it("marks the streets button active when mode is streets", () => {
    render(<BasemapToggle mode="streets" onChange={vi.fn()} />);
    const satelliteButton = screen.getByTestId("basemap-satellite");
    const streetsButton = screen.getByTestId("basemap-streets");
    expect(streetsButton).toHaveClass("bg-gov");
    expect(satelliteButton).not.toHaveClass("bg-gov");
  });

  it("calls onChange with 'streets' when the inactive streets button is clicked", () => {
    const onChange = vi.fn();
    render(<BasemapToggle mode="satellite" onChange={onChange} />);
    fireEvent.click(screen.getByTestId("basemap-streets"));
    expect(onChange).toHaveBeenCalledWith("streets");
  });

  it("calls onChange with 'satellite' when the inactive satellite button is clicked", () => {
    const onChange = vi.fn();
    render(<BasemapToggle mode="streets" onChange={onChange} />);
    fireEvent.click(screen.getByTestId("basemap-satellite"));
    expect(onChange).toHaveBeenCalledWith("satellite");
  });
});
