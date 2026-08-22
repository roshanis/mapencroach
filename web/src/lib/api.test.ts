import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ApiError,
  addParcelTag,
  backfillCaseImagery,
  getAlerts,
  getCase,
  getCaseImagery,
  getCases,
  getJurisdictions,
  getParcel,
  getParcelContext,
  getParcels,
  getPersonas,
  getWatchEntry,
  getWatchlist,
  loginPersona,
  removeParcelTag,
  runCaptures,
  transferCase,
  transitionCase,
  unwatchAlert,
  updateBoundaryGrade,
  watchAlert,
} from "./api";
import {
  CASE_IMAGERY_BACKFILL_FLOOR,
  FIXTURE_ALERTS,
  FIXTURE_CASES,
  FIXTURE_CASE_IMAGERY,
  FIXTURE_JURISDICTIONS,
  FIXTURE_PARCELS,
  FIXTURE_PARCEL_CONTEXTS,
  FIXTURE_WATCH_ENTRIES,
} from "./fixtures";

const ORIGINAL_ENV = process.env.NEXT_PUBLIC_API_URL;

afterEach(() => {
  if (ORIGINAL_ENV === undefined) {
    delete process.env.NEXT_PUBLIC_API_URL;
  } else {
    process.env.NEXT_PUBLIC_API_URL = ORIGINAL_ENV;
  }
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const TEST_API_BASE = "https://api.example.test";

/**
 * Mirrors api.ts's withImageUrls for a WatchEntry-shaped fixture: replaces
 * `image_url` on every captured capture with the derived
 * `/watchlist/{alert_id}/weeks/{week}/image` path, matching what
 * getWatchlist/getWatchEntry/watchAlert compute from a real backend
 * response. Used to build expectations in tests that mock a fixture object
 * as the wire payload — the fixture itself always sets image_url: null
 * (there is no server behind fixture mode), so a "real" fetch no longer
 * round-trips it unchanged.
 */
function withExpectedWatchImageUrls(entries: typeof FIXTURE_WATCH_ENTRIES) {
  return entries.map((entry) => ({
    ...entry,
    captures: entry.captures.map((capture) => ({
      ...capture,
      image_url:
        capture.status === "captured"
          ? `${TEST_API_BASE}/watchlist/${entry.alert_id}/weeks/${capture.week}/image`
          : null,
    })),
  }));
}

/** Same as `withExpectedWatchImageUrls`, for the case-imagery serving route. */
function withExpectedCaseImageUrls(
  imagery: (typeof FIXTURE_CASE_IMAGERY)[string]
) {
  return {
    ...imagery,
    captures: imagery.captures.map((capture) => ({
      ...capture,
      image_url:
        capture.status === "captured"
          ? `${TEST_API_BASE}/cases/${imagery.case_id}/imagery/${capture.week}/image`
          : null,
    })),
  };
}

describe("api client without NEXT_PUBLIC_API_URL", () => {
  it("falls back to fixture parcels", async () => {
    delete process.env.NEXT_PUBLIC_API_URL;
    const parcels = await getParcels();
    expect(parcels).toEqual(FIXTURE_PARCELS);
  });

  it("falls back to a single fixture parcel by id", async () => {
    delete process.env.NEXT_PUBLIC_API_URL;
    const parcel = await getParcel("PCL-1001");
    expect(parcel?.id).toBe("PCL-1001");
  });

  it("falls back to a provenance-bearing fixture parcel context", async () => {
    delete process.env.NEXT_PUBLIC_API_URL;
    const context = await getParcelContext("PCL-1001");
    expect(context).toEqual(FIXTURE_PARCEL_CONTEXTS["PCL-1001"]);
    expect(context?.sources[0].is_demo).toBe(true);
  });

  it("falls back to the full, unfiltered fixture alert list (tier/status filtering is AlertsTable's job, client-side)", async () => {
    delete process.env.NEXT_PUBLIC_API_URL;
    const alerts = await getAlerts();
    expect(alerts).toEqual(FIXTURE_ALERTS);
  });

  it("falls back to fixture cases", async () => {
    delete process.env.NEXT_PUBLIC_API_URL;
    const cases = await getCases();
    expect(cases).toEqual(FIXTURE_CASES);
    const single = await getCase(FIXTURE_CASES[0].id);
    expect(single?.id).toBe(FIXTURE_CASES[0].id);
  });
});

describe("api client with NEXT_PUBLIC_API_URL set", () => {
  it("fetches the parcel context from its dedicated endpoint", async () => {
    process.env.NEXT_PUBLIC_API_URL = "https://api.example.test";
    const remoteContext = FIXTURE_PARCEL_CONTEXTS["PCL-1001"];
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => remoteContext,
    });
    vi.stubGlobal("fetch", fetchMock);

    const context = await getParcelContext("PCL-REMOTE-1");

    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://api.example.test/parcels/PCL-REMOTE-1/context"
    );
    expect(context).toEqual(remoteContext);
  });

  it("fetches parcels from the REST backend as GeoJSON and maps them to Parcel objects", async () => {
    process.env.NEXT_PUBLIC_API_URL = "https://api.example.test";

    const featureCollection = {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: {
            type: "Polygon",
            coordinates: [
              [
                [77.0, 23.0],
                [77.1, 23.0],
                [77.1, 23.1],
                [77.0, 23.1],
                [77.0, 23.0],
              ],
            ],
          },
          properties: {
            id: "PCL-REMOTE-1",
            survey_no: "1/1",
            ulpin: "UK00REMOTE001",
            owning_department: "Revenue Department",
            land_category: "revenue",
            boundary_grade: "A",
            jurisdiction_id: "TEST-01",
          },
        },
      ],
    };

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => featureCollection,
    });
    vi.stubGlobal("fetch", fetchMock);

    const parcels = await getParcels();

    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://api.example.test/parcels"
    );
    expect(parcels).toHaveLength(1);
    expect(parcels[0].id).toBe("PCL-REMOTE-1");
    expect(parcels[0].boundary_grade).toBe("A");
  });

  it("normalizes dict-shaped event artifacts and surfaces allowed_transitions for getCase", async () => {
    process.env.NEXT_PUBLIC_API_URL = "https://api.example.test";

    const remoteCase = {
      id: "CASE-REMOTE-1",
      alert_id: "ALT-REMOTE-1",
      parcel_id: "PCL-REMOTE-1",
      state: "SHOW_CAUSE_ISSUED",
      allowed_transitions: [
        "RESPONSE_WINDOW",
        "DISMISSED_FALSE_POSITIVE",
        "LEGACY_REFERRED",
        "STAYED_BY_COURT",
        "SURVEY_REQUESTED",
      ],
      events: [
        {
          from_state: "INSPECTED",
          to_state: "SHOW_CAUSE_ISSUED",
          actor: "Deputy Collector R. Sharma",
          occurred_at: "2026-06-29T14:00:00Z",
          artifacts: {
            notice_document: "notice-001.pdf",
            dispatch_proof: "dispatch-001.pdf",
          },
        },
        {
          from_state: "NEW",
          to_state: "TRIAGED",
          actor: "Deputy Collector R. Sharma",
          occurred_at: "2026-06-19T09:00:00Z",
          artifacts: ["triage_note_9001.pdf"],
        },
      ],
    };

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => remoteCase,
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await getCase("CASE-REMOTE-1");

    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://api.example.test/cases/CASE-REMOTE-1"
    );
    expect(result?.allowed_transitions).toEqual([
      "RESPONSE_WINDOW",
      "DISMISSED_FALSE_POSITIVE",
      "LEGACY_REFERRED",
      "STAYED_BY_COURT",
      "SURVEY_REQUESTED",
    ]);
    expect(result?.events[0].artifacts).toEqual([
      "notice_document: notice-001.pdf",
      "dispatch_proof: dispatch-001.pdf",
    ]);
    // Array artifacts pass through unchanged.
    expect(result?.events[1].artifacts).toEqual(["triage_note_9001.pdf"]);
  });

  it("drops non-string elements from array-shaped artifacts instead of passing them through unchecked", async () => {
    process.env.NEXT_PUBLIC_API_URL = "https://api.example.test";

    const remoteCase = {
      id: "CASE-REMOTE-2",
      alert_id: "ALT-REMOTE-2",
      parcel_id: "PCL-REMOTE-2",
      state: "TRIAGED",
      events: [
        {
          from_state: "NEW",
          to_state: "TRIAGED",
          actor: "Deputy Collector R. Sharma",
          occurred_at: "2026-06-19T09:00:00Z",
          artifacts: ["triage_note.pdf", null, 42, { bad: "shape" }, "second.pdf"],
        },
      ],
    };

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => remoteCase,
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await getCase("CASE-REMOTE-2");

    expect(result?.events[0].artifacts).toEqual(["triage_note.pdf", "second.pdf"]);
  });

  it("tolerates the /cases list shape, which omits events", async () => {
    process.env.NEXT_PUBLIC_API_URL = "https://api.example.test";

    // The backend list endpoint returns case summaries without events;
    // only GET /cases/{id} includes them.
    const listResponse = [
      {
        id: "CASE-REMOTE-1",
        alert_id: "ALT-REMOTE-1",
        parcel_id: "PCL-REMOTE-1",
        state: "SHOW_CAUSE_ISSUED",
      },
    ];

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => listResponse,
    });
    vi.stubGlobal("fetch", fetchMock);

    const cases = await getCases();

    expect(cases).toHaveLength(1);
    expect(cases[0].id).toBe("CASE-REMOTE-1");
    expect(cases[0].events).toEqual([]);
  });

  it("posts a transition and returns ok:true with the auth header when a token is set", async () => {
    process.env.NEXT_PUBLIC_API_URL = "https://api.example.test";
    document.cookie = "mapencroach_token=test-token-123; path=/";

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      statusText: "Created",
      json: async () => ({
        id: "CASE-9001",
        state: "RESPONSE_WINDOW",
        allowed_transitions: ["HEARING_SCHEDULED"],
        required_artifacts: { HEARING_SCHEDULED: [] },
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await transitionCase(
      "CASE-9001",
      "RESPONSE_WINDOW",
      {},
      "moving forward",
      "test-token-123"
    );

    expect(result).toEqual({ ok: true, status: 201 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.example.test/cases/CASE-9001/transitions");
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({
      "Content-Type": "application/json",
      Authorization: "Bearer test-token-123",
    });
    expect(JSON.parse(init.body)).toEqual({
      to_state: "RESPONSE_WINDOW",
      artifacts: {},
      note: "moving forward",
    });
    document.cookie = "mapencroach_token=; path=/; max-age=0";
  });

  it("returns ok:false with the passed-through detail on a 409 refusal from the case engine", async () => {
    process.env.NEXT_PUBLIC_API_URL = "https://api.example.test";

    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 409,
      statusText: "Conflict",
      json: async () => ({
        detail: "cannot transition from SHOW_CAUSE_ISSUED to ORDER_ISSUED",
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await transitionCase("CASE-9001", "ORDER_ISSUED", {});

    expect(result).toEqual({
      ok: false,
      status: 409,
      detail: "cannot transition from SHOW_CAUSE_ISSUED to ORDER_ISSUED",
    });
  });

  it("falls back to statusText when the error body has no detail", async () => {
    process.env.NEXT_PUBLIC_API_URL = "https://api.example.test";

    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 422,
      statusText: "Unprocessable Entity",
      json: async () => {
        throw new Error("not json");
      },
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await transitionCase("CASE-9001", "BOGUS_STATE", {});

    expect(result).toEqual({
      ok: false,
      status: 422,
      detail: "Unprocessable Entity",
    });
  });

  it("returns a read-only message without calling fetch when no backend is configured", async () => {
    delete process.env.NEXT_PUBLIC_API_URL;

    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await transitionCase("CASE-9001", "RESPONSE_WINDOW", {});

    expect(result).toEqual({
      ok: false,
      status: 0,
      detail: "No backend configured — fixture mode is read-only.",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("ApiError", () => {
  it("carries a numeric status and an informative message", () => {
    const err = new ApiError("Request failed: 404 Not Found (/parcels/x)", 404);
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(404);
    expect(err.message).toBe("Request failed: 404 Not Found (/parcels/x)");
  });
});

describe("404 vs. non-404 error handling for getParcel/getParcelContext/getCase", () => {
  it("getParcel resolves undefined on a 404", async () => {
    process.env.NEXT_PUBLIC_API_URL = "https://api.example.test";
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      statusText: "Not Found",
      json: async () => ({}),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(getParcel("PCL-MISSING")).resolves.toBeUndefined();
  });

  it("getParcel rejects on a 500", async () => {
    process.env.NEXT_PUBLIC_API_URL = "https://api.example.test";
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
      json: async () => ({}),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(getParcel("PCL-1001")).rejects.toThrow();
  });

  it("getParcel rejects when fetch itself rejects (network outage)", async () => {
    process.env.NEXT_PUBLIC_API_URL = "https://api.example.test";
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("network down"));
    vi.stubGlobal("fetch", fetchMock);

    await expect(getParcel("PCL-1001")).rejects.toThrow("network down");
  });

  it("getParcelContext resolves undefined on a 404", async () => {
    process.env.NEXT_PUBLIC_API_URL = "https://api.example.test";
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      statusText: "Not Found",
      json: async () => ({}),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(getParcelContext("PCL-MISSING")).resolves.toBeUndefined();
  });

  it("getParcelContext rejects on a 500", async () => {
    process.env.NEXT_PUBLIC_API_URL = "https://api.example.test";
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
      json: async () => ({}),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(getParcelContext("PCL-1001")).rejects.toThrow();
  });

  it("getParcelContext rejects when fetch itself rejects (network outage)", async () => {
    process.env.NEXT_PUBLIC_API_URL = "https://api.example.test";
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("network down"));
    vi.stubGlobal("fetch", fetchMock);

    await expect(getParcelContext("PCL-1001")).rejects.toThrow("network down");
  });

  it("getCase resolves undefined on a 404", async () => {
    process.env.NEXT_PUBLIC_API_URL = "https://api.example.test";
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      statusText: "Not Found",
      json: async () => ({}),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(getCase("CASE-MISSING")).resolves.toBeUndefined();
  });

  it("getCase rejects on a 500", async () => {
    process.env.NEXT_PUBLIC_API_URL = "https://api.example.test";
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
      json: async () => ({}),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(getCase("CASE-9001")).rejects.toThrow();
  });

  it("getCase rejects when fetch itself rejects (network outage)", async () => {
    process.env.NEXT_PUBLIC_API_URL = "https://api.example.test";
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("network down"));
    vi.stubGlobal("fetch", fetchMock);

    await expect(getCase("CASE-9001")).rejects.toThrow("network down");
  });
});

describe("authHeaders token precedence (client-side)", () => {
  afterEach(() => {
    document.cookie = "mapencroach_token=; path=/; max-age=0";
  });

  it("uses the cookie token when no explicit token override is provided", async () => {
    process.env.NEXT_PUBLIC_API_URL = "https://api.example.test";
    document.cookie = "mapencroach_token=cookie-tok; path=/";

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      statusText: "Created",
      json: async () => ({}),
    });
    vi.stubGlobal("fetch", fetchMock);

    await transitionCase("CASE-9001", "RESPONSE_WINDOW", {}, "note");

    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers).toMatchObject({
      Authorization: "Bearer cookie-tok",
    });
  });

  it("uses a tokenOverride argument over the cookie token", async () => {
    process.env.NEXT_PUBLIC_API_URL = "https://api.example.test";
    document.cookie = "mapencroach_token=cookie-tok; path=/";

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => ({
        type: "FeatureCollection",
        features: [],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await getParcels(undefined, "override-tok");

    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers).toMatchObject({
      Authorization: "Bearer override-tok",
    });
  });

  // "falls back to the cookie token when no override is passed" is already
  // covered above by "uses the cookie token when no explicit token override
  // is provided" — same behavior, so it is not duplicated here.

  it("sends no Authorization header when there is no tokenOverride or cookie (NEXT_PUBLIC_API_TOKEN is never consulted)", async () => {
    process.env.NEXT_PUBLIC_API_URL = "https://api.example.test";
    // Set as if a stray build-time env var were present — it must be ignored
    // client-side now that the fallback has been removed from authHeaders.
    // vi.stubEnv (not a direct process.env assignment) so vi.unstubAllEnvs()
    // in the top-level afterEach reliably cleans it up between tests.
    vi.stubEnv("NEXT_PUBLIC_API_TOKEN", "should-never-be-used");

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => ({ type: "FeatureCollection", features: [] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await getParcels();

    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers).toBeUndefined();
  });
});

describe("NEXT_PUBLIC_API_TOKEN insecure-fallback warning", () => {
  it("warns once at module load when NEXT_PUBLIC_API_TOKEN is set", async () => {
    vi.resetModules();
    process.env.NEXT_PUBLIC_API_TOKEN = "insecure-client-token";
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    await import("./api");

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("NEXT_PUBLIC_API_TOKEN is set but is ignored")
    );
    warnSpy.mockRestore();
    vi.resetModules();
  });

  it("does not warn when NEXT_PUBLIC_API_TOKEN is unset", async () => {
    vi.resetModules();
    delete process.env.NEXT_PUBLIC_API_TOKEN;
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    await import("./api");

    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
    vi.resetModules();
  });
});

describe("distinguishing a genuine 404 from other failures", () => {
  it("getParcel returns undefined on a genuine 404", async () => {
    process.env.NEXT_PUBLIC_API_URL = "https://api.example.test";
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      statusText: "Not Found",
      json: async () => ({}),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(getParcel("PCL-MISSING")).resolves.toBeUndefined();
  });

  it("getParcel propagates a 500 instead of reporting the parcel missing", async () => {
    process.env.NEXT_PUBLIC_API_URL = "https://api.example.test";
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
      json: async () => ({}),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(getParcel("PCL-1001")).rejects.toMatchObject({ status: 500 });
  });

  it("getParcel propagates a network failure instead of reporting the parcel missing", async () => {
    process.env.NEXT_PUBLIC_API_URL = "https://api.example.test";
    const fetchMock = vi.fn().mockRejectedValue(new Error("network down"));
    vi.stubGlobal("fetch", fetchMock);

    await expect(getParcel("PCL-1001")).rejects.toThrow("network down");
  });

  it("getCase returns undefined on a genuine 404 but propagates a 401", async () => {
    process.env.NEXT_PUBLIC_API_URL = "https://api.example.test";
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      statusText: "Unauthorized",
      json: async () => ({ detail: "token expired" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(getCase("CASE-9001")).rejects.toMatchObject({ status: 401 });

    fetchMock.mockResolvedValue({
      ok: false,
      status: 404,
      statusText: "Not Found",
      json: async () => ({}),
    });
    await expect(getCase("CASE-MISSING")).resolves.toBeUndefined();
  });

  it("getParcelContext returns undefined on a genuine 404 but propagates a 503", async () => {
    process.env.NEXT_PUBLIC_API_URL = "https://api.example.test";
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      statusText: "Service Unavailable",
      json: async () => ({}),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(getParcelContext("PCL-1001")).rejects.toMatchObject({
      status: 503,
    });

    fetchMock.mockResolvedValue({
      ok: false,
      status: 404,
      statusText: "Not Found",
      json: async () => ({}),
    });
    await expect(getParcelContext("PCL-MISSING")).resolves.toBeUndefined();
  });
});

describe("server-context getApiBase and authHeaders resolution", () => {
  it("prefers MAPENCROACH_BACKEND_URL over NEXT_PUBLIC_API_URL when running server-side", async () => {
    vi.stubEnv("NEXT_PUBLIC_API_URL", "https://client.example.test");
    vi.stubEnv("MAPENCROACH_BACKEND_URL", "https://server.example.test");
    vi.stubGlobal("window", undefined);

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => ({ type: "FeatureCollection", features: [] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await getParcels();

    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://server.example.test/parcels"
    );
  });

  it("falls back to NEXT_PUBLIC_API_URL server-side when MAPENCROACH_BACKEND_URL is unset", async () => {
    vi.stubEnv("NEXT_PUBLIC_API_URL", "https://client.example.test");
    delete process.env.MAPENCROACH_BACKEND_URL;
    vi.stubGlobal("window", undefined);

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => ({ type: "FeatureCollection", features: [] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await getParcels();

    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://client.example.test/parcels"
    );
  });

  it("falls back to MAPENCROACH_API_TOKEN when authHeaders resolves with no document (server context) and no tokenOverride", async () => {
    process.env.NEXT_PUBLIC_API_URL = "https://api.example.test";
    vi.stubEnv("MAPENCROACH_API_TOKEN", "server-env-token");
    vi.stubGlobal("document", undefined);

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => ({ type: "FeatureCollection", features: [] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await getParcels();

    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers).toMatchObject({
      Authorization: "Bearer server-env-token",
    });
  });
});

describe("demo persona endpoints", () => {
  it("getPersonas returns [] when no backend is configured", async () => {
    delete process.env.NEXT_PUBLIC_API_URL;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const personas = await getPersonas();

    expect(personas).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("getPersonas parses the list when a backend is configured", async () => {
    process.env.NEXT_PUBLIC_API_URL = "https://api.example.test";
    const personaList = [
      {
        id: "persona-1",
        name: "Deputy Collector",
        role: "case_officer",
        jurisdiction_id: "UK-URBAN-01",
        description: "Handles show-cause notices.",
      },
    ];
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => personaList,
    });
    vi.stubGlobal("fetch", fetchMock);

    const personas = await getPersonas();

    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://api.example.test/demo/personas"
    );
    expect(personas).toEqual(personaList);
  });

  it("getPersonas returns [] on a 404 (non-demo backend)", async () => {
    process.env.NEXT_PUBLIC_API_URL = "https://api.example.test";
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      statusText: "Not Found",
      json: async () => ({}),
    });
    vi.stubGlobal("fetch", fetchMock);

    const personas = await getPersonas();

    expect(personas).toEqual([]);
  });

  it("getPersonas returns [] when fetch throws", async () => {
    process.env.NEXT_PUBLIC_API_URL = "https://api.example.test";
    const fetchMock = vi.fn().mockRejectedValue(new Error("network down"));
    vi.stubGlobal("fetch", fetchMock);

    const personas = await getPersonas();

    expect(personas).toEqual([]);
  });

  it("loginPersona returns null when no backend is configured", async () => {
    delete process.env.NEXT_PUBLIC_API_URL;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await loginPersona("persona-1");

    expect(result).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("loginPersona posts the persona_id and returns token + persona on success", async () => {
    process.env.NEXT_PUBLIC_API_URL = "https://api.example.test";
    const persona = {
      id: "persona-1",
      name: "Deputy Collector",
      role: "case_officer",
      jurisdiction_id: "UK-URBAN-01",
      description: "Handles show-cause notices.",
    };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => ({ token: "tok-123", persona, expires_in_hours: 8 }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await loginPersona("persona-1");

    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://api.example.test/demo/login"
    );
    const [, init] = fetchMock.mock.calls[0];
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ persona_id: "persona-1" });
    expect(result).toEqual({ token: "tok-123", persona });
  });

  it("loginPersona returns null on a 404 unknown persona", async () => {
    process.env.NEXT_PUBLIC_API_URL = "https://api.example.test";
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      statusText: "Not Found",
      json: async () => ({ detail: "unknown persona" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await loginPersona("bogus");

    expect(result).toBeNull();
  });
});

describe("parcel tag endpoints", () => {
  it("addParcelTag returns ok:false without calling fetch when no backend is configured", async () => {
    delete process.env.NEXT_PUBLIC_API_URL;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await addParcelTag("PCL-1001", "court-monitored");

    expect(result).toEqual({
      ok: false,
      status: 0,
      detail: "No backend configured — fixture mode is read-only.",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("addParcelTag success returns tags parsed from the returned Feature", async () => {
    process.env.NEXT_PUBLIC_API_URL = "https://api.example.test";
    document.cookie = "mapencroach_token=test-token-123; path=/";

    const feature = {
      type: "Feature",
      geometry: { type: "Polygon", coordinates: [[]] },
      properties: {
        id: "PCL-1001",
        survey_no: "44/2",
        ulpin: "UK17HR0001001",
        owning_department: "Water Resources Department",
        land_category: "waterbody",
        boundary_grade: "A",
        jurisdiction_id: "UK-URBAN-01",
        tags: ["court-monitored", "flagged"],
      },
    };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      statusText: "Created",
      json: async () => feature,
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await addParcelTag("PCL-1001", "flagged", "test-token-123");

    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://api.example.test/parcels/PCL-1001/tags"
    );
    const [, init] = fetchMock.mock.calls[0];
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({
      "Content-Type": "application/json",
      Authorization: "Bearer test-token-123",
    });
    expect(JSON.parse(init.body)).toEqual({ tag: "flagged" });
    expect(result).toEqual({
      ok: true,
      status: 201,
      tags: ["court-monitored", "flagged"],
    });
    document.cookie = "mapencroach_token=; path=/; max-age=0";
  });

  it("addParcelTag passes through the 403 detail for a wrong-role persona", async () => {
    process.env.NEXT_PUBLIC_API_URL = "https://api.example.test";

    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      statusText: "Forbidden",
      json: async () => ({
        detail: "viewer role cannot tag parcels",
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await addParcelTag("PCL-1001", "flagged");

    expect(result).toEqual({
      ok: false,
      status: 403,
      detail: "viewer role cannot tag parcels",
    });
  });

  it("removeParcelTag success returns tags parsed from the returned Feature", async () => {
    process.env.NEXT_PUBLIC_API_URL = "https://api.example.test";

    const feature = {
      type: "Feature",
      geometry: { type: "Polygon", coordinates: [[]] },
      properties: {
        id: "PCL-1001",
        survey_no: "44/2",
        ulpin: "UK17HR0001001",
        owning_department: "Water Resources Department",
        land_category: "waterbody",
        boundary_grade: "A",
        jurisdiction_id: "UK-URBAN-01",
        tags: [],
      },
    };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => feature,
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await removeParcelTag("PCL-1001", "court-monitored");

    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://api.example.test/parcels/PCL-1001/tags/court-monitored"
    );
    const [, init] = fetchMock.mock.calls[0];
    expect(init.method).toBe("DELETE");
    expect(result).toEqual({ ok: true, status: 200, tags: [] });
  });

  it("removeParcelTag returns ok:false on a 404 absent tag", async () => {
    process.env.NEXT_PUBLIC_API_URL = "https://api.example.test";

    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      statusText: "Not Found",
      json: async () => ({ detail: "tag not present" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await removeParcelTag("PCL-1001", "nope");

    expect(result).toEqual({ ok: false, status: 404, detail: "tag not present" });
  });

  it("addParcelTag resolves to a friendly ok:false result when fetch rejects (network outage)", async () => {
    process.env.NEXT_PUBLIC_API_URL = "https://api.example.test";
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("network down"));
    vi.stubGlobal("fetch", fetchMock);

    const result = await addParcelTag("PCL-1001", "flagged");

    expect(result).toEqual({
      ok: false,
      status: 0,
      detail: "Tag service could not be reached. Try again.",
    });
  });

  it("removeParcelTag resolves to a friendly ok:false result when fetch rejects (network outage)", async () => {
    process.env.NEXT_PUBLIC_API_URL = "https://api.example.test";
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("network down"));
    vi.stubGlobal("fetch", fetchMock);

    const result = await removeParcelTag("PCL-1001", "court-monitored");

    expect(result).toEqual({
      ok: false,
      status: 0,
      detail: "Tag service could not be reached. Try again.",
    });
  });
});

describe("boundary grade endpoint", () => {
  it("returns fixture-mode read-only without calling fetch", async () => {
    delete process.env.NEXT_PUBLIC_API_URL;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await updateBoundaryGrade("PCL-1001", "A", "SR-2026-104");

    expect(result).toEqual({
      ok: false,
      status: 0,
      detail: "No backend configured — fixture mode is read-only.",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("patches the grade with the authenticated survey reference", async () => {
    process.env.NEXT_PUBLIC_API_URL = "https://api.example.test";
    // Auth comes from the session cookie, never from NEXT_PUBLIC_API_TOKEN —
    // that env var is inlined into the client bundle and is never read as a
    // Bearer credential (see the "NEXT_PUBLIC_API_TOKEN insecure-fallback
    // warning" and "authHeaders token precedence" describe blocks above).
    document.cookie = "mapencroach_token=test-token-123; path=/";
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => ({
        type: "Feature",
        geometry: FIXTURE_PARCELS[0].geometry,
        properties: {
          ...FIXTURE_PARCELS[0],
          boundary_grade: "A",
        },
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await updateBoundaryGrade(
      "PCL-1001",
      "A",
      "SR-2026-104",
      "test-token-123"
    );

    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://api.example.test/parcels/PCL-1001/boundary-grade"
    );
    const [, init] = fetchMock.mock.calls[0];
    expect(init.method).toBe("PATCH");
    expect(init.headers).toMatchObject({
      "Content-Type": "application/json",
      Authorization: "Bearer test-token-123",
    });
    expect(JSON.parse(init.body)).toEqual({
      grade: "A",
      survey_reference: "SR-2026-104",
    });
    expect(result).toEqual({ ok: true, status: 200, grade: "A" });
    document.cookie = "mapencroach_token=; path=/; max-age=0";
  });
});

describe("weekly-snapshot watchlist endpoints", () => {
  describe("without NEXT_PUBLIC_API_URL (fixture mode)", () => {
    it("getWatchlist falls back to the fixture watch entries", async () => {
      delete process.env.NEXT_PUBLIC_API_URL;
      const entries = await getWatchlist();
      expect(entries).toEqual(FIXTURE_WATCH_ENTRIES);
    });

    it("getWatchEntry falls back to a single fixture entry by alert id", async () => {
      delete process.env.NEXT_PUBLIC_API_URL;
      const entry = await getWatchEntry("ALT-5001");
      expect(entry).toEqual(FIXTURE_WATCH_ENTRIES[0]);
    });

    it("getWatchEntry returns undefined for an alert with no fixture watch entry", async () => {
      delete process.env.NEXT_PUBLIC_API_URL;
      const entry = await getWatchEntry("ALT-9999-NOT-WATCHED");
      expect(entry).toBeUndefined();
    });

    it("watchAlert, unwatchAlert and runCaptures all refuse as read-only without calling fetch", async () => {
      delete process.env.NEXT_PUBLIC_API_URL;
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);

      await expect(watchAlert("ALT-5001")).resolves.toEqual({
        ok: false,
        status: 0,
        detail: "No backend configured — fixture mode is read-only.",
      });
      await expect(unwatchAlert("ALT-5001")).resolves.toEqual({
        ok: false,
        status: 0,
        detail: "No backend configured — fixture mode is read-only.",
      });
      await expect(runCaptures("ALT-5001")).resolves.toEqual({
        ok: false,
        status: 0,
        detail: "No backend configured — fixture mode is read-only.",
      });
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe("with NEXT_PUBLIC_API_URL set", () => {
    it("getWatchlist fetches the watchlist from the REST backend", async () => {
      process.env.NEXT_PUBLIC_API_URL = "https://api.example.test";
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => FIXTURE_WATCH_ENTRIES,
      });
      vi.stubGlobal("fetch", fetchMock);

      const entries = await getWatchlist();

      expect(fetchMock.mock.calls[0][0]).toBe(
        "https://api.example.test/watchlist"
      );
      // The API layer derives image_url from the parent alert + week for
      // every captured capture (see withImageUrls in api.ts), so a "real"
      // fetch response no longer round-trips unchanged the way the
      // fixture (which always sets image_url: null — there's no server
      // behind fixture mode) does.
      expect(entries).toEqual(
        withExpectedWatchImageUrls(FIXTURE_WATCH_ENTRIES)
      );
    });

    it("getWatchlist derives image_url from the parent alert + week for every captured week, and null for anything else", async () => {
      // The backend's CaptureAttempt wire format carries no "was this
      // retained" flag (that lives only server-side on SceneRecord) — see
      // the module notes above withImageUrls in api.ts. So the API layer
      // can only key off `status`: a candidate URL for every captured
      // week (which may still 404 if not retained — WeeklySnapshotTimeline
      // handles that at render time), null for every non-captured week.
      process.env.NEXT_PUBLIC_API_URL = "https://api.example.test";
      const raw = [
        {
          alert_id: "ALT-5001",
          parcel_id: "PCL-1001",
          started_on: "2026-06-01",
          cadence: "weekly",
          watched_by: "Enforcement Officer, Haridwar",
          captures: [
            {
              week: "2026-W23",
              status: "captured",
              attempted_at: "2026-06-01T06:15:00Z",
              scene_id: "S2A_SCENE_001",
              sha256: "e57738c57fbbf69c",
              cloud_pct: 8.5,
              reason: null,
            },
            {
              week: "2026-W24",
              status: "no_usable_scene",
              attempted_at: "2026-06-08T06:15:00Z",
              scene_id: null,
              sha256: null,
              cloud_pct: 78.0,
              reason: "Cloud cover 78.0% exceeds the 40.0% usability threshold.",
            },
            {
              week: "2026-W25",
              status: "provider_error",
              attempted_at: "2026-06-15T06:15:00Z",
              scene_id: null,
              sha256: null,
              cloud_pct: null,
              reason: "Provider request failed: 503 Service Unavailable.",
            },
          ],
          due_weeks: [],
        },
      ];
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => raw,
      });
      vi.stubGlobal("fetch", fetchMock);

      const [entry] = await getWatchlist();

      expect(entry.captures.map((c) => [c.week, c.image_url])).toEqual([
        [
          "2026-W23",
          "https://api.example.test/watchlist/ALT-5001/weeks/2026-W23/image",
        ],
        ["2026-W24", null],
        ["2026-W25", null],
      ]);
    });

    it("getWatchEntry returns undefined on a genuine 404 but propagates a 500", async () => {
      process.env.NEXT_PUBLIC_API_URL = "https://api.example.test";
      const fetchMock = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        statusText: "Not Found",
        json: async () => ({}),
      });
      vi.stubGlobal("fetch", fetchMock);

      await expect(getWatchEntry("ALT-MISSING")).resolves.toBeUndefined();

      fetchMock.mockResolvedValue({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
        json: async () => ({}),
      });
      await expect(getWatchEntry("ALT-5001")).rejects.toMatchObject({
        status: 500,
      });
    });

    it("watchAlert posts to /alerts/{id}/watch with auth and returns the created entry on 201", async () => {
      process.env.NEXT_PUBLIC_API_URL = "https://api.example.test";
      document.cookie = "mapencroach_token=test-token-123; path=/";
      const entry = FIXTURE_WATCH_ENTRIES[0];
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        status: 201,
        statusText: "Created",
        json: async () => entry,
      });
      vi.stubGlobal("fetch", fetchMock);

      const result = await watchAlert("ALT-5001");

      expect(fetchMock.mock.calls[0][0]).toBe(
        "https://api.example.test/alerts/ALT-5001/watch"
      );
      const [, init] = fetchMock.mock.calls[0];
      expect(init.method).toBe("POST");
      expect(init.headers).toMatchObject({
        Authorization: "Bearer test-token-123",
      });
      expect(result).toEqual({
        ok: true,
        status: 201,
        entry: withExpectedWatchImageUrls([entry])[0],
      });
      document.cookie = "mapencroach_token=; path=/; max-age=0";
    });

    it("watchAlert returns the refusal detail on a 422 (alert tier is not RED)", async () => {
      process.env.NEXT_PUBLIC_API_URL = "https://api.example.test";
      const fetchMock = vi.fn().mockResolvedValue({
        ok: false,
        status: 422,
        statusText: "Unprocessable Entity",
        json: async () => ({ detail: "alert tier must be RED" }),
      });
      vi.stubGlobal("fetch", fetchMock);

      const result = await watchAlert("ALT-5003");

      expect(result).toEqual({
        ok: false,
        status: 422,
        detail: "alert tier must be RED",
      });
    });

    it("watchAlert returns the refusal detail on a 409 (already watched)", async () => {
      process.env.NEXT_PUBLIC_API_URL = "https://api.example.test";
      const fetchMock = vi.fn().mockResolvedValue({
        ok: false,
        status: 409,
        statusText: "Conflict",
        json: async () => ({ detail: "already watched" }),
      });
      vi.stubGlobal("fetch", fetchMock);

      const result = await watchAlert("ALT-5001");

      expect(result).toEqual({ ok: false, status: 409, detail: "already watched" });
    });

    it("unwatchAlert deletes /alerts/{id}/watch and returns ok:true on 204", async () => {
      process.env.NEXT_PUBLIC_API_URL = "https://api.example.test";
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        status: 204,
        statusText: "No Content",
        json: async () => {
          throw new Error("no body");
        },
      });
      vi.stubGlobal("fetch", fetchMock);

      const result = await unwatchAlert("ALT-5001");

      expect(fetchMock.mock.calls[0][0]).toBe(
        "https://api.example.test/alerts/ALT-5001/watch"
      );
      const [, init] = fetchMock.mock.calls[0];
      expect(init.method).toBe("DELETE");
      expect(result).toEqual({ ok: true, status: 204 });
    });

    it("unwatchAlert falls back to statusText when the 404 body has no detail", async () => {
      process.env.NEXT_PUBLIC_API_URL = "https://api.example.test";
      const fetchMock = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        statusText: "Not Found",
        json: async () => {
          throw new Error("not json");
        },
      });
      vi.stubGlobal("fetch", fetchMock);

      const result = await unwatchAlert("ALT-9999");

      expect(result).toEqual({ ok: false, status: 404, detail: "Not Found" });
    });

    it("runCaptures posts to /watchlist/{id}/captures and returns only the newly attempted weeks, with image_url derived per week", async () => {
      process.env.NEXT_PUBLIC_API_URL = "https://api.example.test";
      const newAttempts = [
        {
          week: "2026-W31",
          status: "captured",
          attempted_at: "2026-08-01T06:00:00Z",
          scene_id: "S2A_SCENE_NEW",
          sha256: "abc123",
          cloud_pct: 10.0,
          reason: null,
        },
      ];
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        status: 201,
        statusText: "Created",
        json: async () => newAttempts,
      });
      vi.stubGlobal("fetch", fetchMock);

      const result = await runCaptures("ALT-5001");

      expect(fetchMock.mock.calls[0][0]).toBe(
        "https://api.example.test/watchlist/ALT-5001/captures"
      );
      const [, init] = fetchMock.mock.calls[0];
      expect(init.method).toBe("POST");
      expect(result).toEqual({
        ok: true,
        status: 201,
        attempts: [
          {
            week: "2026-W31",
            status: "captured",
            attempted_at: "2026-08-01T06:00:00Z",
            scene_id: "S2A_SCENE_NEW",
            sha256: "abc123",
            cloud_pct: 10.0,
            reason: null,
            image_url:
              "https://api.example.test/watchlist/ALT-5001/weeks/2026-W31/image",
          },
        ],
      });
    });

    it("runCaptures propagates a non-2xx failure with its detail", async () => {
      process.env.NEXT_PUBLIC_API_URL = "https://api.example.test";
      const fetchMock = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        statusText: "Not Found",
        json: async () => ({ detail: "not watched" }),
      });
      vi.stubGlobal("fetch", fetchMock);

      const result = await runCaptures("ALT-9999");

      expect(result).toEqual({ ok: false, status: 404, detail: "not watched" });
    });
  });
});

describe("case imagery backfill endpoints", () => {
  describe("without NEXT_PUBLIC_API_URL (fixture mode)", () => {
    it("getCaseImagery falls back to an explicit fixture entry when one is authored", async () => {
      delete process.env.NEXT_PUBLIC_API_URL;

      const imagery = await getCaseImagery("CASE-9001");

      expect(imagery).toEqual(FIXTURE_CASE_IMAGERY["CASE-9001"]);
      expect(imagery?.watchable).toBe(true);
      expect(imagery?.remaining_backfill_weeks).toBeGreaterThan(0);
    });

    it("getCaseImagery falls back to an explicit non-RED fixture entry (watchable: false)", async () => {
      delete process.env.NEXT_PUBLIC_API_URL;

      const imagery = await getCaseImagery("CASE-9002");

      expect(imagery).toEqual(FIXTURE_CASE_IMAGERY["CASE-9002"]);
      expect(imagery?.watchable).toBe(false);
    });

    it("getCaseImagery falls back to an explicit fixture entry with no timeline yet", async () => {
      delete process.env.NEXT_PUBLIC_API_URL;

      const imagery = await getCaseImagery("CASE-9005");

      expect(imagery).toEqual(FIXTURE_CASE_IMAGERY["CASE-9005"]);
      expect(imagery?.started_on).toBeNull();
      expect(imagery?.captures).toEqual([]);
    });

    it("getCaseImagery derives a 'no timeline yet' record for a fixture case with no explicit imagery entry", async () => {
      delete process.env.NEXT_PUBLIC_API_URL;
      // CASE-9003 exists in FIXTURE_CASES but has no FIXTURE_CASE_IMAGERY
      // entry authored for it — the derived fallback should still resolve
      // to something sensible rather than throwing or returning undefined.
      expect(FIXTURE_CASE_IMAGERY["CASE-9003"]).toBeUndefined();
      const caseRecord = FIXTURE_CASES.find((c) => c.id === "CASE-9003")!;
      const alert = FIXTURE_ALERTS.find((a) => a.id === caseRecord.alert_id)!;

      const imagery = await getCaseImagery("CASE-9003");

      expect(imagery).toEqual({
        case_id: "CASE-9003",
        alert_id: caseRecord.alert_id,
        parcel_id: caseRecord.parcel_id,
        alert_tier: alert.tier.toUpperCase(),
        watchable: alert.tier === "red",
        started_on: null,
        cadence: "weekly",
        captures: [],
        due_weeks: [],
        backfill_floor: CASE_IMAGERY_BACKFILL_FLOOR,
        remaining_backfill_weeks: 0, // alert.tier is "legacy", not RED
      });
    });

    it("getCaseImagery returns undefined for a case id with no fixture case at all", async () => {
      delete process.env.NEXT_PUBLIC_API_URL;

      await expect(getCaseImagery("CASE-DOES-NOT-EXIST")).resolves.toBeUndefined();
    });

    it("backfillCaseImagery refuses as read-only without calling fetch", async () => {
      delete process.env.NEXT_PUBLIC_API_URL;
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);

      await expect(backfillCaseImagery("CASE-9001")).resolves.toEqual({
        ok: false,
        status: 0,
        detail: "No backend configured — fixture mode is read-only.",
      });
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe("with NEXT_PUBLIC_API_URL set", () => {
    it("getCaseImagery fetches from the REST backend", async () => {
      process.env.NEXT_PUBLIC_API_URL = "https://api.example.test";
      const remoteImagery = FIXTURE_CASE_IMAGERY["CASE-9001"];
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => remoteImagery,
      });
      vi.stubGlobal("fetch", fetchMock);

      const imagery = await getCaseImagery("CASE-9001");

      expect(fetchMock.mock.calls[0][0]).toBe(
        "https://api.example.test/cases/CASE-9001/imagery"
      );
      expect(imagery).toEqual(withExpectedCaseImageUrls(remoteImagery));
    });

    it("getCaseImagery returns undefined on a genuine 404 but propagates a 500", async () => {
      process.env.NEXT_PUBLIC_API_URL = "https://api.example.test";
      const fetchMock = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        statusText: "Not Found",
        json: async () => ({}),
      });
      vi.stubGlobal("fetch", fetchMock);

      await expect(getCaseImagery("CASE-MISSING")).resolves.toBeUndefined();

      fetchMock.mockResolvedValue({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
        json: async () => ({}),
      });
      await expect(getCaseImagery("CASE-9001")).rejects.toMatchObject({
        status: 500,
      });
    });

    it("backfillCaseImagery posts to /cases/{id}/imagery/backfill with auth, an empty default body, and returns the chunk result on 201 with image_url derived per week", async () => {
      process.env.NEXT_PUBLIC_API_URL = "https://api.example.test";
      document.cookie = "mapencroach_token=test-token-123; path=/";
      const chunkResult = {
        attempted: [
          {
            week: "2026-W02",
            status: "captured",
            attempted_at: "2026-08-01T09:00:00Z",
            scene_id: "S2A_SCENE_BACKFILL",
            sha256: "abc123",
            cloud_pct: 12.0,
            reason: null,
          },
        ],
        started_on: "2025-12-29",
        remaining_backfill_weeks: 9,
      };
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        status: 201,
        statusText: "Created",
        json: async () => chunkResult,
      });
      vi.stubGlobal("fetch", fetchMock);

      const result = await backfillCaseImagery("CASE-9001");

      expect(fetchMock.mock.calls[0][0]).toBe(
        "https://api.example.test/cases/CASE-9001/imagery/backfill"
      );
      const [, init] = fetchMock.mock.calls[0];
      expect(init.method).toBe("POST");
      expect(init.headers).toMatchObject({
        "Content-Type": "application/json",
        Authorization: "Bearer test-token-123",
      });
      expect(JSON.parse(init.body)).toEqual({});
      expect(result).toEqual({
        ok: true,
        status: 201,
        attempted: [
          {
            week: "2026-W02",
            status: "captured",
            attempted_at: "2026-08-01T09:00:00Z",
            scene_id: "S2A_SCENE_BACKFILL",
            sha256: "abc123",
            cloud_pct: 12.0,
            reason: null,
            image_url:
              "https://api.example.test/cases/CASE-9001/imagery/2026-W02/image",
          },
        ],
        started_on: chunkResult.started_on,
        remaining_backfill_weeks: chunkResult.remaining_backfill_weeks,
      });
      document.cookie = "mapencroach_token=; path=/; max-age=0";
    });

    it("backfillCaseImagery nulls image_url for a backfilled week that was not captured (there is provably nothing to serve)", async () => {
      process.env.NEXT_PUBLIC_API_URL = "https://api.example.test";
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        status: 201,
        statusText: "Created",
        json: async () => ({
          attempted: [
            {
              week: "2026-W03",
              status: "no_usable_scene",
              attempted_at: "2026-08-01T09:00:00Z",
              scene_id: null,
              sha256: null,
              cloud_pct: null,
              reason:
                "No Sentinel-2 scene intersects this parcel's footprint within the 2026-01-12–2026-01-18 catalog window.",
            },
          ],
          started_on: "2025-12-29",
          remaining_backfill_weeks: 8,
        }),
      });
      vi.stubGlobal("fetch", fetchMock);

      const result = await backfillCaseImagery("CASE-9001");

      expect(result.attempted?.[0]).toMatchObject({
        week: "2026-W03",
        status: "no_usable_scene",
        image_url: null,
      });
    });

    it("backfillCaseImagery sends from/max_weeks only when provided", async () => {
      process.env.NEXT_PUBLIC_API_URL = "https://api.example.test";
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        status: 201,
        statusText: "Created",
        json: async () => ({
          attempted: [],
          started_on: "2026-01-01",
          remaining_backfill_weeks: 0,
        }),
      });
      vi.stubGlobal("fetch", fetchMock);

      await backfillCaseImagery("CASE-9001", { from: "2026-01-01", maxWeeks: 5 });

      const [, init] = fetchMock.mock.calls[0];
      expect(JSON.parse(init.body)).toEqual({
        from: "2026-01-01",
        max_weeks: 5,
      });
    });

    it("backfillCaseImagery propagates a 422 refusal (originating alert tier is not RED)", async () => {
      process.env.NEXT_PUBLIC_API_URL = "https://api.example.test";
      const fetchMock = vi.fn().mockResolvedValue({
        ok: false,
        status: 422,
        statusText: "Unprocessable Entity",
        json: async () => ({ detail: "originating alert tier must be RED" }),
      });
      vi.stubGlobal("fetch", fetchMock);

      const result = await backfillCaseImagery("CASE-9002");

      expect(result).toEqual({
        ok: false,
        status: 422,
        detail: "originating alert tier must be RED",
      });
    });
  });
});

describe("getJurisdictions", () => {
  it("falls back to the fixture jurisdiction tree when no backend is configured", async () => {
    delete process.env.NEXT_PUBLIC_API_URL;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const jurisdictions = await getJurisdictions();

    expect(jurisdictions).toEqual(FIXTURE_JURISDICTIONS);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fetches the jurisdiction tree from the backend", async () => {
    process.env.NEXT_PUBLIC_API_URL = "https://api.example.test";
    const remote = [
      { id: "state", name: "HRDA", parent_id: null },
      { id: "dist-a", name: "Haridwar Division", parent_id: "state" },
    ];
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => remote,
    });
    vi.stubGlobal("fetch", fetchMock);

    const jurisdictions = await getJurisdictions("test-token-123");

    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://api.example.test/jurisdictions"
    );
    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers).toMatchObject({
      Authorization: "Bearer test-token-123",
    });
    expect(jurisdictions).toEqual(remote);
  });

  it("fixture tree mirrors the backend seed: includes the Pune and Alleppey districts under their state authorities", () => {
    const byId = new Map(FIXTURE_JURISDICTIONS.map((j) => [j.id, j]));

    // Regression: the backend seed (store.py) added Kerala/Maharashtra
    // authorities under a synthetic single "deployment" root, but the web
    // fixtures lagged behind at the HRDA-only tree, so fixture/no-backend
    // mode (how the demo runs without a live API) never showed Pune or
    // Alleppey in the transfer dropdown.
    expect(byId.get("deployment")).toEqual({
      id: "deployment",
      name: "mapencroach demo deployment",
      parent_id: null,
    });
    expect(byId.get("state")?.parent_id).toBe("deployment");
    expect(byId.get("dist-alappuzha")).toEqual({
      id: "dist-alappuzha",
      name: "Alappuzha District",
      parent_id: "state-kl",
    });
    expect(byId.get("dist-pune")).toEqual({
      id: "dist-pune",
      name: "Pune District",
      parent_id: "state-mh",
    });
    // Exactly one root, mirroring the single-rooted backend JurisdictionTree.
    expect(FIXTURE_JURISDICTIONS.filter((j) => j.parent_id === null)).toHaveLength(1);
    // Every non-root parent must resolve to a known node (the dangling-parent
    // guard the backend enforces at construction).
    for (const j of FIXTURE_JURISDICTIONS) {
      if (j.parent_id !== null) expect(byId.has(j.parent_id)).toBe(true);
    }
  });
});

describe("transferCase", () => {
  it("returns a read-only message without calling fetch when no backend is configured", async () => {
    delete process.env.NEXT_PUBLIC_API_URL;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await transferCase("CASE-9001", "dist-b", "handover to Roorkee");

    expect(result).toEqual({
      ok: false,
      status: 0,
      detail: "No backend configured — fixture mode is read-only.",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("posts a transfer and returns ok:true with the auth header when a token is set", async () => {
    process.env.NEXT_PUBLIC_API_URL = "https://api.example.test";

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => ({
        id: "CASE-9001",
        jurisdiction_id: "taluk-b1",
        state: "SHOW_CAUSE_ISSUED",
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await transferCase(
      "CASE-9001",
      "taluk-b1",
      "workload rebalance",
      "test-token-123"
    );

    expect(result).toEqual({ ok: true, status: 200 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.example.test/cases/CASE-9001/transfer");
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({
      "Content-Type": "application/json",
      Authorization: "Bearer test-token-123",
    });
    expect(JSON.parse(init.body)).toEqual({
      to_jurisdiction_id: "taluk-b1",
      reason: "workload rebalance",
    });
  });

  it("returns ok:false with the passed-through detail on an HTTP failure", async () => {
    process.env.NEXT_PUBLIC_API_URL = "https://api.example.test";

    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      statusText: "Bad Request",
      json: async () => ({ detail: "unknown jurisdiction 'bogus'" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await transferCase("CASE-9001", "bogus", "typo target");

    expect(result).toEqual({
      ok: false,
      status: 400,
      detail: "unknown jurisdiction 'bogus'",
    });
  });

  it("falls back to statusText when the error body has no detail", async () => {
    process.env.NEXT_PUBLIC_API_URL = "https://api.example.test";

    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      statusText: "Forbidden",
      json: async () => {
        throw new Error("not json");
      },
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await transferCase("CASE-9001", "taluk-b1", "nope");

    expect(result).toEqual({
      ok: false,
      status: 403,
      detail: "Forbidden",
    });
  });

  it("resolves to a friendly ok:false result when fetch rejects (network outage)", async () => {
    process.env.NEXT_PUBLIC_API_URL = "https://api.example.test";
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("network down"));
    vi.stubGlobal("fetch", fetchMock);

    const result = await transferCase("CASE-9001", "taluk-b1", "handover");

    expect(result).toEqual({
      ok: false,
      status: 0,
      detail: "Transfer service could not be reached. Try again.",
    });
  });
});
