import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { PersonaSwitcher } from "./PersonaSwitcher";
import { getPersonas, loginPersona } from "@/lib/api";

vi.mock("@/lib/api", () => ({
  getPersonas: vi.fn(),
  loginPersona: vi.fn(),
  TOKEN_COOKIE: "mapencroach_token",
  PERSONA_COOKIE: "mapencroach_persona",
}));

function clearCookies() {
  document.cookie = "mapencroach_token=; path=/; max-age=0";
  document.cookie = "mapencroach_persona=; path=/; max-age=0";
}

describe("PersonaSwitcher", () => {
  afterEach(() => {
    clearCookies();
    vi.restoreAllMocks();
  });

  it("renders nothing when getPersonas returns an empty list", async () => {
    vi.mocked(getPersonas).mockResolvedValue([]);

    const { container } = render(<PersonaSwitcher />);

    await waitFor(() => {
      expect(getPersonas).toHaveBeenCalled();
    });
    expect(container).toBeEmptyDOMElement();
  });

  it("renders the switcher with options when personas exist", async () => {
    vi.mocked(getPersonas).mockResolvedValue([
      {
        id: "persona-1",
        name: "Deputy Collector",
        role: "case_officer",
        jurisdiction_id: "UK-URBAN-01",
        description: "Handles show-cause notices.",
      },
      {
        id: "persona-2",
        name: "Viewer",
        role: "viewer",
        jurisdiction_id: "UK-URBAN-01",
        description: "Read-only access.",
      },
    ]);

    render(<PersonaSwitcher />);

    await waitFor(() => {
      expect(screen.getByTestId("persona-switcher")).toBeInTheDocument();
    });

    expect(screen.getByText("Default officer")).toBeInTheDocument();

    const select = screen.getByTestId("persona-select") as HTMLSelectElement;
    const options = Array.from(select.querySelectorAll("option"));
    expect(options).toHaveLength(3);
    expect(options[0]).toBeDisabled();
    expect(options[0].textContent).toBe("Switch persona…");
    expect(options[1].textContent).toBe("Deputy Collector");
    expect(options[1]).toHaveValue("persona-1");
    expect(options[2].textContent).toBe("Viewer");
    expect(options[2]).toHaveValue("persona-2");
  });

  it("does not render the reset button when no persona cookie is set", async () => {
    vi.mocked(getPersonas).mockResolvedValue([
      {
        id: "persona-1",
        name: "Deputy Collector",
        role: "case_officer",
        jurisdiction_id: "UK-URBAN-01",
        description: "Handles show-cause notices.",
      },
    ]);

    render(<PersonaSwitcher />);

    await waitFor(() => {
      expect(screen.getByTestId("persona-switcher")).toBeInTheDocument();
    });

    expect(screen.queryByTestId("persona-reset")).not.toBeInTheDocument();
  });

  it("logs in on selection, sets cookies, and reloads the page", async () => {
    vi.mocked(getPersonas).mockResolvedValue([
      {
        id: "persona-1",
        name: "Deputy Collector",
        role: "case_officer",
        jurisdiction_id: "UK-URBAN-01",
        description: "Handles show-cause notices.",
      },
    ]);
    vi.mocked(loginPersona).mockResolvedValue({
      token: "tok-123",
      persona: {
        id: "persona-1",
        name: "Deputy Collector",
        role: "case_officer",
        jurisdiction_id: "UK-URBAN-01",
        description: "Handles show-cause notices.",
      },
    });

    const reloadSpy = vi.fn();
    Object.defineProperty(window, "location", {
      value: { ...window.location, reload: reloadSpy },
      writable: true,
    });

    render(<PersonaSwitcher />);

    await waitFor(() => {
      expect(screen.getByTestId("persona-select")).toBeInTheDocument();
    });

    fireEvent.change(screen.getByTestId("persona-select"), {
      target: { value: "persona-1" },
    });

    await waitFor(() => {
      expect(loginPersona).toHaveBeenCalledWith("persona-1");
    });

    await waitFor(() => {
      expect(reloadSpy).toHaveBeenCalled();
    });

    expect(document.cookie).toContain("mapencroach_token=tok-123");
    expect(document.cookie).toContain(
      "mapencroach_persona=Deputy%20Collector"
    );
  });

  it("shows an error message when the persona switch fails", async () => {
    vi.mocked(getPersonas).mockResolvedValue([
      {
        id: "persona-1",
        name: "Deputy Collector",
        role: "case_officer",
        jurisdiction_id: "UK-URBAN-01",
        description: "Handles show-cause notices.",
      },
    ]);
    vi.mocked(loginPersona).mockResolvedValue(null);

    render(<PersonaSwitcher />);

    await waitFor(() => {
      expect(screen.getByTestId("persona-select")).toBeInTheDocument();
    });

    fireEvent.change(screen.getByTestId("persona-select"), {
      target: { value: "persona-1" },
    });

    await waitFor(() => {
      expect(screen.getByText("Persona switch failed")).toBeInTheDocument();
    });
  });

  it("shows the reset button when the persona cookie is set, and clears it on click", async () => {
    document.cookie = "mapencroach_persona=Deputy%20Collector; path=/";
    vi.mocked(getPersonas).mockResolvedValue([
      {
        id: "persona-1",
        name: "Deputy Collector",
        role: "case_officer",
        jurisdiction_id: "UK-URBAN-01",
        description: "Handles show-cause notices.",
      },
    ]);

    const reloadSpy = vi.fn();
    Object.defineProperty(window, "location", {
      value: { ...window.location, reload: reloadSpy },
      writable: true,
    });

    render(<PersonaSwitcher />);

    await waitFor(() => {
      expect(screen.getByTestId("persona-reset")).toBeInTheDocument();
    });

    expect(screen.getByTestId("persona-current")).toHaveTextContent(
      "Deputy Collector"
    );

    fireEvent.click(screen.getByTestId("persona-reset"));

    await waitFor(() => {
      expect(reloadSpy).toHaveBeenCalled();
    });
  });
});
