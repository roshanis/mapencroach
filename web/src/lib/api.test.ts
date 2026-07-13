import { afterEach, describe, expect, it, vi } from "vitest";
import {
  addParcelTag,
  getAlerts,
  getCase,
  getCases,
  getParcel,
  getParcels,
  getPersonas,
  loginPersona,
  removeParcelTag,
  transitionCase,
} from "./api";
import { FIXTURE_ALERTS, FIXTURE_CASES, FIXTURE_PARCELS } from "./fixtures";

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
    process.env.NEXT_PUBLIC_API_TOKEN = "test-token-123";

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

  it("prefers the cookie token over NEXT_PUBLIC_API_TOKEN when posting a transition", async () => {
    process.env.NEXT_PUBLIC_API_URL = "https://api.example.test";
    process.env.NEXT_PUBLIC_API_TOKEN = "env-token";
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

  it("uses a tokenOverride argument over both cookie and env token", async () => {
    process.env.NEXT_PUBLIC_API_URL = "https://api.example.test";
    process.env.NEXT_PUBLIC_API_TOKEN = "env-token";
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
    process.env.NEXT_PUBLIC_API_TOKEN = "test-token-123";

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
