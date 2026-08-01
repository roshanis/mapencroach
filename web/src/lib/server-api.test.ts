import { afterEach, describe, expect, it, vi } from "vitest";

const cookiesMock = vi.fn();

vi.mock("next/headers", () => ({
  cookies: cookiesMock,
}));

// Imported after the mock so `cookies` resolves to cookiesMock inside
// server-api.ts.
const { serverToken } = await import("./server-api");

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
