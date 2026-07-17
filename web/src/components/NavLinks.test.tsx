import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { usePathname } from "next/navigation";
import { NavLinks } from "./NavLinks";

vi.mock("next/navigation", () => ({
  usePathname: vi.fn(),
}));

describe("NavLinks", () => {
  it("keeps primary navigation focused on operational work", () => {
    vi.mocked(usePathname).mockReturnValue("/console");

    render(<NavLinks />);

    expect(screen.getAllByText("Command map").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Alerts").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Cases").length).toBeGreaterThan(0);
    expect(screen.queryByText("Personas")).not.toBeInTheDocument();
  });

  it("marks Command map as active on the console path", () => {
    vi.mocked(usePathname).mockReturnValue("/console");

    render(<NavLinks />);

    const mapLinks = screen.getAllByRole("link", { name: "Command map" });
    const desktopMapLink = mapLinks[0];
    expect(desktopMapLink).toHaveAttribute("href", "/console");
    expect(desktopMapLink).toHaveAttribute("aria-current", "page");
    expect(desktopMapLink.className).toContain("bg-white/15");

    const alertsLink = screen.getAllByRole("link", { name: "Alerts" })[0];
    const casesLink = screen.getAllByRole("link", { name: "Cases" })[0];
    expect(alertsLink).not.toHaveAttribute("aria-current");
    expect(casesLink).not.toHaveAttribute("aria-current");
  });

  it("does not mark Command map as active on the landing page", () => {
    vi.mocked(usePathname).mockReturnValue("/");

    render(<NavLinks />);

    const mapLink = screen.getAllByRole("link", { name: "Command map" })[0];
    expect(mapLink).not.toHaveAttribute("aria-current");
  });

  it("does not mark Command map as active on other paths", () => {
    vi.mocked(usePathname).mockReturnValue("/alerts");

    render(<NavLinks />);

    const mapLink = screen.getAllByRole("link", { name: "Command map" })[0];
    expect(mapLink).not.toHaveAttribute("aria-current");
  });

  it("marks Alerts as active on an exact /alerts path", () => {
    vi.mocked(usePathname).mockReturnValue("/alerts");

    render(<NavLinks />);

    const alertsLink = screen.getAllByRole("link", { name: "Alerts" })[0];
    expect(alertsLink).toHaveAttribute("aria-current", "page");
    expect(alertsLink.className).toContain("bg-white/15");

    const mapLink = screen.getAllByRole("link", { name: "Command map" })[0];
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
      vi.mocked(usePathname).mockReturnValue("/console");

      render(<NavLinks />);

      const hamburger = screen.getByTestId("nav-hamburger");
      expect(hamburger).toHaveAttribute("aria-expanded", "false");
    });

    it("expands the dropdown when clicked, and collapses again when clicking a link inside", () => {
      vi.mocked(usePathname).mockReturnValue("/console");

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
      const mobileAlertsLink = alertsLinksOpen[alertsLinksOpen.length - 1];
      mobileAlertsLink.addEventListener("click", (event) => event.preventDefault());
      fireEvent.click(mobileAlertsLink);

      expect(hamburger).toHaveAttribute("aria-expanded", "false");
      expect(screen.getAllByRole("link", { name: "Alerts" })).toHaveLength(1);
    });
  });
});
