import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { getPersonas, loginPersona } from "@/lib/api";
import { PERSONA_META_COOKIE } from "@/lib/cookies";
import { DemoMenu } from "./DemoMenu";

vi.mock("@/lib/api", () => ({
  getPersonas: vi.fn(),
  loginPersona: vi.fn(),
  TOKEN_COOKIE: "mapencroach_token",
  PERSONA_COOKIE: "mapencroach_persona",
}));

function clearAllCookies() {
  document.cookie = "mapencroach_token=; path=/; max-age=0";
  document.cookie = "mapencroach_persona=; path=/; max-age=0";
  document.cookie = `${PERSONA_META_COOKIE}=; path=/; max-age=0`;
}

function setActivePersonaCookie() {
  document.cookie = `${PERSONA_META_COOKIE}=${encodeURIComponent(
    JSON.stringify({
      name: "Enforcement Officer, Haridwar",
      role: "case_officer",
      jurisdiction_id: "dist-a",
      jurisdiction_name: "Haridwar Division",
    })
  )}; path=/`;
}

async function openMenu() {
  fireEvent.click(screen.getByTestId("demo-menu-trigger"));
  await waitFor(() => {
    expect(screen.getByRole("menu")).toBeInTheDocument();
  });
}

describe("DemoMenu", () => {
  afterEach(() => {
    clearAllCookies();
    vi.restoreAllMocks();
  });

  it("is closed by default", async () => {
    vi.mocked(getPersonas).mockResolvedValue([]);

    render(<DemoMenu />);

    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(screen.getByTestId("demo-menu-trigger")).toHaveAttribute(
      "aria-expanded",
      "false"
    );
    await waitFor(() => expect(getPersonas).toHaveBeenCalled());
  });

  it("opens on click with role=menu, and closes again on a second click", async () => {
    vi.mocked(getPersonas).mockResolvedValue([]);

    render(<DemoMenu />);
    await waitFor(() => expect(getPersonas).toHaveBeenCalled());

    await openMenu();
    expect(screen.getByTestId("demo-menu-trigger")).toHaveAttribute(
      "aria-expanded",
      "true"
    );

    fireEvent.click(screen.getByTestId("demo-menu-trigger"));
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("lists persona names as menu items when personas are provided", async () => {
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

    render(<DemoMenu />);
    await waitFor(() => expect(getPersonas).toHaveBeenCalled());
    await openMenu();

    expect(
      screen.getByRole("menuitem", { name: "Deputy Collector" })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("menuitem", { name: "Viewer" })
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Persona switching needs the demo backend")
    ).not.toBeInTheDocument();
  });

  it("shows a muted no-backend line and the personas link when no personas are available", async () => {
    vi.mocked(getPersonas).mockResolvedValue([]);

    render(<DemoMenu />);
    await waitFor(() => expect(getPersonas).toHaveBeenCalled());
    await openMenu();

    expect(
      screen.getByText("Persona switching needs the demo backend")
    ).toBeInTheDocument();
    const personasLink = screen.getByRole("menuitem", {
      name: "Who sees what →",
    });
    expect(personasLink).toHaveAttribute("href", "/personas");
  });

  it("shows Exit persona only when a persona is active", async () => {
    vi.mocked(getPersonas).mockResolvedValue([]);

    const { unmount } = render(<DemoMenu />);
    await waitFor(() => expect(getPersonas).toHaveBeenCalled());
    await openMenu();

    expect(
      screen.queryByTestId("demo-menu-exit")
    ).not.toBeInTheDocument();
    unmount();
    clearAllCookies();
    vi.restoreAllMocks();

    setActivePersonaCookie();
    vi.mocked(getPersonas).mockResolvedValue([]);

    render(<DemoMenu />);
    await waitFor(() => expect(getPersonas).toHaveBeenCalled());
    await openMenu();

    expect(screen.getByTestId("demo-menu-exit")).toBeInTheDocument();
  });

  it("shows the active persona's name, role, and jurisdiction in the header line", async () => {
    setActivePersonaCookie();
    vi.mocked(getPersonas).mockResolvedValue([]);

    render(<DemoMenu />);
    await waitFor(() => expect(getPersonas).toHaveBeenCalled());
    await openMenu();

    const menu = screen.getByRole("menu");
    expect(menu).toHaveTextContent("Viewing as");
    expect(menu).toHaveTextContent("Enforcement Officer, Haridwar");
    expect(menu).toHaveTextContent("Case Officer");
    expect(menu).toHaveTextContent("Haridwar Division");
  });

  it("closes on Escape and returns focus to the trigger", async () => {
    vi.mocked(getPersonas).mockResolvedValue([]);

    render(<DemoMenu />);
    await waitFor(() => expect(getPersonas).toHaveBeenCalled());
    await openMenu();

    fireEvent.keyDown(document, { key: "Escape" });

    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(screen.getByTestId("demo-menu-trigger")).toHaveFocus();
  });

  it("closes when clicking outside the menu", async () => {
    vi.mocked(getPersonas).mockResolvedValue([]);

    render(
      <div>
        <DemoMenu />
        <button type="button">outside</button>
      </div>
    );
    await waitFor(() => expect(getPersonas).toHaveBeenCalled());
    await openMenu();

    fireEvent.mouseDown(screen.getByText("outside"));

    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("switches persona, sets cookies, and reloads when a menu item is selected", async () => {
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

    render(<DemoMenu />);
    await waitFor(() => expect(getPersonas).toHaveBeenCalled());
    await openMenu();

    fireEvent.click(screen.getByRole("menuitem", { name: "Deputy Collector" }));

    await waitFor(() => {
      expect(loginPersona).toHaveBeenCalledWith("persona-1");
    });
    await waitFor(() => expect(reloadSpy).toHaveBeenCalled());
    expect(document.cookie).toContain("mapencroach_token=tok-123");
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

    render(<DemoMenu />);
    await waitFor(() => expect(getPersonas).toHaveBeenCalled());
    await openMenu();

    fireEvent.click(screen.getByRole("menuitem", { name: "Deputy Collector" }));

    await waitFor(() => {
      expect(screen.getByText("Persona switch failed")).toBeInTheDocument();
    });
  });

  it("exits persona via the same exit action used by ViewingAsBanner", async () => {
    setActivePersonaCookie();
    vi.mocked(getPersonas).mockResolvedValue([]);
    const reloadSpy = vi.fn();
    Object.defineProperty(window, "location", {
      value: { ...window.location, reload: reloadSpy },
      writable: true,
    });

    render(<DemoMenu />);
    await waitFor(() => expect(getPersonas).toHaveBeenCalled());
    await openMenu();

    fireEvent.click(screen.getByTestId("demo-menu-exit"));

    await waitFor(() => expect(reloadSpy).toHaveBeenCalled());
    expect(document.cookie).not.toContain(PERSONA_META_COOKIE + "=%7B");
  });

  it("shows a 'Demo · Default officer' label when no persona is active", async () => {
    vi.mocked(getPersonas).mockResolvedValue([]);

    render(<DemoMenu />);
    await waitFor(() => expect(getPersonas).toHaveBeenCalled());

    expect(screen.getByTestId("demo-menu-trigger")).toHaveAttribute(
      "aria-label",
      "Demo · Default officer"
    );
  });

  it("shortens the active persona's name in the trigger label", async () => {
    setActivePersonaCookie();
    vi.mocked(getPersonas).mockResolvedValue([]);

    render(<DemoMenu />);
    await waitFor(() => expect(getPersonas).toHaveBeenCalled());

    await waitFor(() => {
      expect(screen.getByTestId("demo-menu-trigger")).toHaveAttribute(
        "aria-label",
        "Demo · Enforcement Officer"
      );
    });
  });
});
