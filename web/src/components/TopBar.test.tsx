import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { usePathname } from "next/navigation";
import { getPersonas } from "@/lib/api";
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

describe("TopBar", () => {
  it("renders the brand, nav links, and jurisdiction placeholder", async () => {
    vi.mocked(usePathname).mockReturnValue("/console");

    render(<TopBar jurisdiction="Test Jurisdiction" />);

    expect(screen.getByRole("link", { name: "mapencroach home" })).toHaveAttribute(
      "href",
      "/"
    );
    expect(screen.getAllByText("Command map").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Alerts").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Cases").length).toBeGreaterThan(0);
    expect(screen.getByRole("link", { name: "Demo roles" })).toHaveAttribute(
      "href",
      "/personas"
    );
    expect(screen.getByTestId("jurisdiction-placeholder")).toHaveTextContent(
      "Test Jurisdiction"
    );
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

  it("keeps the long jurisdiction label out of the smallest header layout", async () => {
    vi.mocked(usePathname).mockReturnValue("/console");

    render(<TopBar jurisdiction="Test Jurisdiction" />);
    expect(screen.getByTestId("jurisdiction-placeholder")).toHaveClass("hidden");
    expect(screen.getByTestId("jurisdiction-placeholder")).toHaveClass("lg:block");
    await waitFor(() => expect(getPersonas).toHaveBeenCalled());
  });
});
