import { afterEach, expect, it, vi } from "vitest";
import { getAlerts, getCases, getParcels, getWatchlist } from "./api";

function response(data: unknown, total: number) {
  return { ok: true, headers: new Headers({"X-Total-Count": String(total)}), json: async () => data };
}
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
it.each([
  ["alerts", getAlerts, (id: string) => ({id, tier:"RED", status:"OPEN"})],
  ["cases", getCases, (id: string) => ({id, events:[]})],
  ["watchlist", getWatchlist, (id: string) => ({alert_id:id, captures:[]})],
] as const)("loads every %s page without dropping auth", async (_name, load, item) => {
  vi.stubEnv("NEXT_PUBLIC_API_URL", "https://api.test");
  const fetch = vi.fn().mockResolvedValueOnce(response([item("one")],2)).mockResolvedValueOnce(response([item("two")],2));
  vi.stubGlobal("fetch",fetch);
  expect(await load("test-token")).toHaveLength(2);
  expect(fetch.mock.calls[1][0]).toContain("offset=1");
  expect(fetch.mock.calls[1][1].headers.Authorization).toBe("Bearer test-token");
});
it("loads parcel metadata beyond the first page", async () => {
  vi.stubEnv("NEXT_PUBLIC_API_URL", "https://api.test");
  const feature = (id:string) => ({properties:{id},geometry:{type:"Polygon",coordinates:[[[1,2],[2,3],[1,2]]]}});
  vi.stubGlobal("fetch",vi.fn().mockResolvedValueOnce(response({features:[feature("a")]},2)).mockResolvedValueOnce(response({features:[feature("b")]},2)));
  expect((await getParcels()).map(p=>p.id)).toEqual(["a","b"]);
});
it("refuses an incomplete repeated page rather than looping or reporting full coverage", async () => {
  vi.stubEnv("NEXT_PUBLIC_API_URL", "https://api.test");
  vi.stubGlobal("fetch",vi.fn().mockResolvedValue(response([{id:"a",tier:"RED",status:"OPEN"}],2)));
  await expect(getAlerts()).rejects.toThrow(/incomplete|pagination/i);
});
