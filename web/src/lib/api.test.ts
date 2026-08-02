import { afterEach, describe, expect, it, vi } from "vitest";
import {
  addParcelTag,
  getAlerts,
  getCase,
  getCases,
  getParcel,
  getParcelContext,
  getParcels,
  getPersonas,
  getWatchEntry,
  getWatchlist,
  loginPersona,
  removeParcelTag,
  runCaptures,
  transitionCase,
  unwatchAlert,
  watchAlert,
} from "./api";
import {
  FIXTURE_ALERTS,
  FIXTURE_CASES,
  FIXTURE_PARCELS,
  FIXTURE_PARCEL_CONTEXTS,
  FIXTURE_WATCH_ENTRIES,
} from "./fixtures";

const ORIGINAL_ENV = process.env.NEXT_PUBLIC_API_URL;
const ORIGINAL_TOKEN = process.env.NEXT_PUBLIC_API_TOKEN;

afterEach(() => {
  if (ORIGINAL_ENV === undefined) {
    delete process.env.NEXT_PUBLIC_API_URL;
  } else {
    process.env.NEXT_PUBLIC_API_URL = ORIGINAL_ENV;
  }
  if (ORIGINAL_TOKEN === undefined) {
    delete process.env.NEXT_PUBLIC_API_TOKEN;
  } else {
    process.env.NEXT_PUBLIC_API_TOKEN = ORIGINAL_TOKEN;
  }
  vi.unstubAllGlobals();
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
      "moving forward"
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
    delete process.env.NEXT_PUBLIC_API_TOKEN;

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

describe("authHeaders token precedence", () => {
  afterEach(() => {
    document.cookie = "mapencroach_token=; path=/; max-age=0";
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

  it("falls back to the cookie token when no override is passed", async () => {
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

  it("never sends NEXT_PUBLIC_API_TOKEN as a Bearer fallback, even when set and no cookie/override is present", async () => {
    process.env.NEXT_PUBLIC_API_URL = "https://api.example.test";
    process.env.NEXT_PUBLIC_API_TOKEN = "insecure-client-token";
    // No cookie set — the old code fell back to the env var here.

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

    const result = await addParcelTag("PCL-1001", "flagged");

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
      expect(entries).toEqual(FIXTURE_WATCH_ENTRIES);
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
      expect(result).toEqual({ ok: true, status: 201, entry });
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

    it("runCaptures posts to /watchlist/{id}/captures and returns only the newly attempted weeks", async () => {
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
      expect(result).toEqual({ ok: true, status: 201, attempts: newAttempts });
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
