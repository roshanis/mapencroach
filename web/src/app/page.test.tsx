import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getPersonas } from "@/lib/api";
import LandingPage from "./page";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

vi.mock("@/lib/api", () => ({
  getPersonas: vi.fn(),
  loginPersona: vi.fn(),
  TOKEN_COOKIE: "mapencroach_token",
  PERSONA_COOKIE: "mapencroach_persona",
}));

describe("LandingPage", () => {
  beforeEach(() => {
    // These tests exercise the static landing-page contract. Leave the
    // client request pending so it cannot update component state after a
    // synchronous assertion and produce a misleading React act() warning.
    vi.mocked(getPersonas).mockImplementation(() => new Promise(() => {}));
  });

  it("leads with the product outcome and a direct path to jurisdiction selection", () => {
    render(<LandingPage />);

    expect(screen.getByTestId("landing-shell")).toHaveClass(
      "bg-gray-100",
      "text-gray-900"
    );
    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "See land risk early. Move every case lawfully.",
      })
    ).toBeInTheDocument();
    expect(
      screen.getAllByRole("link", { name: "Open command map" })[0]
    ).toHaveAttribute("href", "#demo-access");
    expect(
      screen.getAllByRole("link", { name: "Open command map" })[0]
    ).toHaveClass("bg-gov");
    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "See land risk early. Move every case lawfully.",
      })
    ).toHaveClass("font-semibold", "tracking-tight");
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
    screen.getAllByRole("link", { name: "Open command map" }).forEach((link) => {
      expect(link).toHaveAttribute("href", "#demo-access");
    });
  });

  it("includes jurisdiction and persona selection on the landing page", () => {
    render(<LandingPage />);

    expect(
      screen.getByRole("heading", { name: "Choose your jurisdiction" })
    ).toBeInTheDocument();
    expect(screen.getByTestId("jurisdiction-persona-picker")).toHaveAttribute(
      "id",
      "demo-access"
    );
  });
});
