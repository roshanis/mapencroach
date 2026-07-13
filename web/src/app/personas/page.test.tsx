import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { usePathname } from "next/navigation";
import { getPersonas } from "@/lib/api";
import { FIXTURE_PERSONAS } from "@/lib/fixtures";
import PersonasPage from "./page";

vi.mock("next/navigation", () => ({
  usePathname: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  getPersonas: vi.fn(),
  loginPersona: vi.fn(),
  TOKEN_COOKIE: "mapencroach_token",
  PERSONA_COOKIE: "mapencroach_persona",
}));

function clearCookies() {
  document.cookie = "mapencroach_token=; path=/; max-age=0";
  document.cookie = "mapencroach_persona=; path=/; max-age=0";
  document.cookie = "mapencroach_persona_meta=; path=/; max-age=0";
}

describe("PersonasPage", () => {
  afterEach(() => {
    clearCookies();
    vi.restoreAllMocks();
  });

  it("renders the header and intro copy", async () => {
    vi.mocked(usePathname).mockReturnValue("/personas");
    vi.mocked(getPersonas).mockResolvedValue([]);

    render(<PersonasPage />);

    expect(screen.getByText("Who sees what")).toBeInTheDocument();
    expect(
      screen.getByText(/Pick a persona to experience their exact view\./)
    ).toBeInTheDocument();
    await waitFor(() => expect(getPersonas).toHaveBeenCalled());
  });

  it("falls back to FIXTURE_PERSONAS and renders a card per persona when getPersonas returns []", async () => {
    vi.mocked(usePathname).mockReturnValue("/personas");
    vi.mocked(getPersonas).mockResolvedValue([]);

    render(<PersonasPage />);

    await waitFor(() => {
      FIXTURE_PERSONAS.forEach((persona) => {
        expect(screen.getByText(persona.name)).toBeInTheDocument();
      });
    });

    // Fixture-mode cards have no working backend, so "View as" stays disabled.
    const button = screen.getByTestId(
      `persona-view-as-${FIXTURE_PERSONAS[0].id}`
    );
    expect(button).toBeDisabled();
  });

  it("renders cards from getPersonas when the backend returns personas", async () => {
    vi.mocked(usePathname).mockReturnValue("/personas");
    vi.mocked(getPersonas).mockResolvedValue([
      {
        id: "persona-1",
        name: "Deputy Collector",
        role: "case_officer",
        jurisdiction_id: "dist-a",
        description: "Handles show-cause notices.",
        visible_parcels: 10,
      },
    ]);

    render(<PersonasPage />);

    await waitFor(() => {
      expect(
        screen.getByText("Deputy Collector", { selector: "p" })
      ).toBeInTheDocument();
    });
    FIXTURE_PERSONAS.forEach((persona) => {
      expect(
        screen.queryByText(persona.name, { selector: "p" })
      ).not.toBeInTheDocument();
    });
  });
});
