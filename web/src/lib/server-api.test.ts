import { afterEach, describe, expect, it, vi } from "vitest";
import { PERSONA_META_COOKIE } from "./cookies";

const cookiesMock = vi.fn();

vi.mock("next/headers", () => ({
  cookies: () => cookiesMock(),
}));

vi.mock("./api", () => ({
  getAlerts: vi.fn(),
  getCase: vi.fn(),
  getCaseImagery: vi.fn(),
  getCases: vi.fn(),
  getParcel: vi.fn(),
  getParcelContext: vi.fn(),
  getParcels: vi.fn(),
  getWatchEntry: vi.fn(),
  getWatchlist: vi.fn(),
  TOKEN_COOKIE: "mapencroach_token",
}));

// Imported after the mocks so `cookies` and the api.ts functions resolve to
// the mocks above inside server-api.ts.
const { serverToken, getPersonaRoleForRequest } = await import("./server-api");

const ORIGINAL_TOKEN = process.env.MAPENCROACH_API_TOKEN;

afterEach(() => {
  if (ORIGINAL_TOKEN === undefined) {
    delete process.env.MAPENCROACH_API_TOKEN;
  } else {
    process.env.MAPENCROACH_API_TOKEN = ORIGINAL_TOKEN;
  }
  vi.restoreAllMocks();
});

describe("serverToken", () => {
  it("prefers the session cookie over the server-only fallback token", async () => {
    process.env.MAPENCROACH_API_TOKEN = "server-fallback";
    cookiesMock.mockResolvedValue({
      get: (name: string) =>
        name === "mapencroach_token" ? { value: "cookie-tok" } : undefined,
    });

    await expect(serverToken()).resolves.toBe("cookie-tok");
  });

  it("falls back to MAPENCROACH_API_TOKEN when there is no session cookie", async () => {
    process.env.MAPENCROACH_API_TOKEN = "server-fallback";
    cookiesMock.mockResolvedValue({ get: () => undefined });

    await expect(serverToken()).resolves.toBe("server-fallback");
  });

  it("returns undefined when there is no cookie and no server-only token configured", async () => {
    delete process.env.MAPENCROACH_API_TOKEN;
    cookiesMock.mockResolvedValue({ get: () => undefined });

    await expect(serverToken()).resolves.toBeUndefined();
  });

  it("falls back to MAPENCROACH_API_TOKEN when cookies() throws (no request context)", async () => {
    process.env.MAPENCROACH_API_TOKEN = "server-fallback";
    cookiesMock.mockRejectedValue(new Error("no request context"));

    await expect(serverToken()).resolves.toBe("server-fallback");
  });
});

function mockCookieValue(value: string | undefined) {
  cookiesMock.mockResolvedValue({
    get: (name: string) =>
      name === PERSONA_META_COOKIE && value !== undefined ? { value } : undefined,
  });
}

describe("getPersonaRoleForRequest", () => {
  it("returns the role parsed from a well-formed persona-meta cookie", async () => {
    mockCookieValue(JSON.stringify({ name: "Demo Officer", role: "viewer" }));

    await expect(getPersonaRoleForRequest()).resolves.toBe("viewer");
  });

  it("returns undefined when the persona-meta cookie is absent", async () => {
    mockCookieValue(undefined);

    await expect(getPersonaRoleForRequest()).resolves.toBeUndefined();
  });

  it("returns undefined when the cookie value is malformed JSON", async () => {
    mockCookieValue("{not-json");

    await expect(getPersonaRoleForRequest()).resolves.toBeUndefined();
  });

  it("returns undefined when role is present but not a string", async () => {
    mockCookieValue(JSON.stringify({ name: "Demo Officer", role: 42 }));

    await expect(getPersonaRoleForRequest()).resolves.toBeUndefined();
  });

  it("returns undefined when cookies() itself throws (non-request context)", async () => {
    cookiesMock.mockImplementation(() => {
      throw new Error("no request context");
    });

    await expect(getPersonaRoleForRequest()).resolves.toBeUndefined();
  });
});
