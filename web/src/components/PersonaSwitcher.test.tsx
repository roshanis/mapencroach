import { afterEach, describe, expect, it, vi } from "vitest";
import { loginPersona } from "@/lib/api";
import { PERSONA_META_COOKIE } from "@/lib/cookies";
import { exitPersona, switchPersona } from "./PersonaSwitcher";

// PersonaSwitcher no longer renders a <select> UI (that's now DemoMenu's
// job — see DemoMenu.test.tsx). This file only covers the shared
// switch/exit helpers that DemoMenu and ViewingAsBanner import from here.

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

function mockReload() {
  const reloadSpy = vi.fn();
  Object.defineProperty(window, "location", {
    value: { ...window.location, reload: reloadSpy },
    writable: true,
  });
  return reloadSpy;
}

describe("switchPersona", () => {
  afterEach(() => {
    clearAllCookies();
    vi.restoreAllMocks();
  });

  it("returns false and sets no cookies when loginPersona fails", async () => {
    vi.mocked(loginPersona).mockResolvedValue(null);
    const reloadSpy = mockReload();

    const ok = await switchPersona("persona-1");

    expect(ok).toBe(false);
    expect(document.cookie).not.toContain("mapencroach_token=");
    expect(reloadSpy).not.toHaveBeenCalled();
  });

  it("sets token/persona/meta cookies, reloads, and returns true on success", async () => {
    vi.mocked(loginPersona).mockResolvedValue({
      token: "tok-123",
      persona: {
        id: "persona-1",
        name: "Deputy Collector",
        role: "case_officer",
        jurisdiction_id: "UK-URBAN-01",
        jurisdiction_name: "Urban Division",
        description: "Handles show-cause notices.",
      },
    });
    const reloadSpy = mockReload();

    const ok = await switchPersona("persona-1");

    expect(ok).toBe(true);
    expect(loginPersona).toHaveBeenCalledWith("persona-1");
    expect(document.cookie).toContain("mapencroach_token=tok-123");
    expect(document.cookie).toContain("mapencroach_persona=Deputy%20Collector");
    expect(document.cookie).toContain(`${PERSONA_META_COOKIE}=`);
    expect(reloadSpy).toHaveBeenCalled();
  });
});

describe("exitPersona", () => {
  afterEach(() => {
    clearAllCookies();
    vi.restoreAllMocks();
  });

  it("clears the token, persona, and persona-meta cookies and reloads", () => {
    document.cookie = "mapencroach_token=tok-abc; path=/";
    document.cookie = "mapencroach_persona=Deputy%20Collector; path=/";
    document.cookie = `${PERSONA_META_COOKIE}=${encodeURIComponent(
      JSON.stringify({ name: "Deputy Collector" })
    )}; path=/`;
    const reloadSpy = mockReload();

    exitPersona();

    expect(document.cookie).not.toContain("mapencroach_token=tok-abc");
    expect(document.cookie).not.toContain("mapencroach_persona=Deputy");
    expect(document.cookie).not.toContain(`${PERSONA_META_COOKIE}=%7B`);
    expect(reloadSpy).toHaveBeenCalled();
  });
});
