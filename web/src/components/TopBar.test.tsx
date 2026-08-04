import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { usePathname } from "next/navigation";
import { getPersonas } from "@/lib/api";
import { PERSONA_META_COOKIE } from "@/lib/cookies";
import { TopBar } from "./TopBar";

vi.mock("next/navigation", () => ({
  usePathname: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  getPersonas: vi.fn().mockResolvedValue([]),
  loginPersona: vi.fn(),
  TOKEN_COOKIE: "mapencroach_token",
  PERSONA_COOKIE: "mapencroach_persona",
}));

function clearPersonaMetaCookie() {
  document.cookie = `${PERSONA_META_COOKIE}=; path=/; max-age=0`;
}

describe("TopBar", () => {
  afterEach(() => {
    clearPersonaMetaCookie();
  });

  it("renders the brand, nav links, jurisdiction placeholder, and demo menu trigger", async () => {
    vi.mocked(usePathname).mockReturnValue("/console");

    render(<TopBar jurisdiction="Test Jurisdiction" />);

    expect(screen.getByRole("link", { name: "mapencroach home" })).toHaveAttribute(
      "href",
      "/"
    );
    expect(screen.getAllByText("Command map").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Alerts").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Cases").length).toBeGreaterThan(0);
    expect(screen.getByTestId("demo-menu-trigger")).toBeInTheDocument();
    expect(screen.getByTestId("jurisdiction-placeholder")).toHaveTextContent(
      "Test Jurisdiction"
    );
    await waitFor(() => expect(getPersonas).toHaveBeenCalled());
  });

  it("renders the DemoMenu trigger instead of the old PersonaSwitcher select or a standalone Demo roles link", async () => {
    vi.mocked(usePathname).mockReturnValue("/console");

    render(<TopBar />);

    expect(screen.getByTestId("demo-menu-trigger")).toBeInTheDocument();
    expect(screen.queryByTestId("persona-switcher")).not.toBeInTheDocument();
    expect(screen.queryByTestId("persona-select")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Demo roles" })
    ).not.toBeInTheDocument();
    await waitFor(() => expect(getPersonas).toHaveBeenCalled());
  });

  it("gives the header position: relative so the mobile nav dropdown can anchor to it", async () => {
    vi.mocked(usePathname).mockReturnValue("/console");

    const { container } = render(<TopBar />);
    const header = container.querySelector("header");
    expect(header).toHaveClass("relative");
    await waitFor(() => expect(getPersonas).toHaveBeenCalled());
  });

  it("hides the subtitle below md breakpoint", async () => {
    vi.mocked(usePathname).mockReturnValue("/console");

    render(<TopBar />);
    const subtitle = screen.getByText("Encroachment Monitoring Console");
    expect(subtitle).toHaveClass("hidden");
    expect(subtitle).toHaveClass("md:inline");
    await waitFor(() => expect(getPersonas).toHaveBeenCalled());
  });

  it("truncates the jurisdiction chip instead of hiding it at the smallest header layout", async () => {
    vi.mocked(usePathname).mockReturnValue("/console");

    render(<TopBar jurisdiction="Test Jurisdiction" />);
    const chip = screen.getByTestId("jurisdiction-placeholder");
    expect(chip).toHaveClass("truncate");
    expect(chip).toHaveClass("max-w-24");
    expect(chip).not.toHaveClass("hidden");
    await waitFor(() => expect(getPersonas).toHaveBeenCalled());
  });

  it("prefers the active persona's jurisdiction over the jurisdiction prop", async () => {
    vi.mocked(usePathname).mockReturnValue("/console");
    document.cookie = `${PERSONA_META_COOKIE}=${encodeURIComponent(
      JSON.stringify({
        name: "Enforcement Officer, Haridwar",
        role: "case_officer",
        jurisdiction_id: "dist-a",
        jurisdiction_name: "Haridwar Division",
      })
    )}; path=/`;

    render(<TopBar jurisdiction="Test Jurisdiction" />);

    await waitFor(() => {
      expect(screen.getByTestId("jurisdiction-placeholder")).toHaveTextContent(
        "Haridwar Division"
      );
    });
    expect(
      screen.getByTestId("jurisdiction-placeholder")
    ).not.toHaveTextContent("Test Jurisdiction");
  });

  it("falls back to the jurisdiction prop when no persona is active", async () => {
    vi.mocked(usePathname).mockReturnValue("/console");

    render(<TopBar jurisdiction="Test Jurisdiction" />);

    await waitFor(() => expect(getPersonas).toHaveBeenCalled());
    expect(screen.getByTestId("jurisdiction-placeholder")).toHaveTextContent(
      "Test Jurisdiction"
    );
  });
});
