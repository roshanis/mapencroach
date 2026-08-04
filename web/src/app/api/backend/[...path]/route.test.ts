import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DELETE, GET, PATCH, POST } from "./route";

const ORIGINAL_BACKEND_URL = process.env.MAPENCROACH_BACKEND_URL;
const ORIGINAL_API_TOKEN = process.env.MAPENCROACH_API_TOKEN;

afterEach(() => {
  if (ORIGINAL_BACKEND_URL === undefined) {
    delete process.env.MAPENCROACH_BACKEND_URL;
  } else {
    process.env.MAPENCROACH_BACKEND_URL = ORIGINAL_BACKEND_URL;
  }
  if (ORIGINAL_API_TOKEN === undefined) {
    delete process.env.MAPENCROACH_API_TOKEN;
  } else {
    process.env.MAPENCROACH_API_TOKEN = ORIGINAL_API_TOKEN;
  }
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function makeParams(path: string[]) {
  return { params: Promise.resolve({ path }) };
}

function makeRequest(
  url: string,
  init?: ConstructorParameters<typeof NextRequest>[1]
): NextRequest {
  return new NextRequest(url, init);
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("backend proxy route — request forwarding", () => {
  it("forwards method/path/query and returns upstream JSON+status", async () => {
    process.env.MAPENCROACH_BACKEND_URL = "https://backend.example.test";
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ hello: "world" }, 200));
    vi.stubGlobal("fetch", fetchMock);

    const request = makeRequest(
      "http://localhost:3000/api/backend/parcels?bbox=1,2,3,4"
    );
    const response = await GET(request, makeParams(["parcels"]));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://backend.example.test/parcels?bbox=1,2,3,4");
    expect(init.method).toBe("GET");
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ hello: "world" });
  });

  it("joins multi-segment paths and strips a trailing slash from the base URL", async () => {
    process.env.MAPENCROACH_BACKEND_URL = "https://backend.example.test/";
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true }, 200));
    vi.stubGlobal("fetch", fetchMock);

    const request = makeRequest(
      "http://localhost:3000/api/backend/cases/CASE-1/transitions"
    );
    await GET(request, makeParams(["cases", "CASE-1", "transitions"]));

    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe("https://backend.example.test/cases/CASE-1/transitions");
  });

  it("returns upstream error status/body verbatim without re-wrapping", async () => {
    process.env.MAPENCROACH_BACKEND_URL = "https://backend.example.test";
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ detail: "cannot transition from A to B" }, 409)
    );
    vi.stubGlobal("fetch", fetchMock);

    const request = makeRequest(
      "http://localhost:3000/api/backend/cases/CASE-1/transitions"
    );
    const response = await GET(request, makeParams(["cases", "CASE-1", "transitions"]));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      detail: "cannot transition from A to B",
    });
  });
});

describe("backend proxy route — auth precedence", () => {
  it("prefers the incoming client Authorization header over cookie and env token", async () => {
    process.env.MAPENCROACH_BACKEND_URL = "https://backend.example.test";
    process.env.MAPENCROACH_API_TOKEN = "env-token";
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({}, 200));
    vi.stubGlobal("fetch", fetchMock);

    const request = makeRequest("http://localhost:3000/api/backend/parcels", {
      headers: {
        authorization: "Bearer client-token",
        cookie: "mapencroach_token=cookie-tok",
      },
    });
    await GET(request, makeParams(["parcels"]));

    const [, init] = fetchMock.mock.calls[0];
    expect(new Headers(init.headers).get("authorization")).toBe(
      "Bearer client-token"
    );
  });

  it("falls back to the mapencroach_token cookie when no Authorization header is sent", async () => {
    process.env.MAPENCROACH_BACKEND_URL = "https://backend.example.test";
    process.env.MAPENCROACH_API_TOKEN = "env-token";
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({}, 200));
    vi.stubGlobal("fetch", fetchMock);

    const request = makeRequest("http://localhost:3000/api/backend/parcels", {
      headers: { cookie: "mapencroach_token=cookie-tok" },
    });
    await GET(request, makeParams(["parcels"]));

    const [, init] = fetchMock.mock.calls[0];
    expect(new Headers(init.headers).get("authorization")).toBe(
      "Bearer cookie-tok"
    );
  });

  it("falls back to the server-only env token when there is no header or cookie", async () => {
    process.env.MAPENCROACH_BACKEND_URL = "https://backend.example.test";
    process.env.MAPENCROACH_API_TOKEN = "env-token";
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({}, 200));
    vi.stubGlobal("fetch", fetchMock);

    const request = makeRequest("http://localhost:3000/api/backend/parcels");
    await GET(request, makeParams(["parcels"]));

    const [, init] = fetchMock.mock.calls[0];
    expect(new Headers(init.headers).get("authorization")).toBe(
      "Bearer env-token"
    );
  });

  it("sends no Authorization header when there is no header, cookie, or env token", async () => {
    process.env.MAPENCROACH_BACKEND_URL = "https://backend.example.test";
    delete process.env.MAPENCROACH_API_TOKEN;
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({}, 200));
    vi.stubGlobal("fetch", fetchMock);

    const request = makeRequest("http://localhost:3000/api/backend/parcels");
    await GET(request, makeParams(["parcels"]));

    const [, init] = fetchMock.mock.calls[0];
    expect(new Headers(init.headers).has("authorization")).toBe(false);
  });

  it("never echoes the resolved token in the response body", async () => {
    process.env.MAPENCROACH_BACKEND_URL = "https://backend.example.test";
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ status: "ok" }, 200));
    vi.stubGlobal("fetch", fetchMock);

    const request = makeRequest("http://localhost:3000/api/backend/parcels", {
      headers: { cookie: "mapencroach_token=super-secret-token" },
    });
    const response = await GET(request, makeParams(["parcels"]));
    const text = await response.text();

    expect(text).not.toContain("super-secret-token");
  });
});

describe("backend proxy route — misconfiguration and failures", () => {
  it("responds 503 with a JSON detail when MAPENCROACH_BACKEND_URL is unset", async () => {
    delete process.env.MAPENCROACH_BACKEND_URL;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const request = makeRequest("http://localhost:3000/api/backend/parcels");
    const response = await GET(request, makeParams(["parcels"]));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      detail: "backend not configured",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("responds 502 with a JSON detail when the upstream fetch fails", async () => {
    process.env.MAPENCROACH_BACKEND_URL = "https://backend.example.test";
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("network down"));
    vi.stubGlobal("fetch", fetchMock);

    const request = makeRequest("http://localhost:3000/api/backend/parcels", {
      headers: { cookie: "mapencroach_token=super-secret-token" },
    });
    const response = await GET(request, makeParams(["parcels"]));
    const text = await response.text();

    expect(response.status).toBe(502);
    expect(JSON.parse(text)).toEqual({ detail: "backend unreachable" });
    expect(text).not.toContain("super-secret-token");
  });
});

describe("backend proxy route — body forwarding on POST/PATCH/DELETE", () => {
  it("forwards a JSON body and Content-Type on POST", async () => {
    process.env.MAPENCROACH_BACKEND_URL = "https://backend.example.test";
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true }, 201));
    vi.stubGlobal("fetch", fetchMock);

    const request = makeRequest(
      "http://localhost:3000/api/backend/cases/CASE-1/transitions",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ to_state: "RESPONSE_WINDOW" }),
      }
    );
    const response = await POST(
      request,
      makeParams(["cases", "CASE-1", "transitions"])
    );

    const [, init] = fetchMock.mock.calls[0];
    expect(init.method).toBe("POST");
    expect(init.body).toBe(JSON.stringify({ to_state: "RESPONSE_WINDOW" }));
    expect(new Headers(init.headers).get("content-type")).toBe(
      "application/json"
    );
    expect(response.status).toBe(201);
  });

  it("forwards a JSON body on PATCH", async () => {
    process.env.MAPENCROACH_BACKEND_URL = "https://backend.example.test";
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true }, 200));
    vi.stubGlobal("fetch", fetchMock);

    const request = makeRequest(
      "http://localhost:3000/api/backend/parcels/PCL-1/boundary-grade",
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ grade: "A" }),
      }
    );
    await PATCH(request, makeParams(["parcels", "PCL-1", "boundary-grade"]));

    const [, init] = fetchMock.mock.calls[0];
    expect(init.method).toBe("PATCH");
    expect(init.body).toBe(JSON.stringify({ grade: "A" }));
  });

  it("does not forward a body on DELETE when none is provided", async () => {
    process.env.MAPENCROACH_BACKEND_URL = "https://backend.example.test";
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true }, 200));
    vi.stubGlobal("fetch", fetchMock);

    const request = makeRequest(
      "http://localhost:3000/api/backend/parcels/PCL-1/tags/flagged",
      { method: "DELETE" }
    );
    await DELETE(request, makeParams(["parcels", "PCL-1", "tags", "flagged"]));

    const [, init] = fetchMock.mock.calls[0];
    expect(init.method).toBe("DELETE");
    expect(init.body).toBeUndefined();
  });

  it("does not read/forward a body on GET", async () => {
    process.env.MAPENCROACH_BACKEND_URL = "https://backend.example.test";
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true }, 200));
    vi.stubGlobal("fetch", fetchMock);

    const request = makeRequest("http://localhost:3000/api/backend/parcels");
    await GET(request, makeParams(["parcels"]));

    const [, init] = fetchMock.mock.calls[0];
    expect(init.body).toBeUndefined();
  });

  it("passes image bytes through unchanged instead of decoding them as text", async () => {
    // A JPEG header is not valid UTF-8. Reading the upstream body with
    // `.text()` replaces those bytes with U+FFFD, so the browser receives a
    // 200 carrying corrupted bytes -- indistinguishable downstream from a
    // real image, and worse than an honest error.
    process.env.MAPENCROACH_BACKEND_URL = "https://backend.example.test";
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(jpeg, {
        status: 200,
        headers: {
          "content-type": "image/jpeg",
          etag: '"abc123"',
          "cache-control": "private, max-age=31536000, immutable",
        },
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const request = makeRequest(
      "http://localhost:3000/api/backend/cases/case-1/imagery/2026-W31/image"
    );
    const response = await GET(
      request,
      makeParams(["cases", "case-1", "imagery", "2026-W31", "image"])
    );

    const received = new Uint8Array(await response.arrayBuffer());
    expect(Array.from(received)).toEqual(Array.from(jpeg));
    expect(response.headers.get("content-type")).toBe("image/jpeg");
    // Dropping these would turn every cached thumbnail into a re-download.
    expect(response.headers.get("etag")).toBe('"abc123"');
    expect(response.headers.get("cache-control")).toContain("immutable");
  });

  it("forwards If-None-Match and passes a 304 through with no body", async () => {
    process.env.MAPENCROACH_BACKEND_URL = "https://backend.example.test";
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 304, headers: { etag: '"abc123"' } }));
    vi.stubGlobal("fetch", fetchMock);

    const request = makeRequest(
      "http://localhost:3000/api/backend/cases/case-1/imagery/2026-W31/image",
      { headers: { "if-none-match": '"abc123"' } }
    );
    const response = await GET(
      request,
      makeParams(["cases", "case-1", "imagery", "2026-W31", "image"])
    );

    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers.get("if-none-match")).toBe('"abc123"');
    expect(response.status).toBe(304);
  });
});
