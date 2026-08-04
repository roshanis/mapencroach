import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ApiError,
  addParcelTag,
  getAlerts,
  getCase,
  getCases,
  getJurisdictions,
  getParcel,
  getParcelContext,
  getParcels,
  getPersonas,
  loginPersona,
  removeParcelTag,
  transferCase,
  transitionCase,
  updateBoundaryGrade,
} from "./api";
import {
  FIXTURE_ALERTS,
  FIXTURE_CASES,
  FIXTURE_JURISDICTIONS,
  FIXTURE_PARCELS,
  FIXTURE_PARCEL_CONTEXTS,
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

  it("falls back to fixture alerts and applies tier filter", async () => {
    delete process.env.NEXT_PUBLIC_API_URL;
    const alerts = await getAlerts({ tier: "red" });
    expect(alerts.length).toBeGreaterThan(0);
    expect(alerts.every((a) => a.tier === "red")).toBe(true);
    expect(alerts.length).toBeLessThan(FIXTURE_ALERTS.length);
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

  it("sends no Authorization header when there is no tokenOverride or cookie (NEXT_PUBLIC_API_TOKEN is never consulted)", async () => {
    process.env.NEXT_PUBLIC_API_URL = "https://api.example.test";
    // Set as if a stray build-time env var were present — it must be ignored
    // client-side now that the fallback has been removed from authHeaders.
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
