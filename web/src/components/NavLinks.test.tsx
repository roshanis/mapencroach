import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { usePathname } from "next/navigation";
import { NavLinks } from "./NavLinks";

vi.mock("next/navigation", () => ({
  usePathname: vi.fn(),
}));

describe("NavLinks", () => {
  it("renders 4 nav items with the expected labels", () => {
    vi.mocked(usePathname).mockReturnValue("/");

    render(<NavLinks />);

    expect(screen.getAllByText("Map").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Alerts").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Cases").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Personas").length).toBeGreaterThan(0);
  });

  it("marks Map as active on the root path", () => {
    vi.mocked(usePathname).mockReturnValue("/");

    render(<NavLinks />);

    const mapLinks = screen.getAllByRole("link", { name: "Map" });
    const desktopMapLink = mapLinks[0];
    expect(desktopMapLink).toHaveAttribute("aria-current", "page");
    expect(desktopMapLink.className).toContain("bg-white/15");

    const alertsLink = screen.getAllByRole("link", { name: "Alerts" })[0];
    const casesLink = screen.getAllByRole("link", { name: "Cases" })[0];
    const personasLink = screen.getAllByRole("link", { name: "Personas" })[0];
    expect(alertsLink).not.toHaveAttribute("aria-current");
    expect(casesLink).not.toHaveAttribute("aria-current");
    expect(personasLink).not.toHaveAttribute("aria-current");
  });

  it("does not mark Map as active on other paths (no prefix matching against /)", () => {
    vi.mocked(usePathname).mockReturnValue("/alerts");

    render(<NavLinks />);

    const mapLink = screen.getAllByRole("link", { name: "Map" })[0];
    expect(mapLink).not.toHaveAttribute("aria-current");
  });

  it("marks Alerts as active on an exact /alerts path", () => {
    vi.mocked(usePathname).mockReturnValue("/alerts");

    render(<NavLinks />);

    const alertsLink = screen.getAllByRole("link", { name: "Alerts" })[0];
    expect(alertsLink).toHaveAttribute("aria-current", "page");
    expect(alertsLink.className).toContain("bg-white/15");

    const mapLink = screen.getAllByRole("link", { name: "Map" })[0];
    expect(mapLink).not.toHaveAttribute("aria-current");
  });

  it("marks Alerts as active on a nested /alerts/123 path (prefix matching)", () => {
    vi.mocked(usePathname).mockReturnValue("/alerts/123");

    render(<NavLinks />);

    const alertsLink = screen.getAllByRole("link", { name: "Alerts" })[0];
    expect(alertsLink).toHaveAttribute("aria-current", "page");
  });

  describe("mobile hamburger menu", () => {
    it("has a hamburger button collapsed by default", () => {
      vi.mocked(usePathname).mockReturnValue("/");

      render(<NavLinks />);

      const hamburger = screen.getByTestId("nav-hamburger");
      expect(hamburger).toHaveAttribute("aria-expanded", "false");
    });

    it("expands the dropdown when clicked, and collapses again when clicking a link inside", () => {
      vi.mocked(usePathname).mockReturnValue("/");

      render(<NavLinks />);

      const hamburger = screen.getByTestId("nav-hamburger");

      // Initially only the desktop link should be present (collapsed).
      expect(screen.getAllByRole("link", { name: "Alerts" })).toHaveLength(1);

      fireEvent.click(hamburger);

      expect(hamburger).toHaveAttribute("aria-expanded", "true");
      // Dropdown open: desktop + mobile links both present.
      const alertsLinksOpen = screen.getAllByRole("link", { name: "Alerts" });
      expect(alertsLinksOpen).toHaveLength(2);

      // Click the mobile dropdown's Alerts link (the last one rendered).
      fireEvent.click(alertsLinksOpen[alertsLinksOpen.length - 1]);

      expect(hamburger).toHaveAttribute("aria-expanded", "false");
      expect(screen.getAllByRole("link", { name: "Alerts" })).toHaveLength(1);
    });
  });
});
