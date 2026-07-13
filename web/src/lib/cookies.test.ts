import { afterEach, describe, expect, it } from "vitest";
import {
  COOKIE_MAX_AGE,
  PERSONA_META_COOKIE,
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
