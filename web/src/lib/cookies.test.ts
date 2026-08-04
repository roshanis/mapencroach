import { afterEach, describe, expect, it, vi } from "vitest";
import {
  COOKIE_MAX_AGE,
  PERSONA_META_COOKIE,
  buildCookieString,
  clearCookie,
  readCookie,
  setCookie,
} from "./cookies";

function clearAllTestCookies() {
  document.cookie = "test_cookie=; path=/; max-age=0";
  document.cookie = `${PERSONA_META_COOKIE}=; path=/; max-age=0`;
}

describe("cookies", () => {
  afterEach(() => {
    clearAllTestCookies();
  });

  it("round-trips a simple value with setCookie/readCookie", () => {
    setCookie("test_cookie", "hello");
    expect(readCookie("test_cookie")).toBe("hello");
  });

  it("returns undefined for a cookie that was never set", () => {
    expect(readCookie("does_not_exist")).toBeUndefined();
  });

  it("clearCookie removes a previously set cookie", () => {
    setCookie("test_cookie", "hello");
    expect(readCookie("test_cookie")).toBe("hello");
    clearCookie("test_cookie");
    expect(readCookie("test_cookie")).toBeUndefined();
  });

  it("encodes and decodes values that need escaping (JSON)", () => {
    const value = JSON.stringify({
      name: "Vice Chairman, HRDA",
      role: "viewer",
      jurisdiction_id: "state",
      jurisdiction_name: "Haridwar–Roorkee Development Authority",
    });
    setCookie(PERSONA_META_COOKIE, value);
    expect(readCookie(PERSONA_META_COOKIE)).toBe(value);
    expect(JSON.parse(readCookie(PERSONA_META_COOKIE) as string)).toEqual(
      JSON.parse(value)
    );
  });

  it("exports COOKIE_MAX_AGE and PERSONA_META_COOKIE constants", () => {
    expect(COOKIE_MAX_AGE).toBe(28800);
    expect(PERSONA_META_COOKIE).toBe("mapencroach_persona_meta");
  });
});

describe("cookie Secure attribute", () => {
  const originalLocation = window.location;

  afterEach(() => {
    clearAllTestCookies();
    Object.defineProperty(window, "location", {
      value: originalLocation,
      writable: true,
    });
    vi.restoreAllMocks();
  });

  it("does not append Secure over plain http (e.g. localhost dev)", () => {
    const setSpy = vi.spyOn(document, "cookie", "set");

    setCookie("test_cookie", "hello");

    expect(setSpy).toHaveBeenCalledOnce();
    expect(setSpy.mock.calls[0][0]).not.toContain("Secure");
  });

  it("appends Secure when the page is served over https — mapencroach_token carries a real bearer credential in live mode", () => {
    Object.defineProperty(window, "location", {
      value: { ...window.location, protocol: "https:" },
      writable: true,
    });
    const setSpy = vi.spyOn(document, "cookie", "set");

    setCookie("mapencroach_token", "tok-abc");

    expect(setSpy.mock.calls[0][0]).toContain("; Secure");
    expect(setSpy.mock.calls[0][0]).toContain("SameSite=Lax");
    expect(setSpy.mock.calls[0][0]).toContain("path=/");
  });

  it("clearCookie also appends Secure over https so the deletion write's attributes match", () => {
    Object.defineProperty(window, "location", {
      value: { ...window.location, protocol: "https:" },
      writable: true,
    });
    const setSpy = vi.spyOn(document, "cookie", "set");

    clearCookie("mapencroach_token");

    expect(setSpy.mock.calls[0][0]).toContain("; Secure");
  });
});

describe("buildCookieString Secure attribute", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("omits Secure under http (jsdom's default test origin)", () => {
    expect(window.location.protocol).toBe("http:");
    const cookieString = buildCookieString("test_cookie", "hello", COOKIE_MAX_AGE);
    expect(cookieString).not.toContain("Secure");
    expect(cookieString).toBe(
      "test_cookie=hello; path=/; max-age=28800; SameSite=Lax"
    );
  });

  it("appends Secure when the page is served over https", () => {
    vi.stubGlobal("location", { ...window.location, protocol: "https:" });
    const cookieString = buildCookieString("test_cookie", "hello", COOKIE_MAX_AGE);
    expect(cookieString).toBe(
      "test_cookie=hello; path=/; max-age=28800; SameSite=Lax; Secure"
    );
  });

  it("setCookie omits Secure under http", () => {
    setCookie("test_cookie", "hello");
    expect(readCookie("test_cookie")).toBe("hello");
  });

  it("setCookie appends Secure under https", () => {
    vi.stubGlobal("location", { ...window.location, protocol: "https:" });
    expect(buildCookieString("test_cookie", "hello", COOKIE_MAX_AGE)).toContain(
      "; Secure"
    );
  });

  it("clearCookie's cookie string omits Secure under http and appends it under https", () => {
    expect(buildCookieString("test_cookie", undefined, 0)).toBe(
      "test_cookie=; path=/; max-age=0; SameSite=Lax"
    );
    vi.stubGlobal("location", { ...window.location, protocol: "https:" });
    expect(buildCookieString("test_cookie", undefined, 0)).toBe(
      "test_cookie=; path=/; max-age=0; SameSite=Lax; Secure"
    );
  });
});
