import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import LandingPage from "./page";

describe("LandingPage", () => {
  it("leads with the product outcome and a direct path into the console", () => {
    render(<LandingPage />);

    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "See land risk early. Move every case lawfully.",
      })
    ).toBeInTheDocument();
    expect(
      screen.getAllByRole("link", { name: "Open command map" })[0]
    ).toHaveAttribute("href", "/console");
    expect(
      screen.getByRole("link", { name: "See how it works" })
    ).toHaveAttribute("href", "#how-it-works");
  });

  it("explains the operating model and separates context from evidence", () => {
    render(<LandingPage />);

    expect(
      screen.getByRole("heading", { name: "From signal to lawful action" })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", {
        name: "Prioritize with context. Enforce with evidence.",
      })
    ).toBeInTheDocument();
    expect(screen.getByText("30", { selector: "dd" })).toBeInTheDocument();
    expect(screen.getByText("Monitored parcels")).toBeInTheDocument();
  });

  it("provides useful landmark navigation and a second conversion point", () => {
    render(<LandingPage />);

    expect(screen.getByRole("navigation", { name: "Landing" })).toBeInTheDocument();
    expect(screen.getByRole("contentinfo")).toBeInTheDocument();
    expect(
      screen.getAllByRole("link", { name: "Open command map" })
    ).toHaveLength(3);
  });
});
