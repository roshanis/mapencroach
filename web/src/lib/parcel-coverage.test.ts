import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getParcelPage, getParcels } from "./api";

const BASE = "https://api.test";

function collection(n: number) {
  return {
    type: "FeatureCollection",
    features: Array.from({ length: n }, (_, i) => ({
      type: "Feature",
      geometry: {
        type: "Polygon",
        coordinates: [[[78, 29], [78.01, 29], [78.01, 29.01], [78, 29.01], [78, 29]]],
      },
      properties: {
        id: `p-${i}`,
        survey_no: `S${i}`,
        ulpin: `U${i}`,
        owning_department: "D",
        land_category: "revenue",
        boundary_grade: "B",
        jurisdiction_id: "t1",
      },
    })),
  };
}

function mockFetch(n: number, totalHeader: string | null) {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    statusText: "OK",
    headers: { get: (h: string) => (h === "X-Total-Count" ? totalHeader : null) },
    json: async () => collection(n),
  });
}

describe("parcel coverage", () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_API_URL = BASE;
  });
  afterEach(() => {
    delete process.env.NEXT_PUBLIC_API_URL;
    vi.unstubAllGlobals();
  });

  it("reports truncation when the server holds more than it returned", async () => {
    // The regression: /parcels caps at its default page size and reports the
    // real total only in a header. Discarding that header renders the first
    // page as the whole estate.
    vi.stubGlobal("fetch", mockFetch(200, "50000"));
    const page = await getParcelPage();
    expect(page.parcels).toHaveLength(200);
    expect(page.total).toBe(50000);
    expect(page.truncated).toBe(true);
  });

  it("is not truncated when the page covers the whole scope", async () => {
    vi.stubGlobal("fetch", mockFetch(42, "42"));
    const page = await getParcelPage();
    expect(page.truncated).toBe(false);
    expect(page.total).toBe(42);
  });

  it("does not claim truncation when the header is missing", async () => {
    // Unknown coverage must not render as a false alarm.
    vi.stubGlobal("fetch", mockFetch(10, null));
    const page = await getParcelPage();
    expect(page.total).toBeUndefined();
    expect(page.truncated).toBe(false);
  });

  it("does not claim truncation on a garbage header", async () => {
    vi.stubGlobal("fetch", mockFetch(10, "not-a-number"));
    const page = await getParcelPage();
    expect(page.total).toBeUndefined();
    expect(page.truncated).toBe(false);
  });

  it("never reports a total smaller than what it returned as truncated", async () => {
    vi.stubGlobal("fetch", mockFetch(10, "3"));
    const page = await getParcelPage();
    expect(page.truncated).toBe(false);
  });

  it("getParcels still returns a plain array for callers that only need one", async () => {
    vi.stubGlobal("fetch", mockFetch(5, "5"));
    const parcels = await getParcels();
    expect(Array.isArray(parcels)).toBe(true);
    expect(parcels).toHaveLength(5);
  });

  it("fixture mode is never truncated", async () => {
    delete process.env.NEXT_PUBLIC_API_URL;
    const page = await getParcelPage();
    expect(page.truncated).toBe(false);
    expect(page.total).toBe(page.parcels.length);
  });
});
