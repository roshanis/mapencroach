import { describe, expect, it, vi } from "vitest";
import { PERSONA_META_COOKIE } from "./cookies";

const cookiesMock = vi.fn();

vi.mock("next/headers", () => ({
  cookies: () => cookiesMock(),
}));

vi.mock("./api", () => ({
  getAlerts: vi.fn(),
  getCase: vi.fn(),
  getCases: vi.fn(),
  getJurisdictions: vi.fn(),
  getParcel: vi.fn(),
  getParcelContext: vi.fn(),
  getParcels: vi.fn(),
  TOKEN_COOKIE: "mapencroach_token",
}));

async function importServerApi() {
  return import("./server-api");
}

function mockCookieValue(value: string | undefined) {
  cookiesMock.mockResolvedValue({
    get: (name: string) =>
      name === PERSONA_META_COOKIE && value !== undefined ? { value } : undefined,
  });
}

describe("getPersonaRoleForRequest", () => {
  it("returns the role parsed from a well-formed persona-meta cookie", async () => {
    mockCookieValue(JSON.stringify({ name: "Demo Officer", role: "viewer" }));
    const { getPersonaRoleForRequest } = await importServerApi();

    await expect(getPersonaRoleForRequest()).resolves.toBe("viewer");
  });

  it("returns undefined when the persona-meta cookie is absent", async () => {
    mockCookieValue(undefined);
    const { getPersonaRoleForRequest } = await importServerApi();

    await expect(getPersonaRoleForRequest()).resolves.toBeUndefined();
  });

  it("returns undefined when the cookie value is malformed JSON", async () => {
    mockCookieValue("{not-json");
    const { getPersonaRoleForRequest } = await importServerApi();

    await expect(getPersonaRoleForRequest()).resolves.toBeUndefined();
  });

  it("returns undefined when role is present but not a string", async () => {
    mockCookieValue(JSON.stringify({ name: "Demo Officer", role: 42 }));
    const { getPersonaRoleForRequest } = await importServerApi();

    await expect(getPersonaRoleForRequest()).resolves.toBeUndefined();
  });

  it("returns undefined when cookies() itself throws (non-request context)", async () => {
    cookiesMock.mockImplementation(() => {
      throw new Error("no request context");
    });
    const { getPersonaRoleForRequest } = await importServerApi();

    await expect(getPersonaRoleForRequest()).resolves.toBeUndefined();
  });
});
