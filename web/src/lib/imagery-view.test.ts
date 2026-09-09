import { describe, expect, it } from "vitest";
import { createBrowseView, browseViewReducer, activeBrowseIds } from "./imagery-view";
import type { SceneWindow } from "./latest-imagery";
const windows: SceneWindow[] = [
  { id: "jan", label: "Jan", startDate: "2026-01-30", endDate: "2026-01-31" },
  { id: "feb", label: "Feb", startDate: "2026-02-27", endDate: "2026-02-28" },
  { id: "latest", label: "Latest", startDate: "2026-03-01", endDate: "2026-03-03" },
];

describe("browse view state", () => {
  it("loads only the selected window, then lets A/B change and swap independently", () => {
    let s = createBrowseView(windows);
    expect(activeBrowseIds(s)).toEqual(["latest"]);
    s = browseViewReducer(s, { type: "view", view: "compare" });
    expect(activeBrowseIds(s)).toEqual(["jan", "latest"]);
    s = browseViewReducer(s, { type: "choose", side: "a", id: "feb" });
    expect(activeBrowseIds(s)).toEqual(["feb", "latest"]);
    s = browseViewReducer(s, { type: "swap" });
    expect(activeBrowseIds(s)).toEqual(["latest", "feb"]);
    expect(browseViewReducer(s, {type:"choose",side:"b",id:"latest"})).toBe(s);
  });
  it("ignores an old request after switching away and back", () => {
    let s = createBrowseView(windows);
    const old = {id:"latest", ...s.results.latest};
    s = browseViewReducer(s, {type:"select",id:"jan"});
    s = browseViewReducer(s, {type:"select",id:"latest"});
    const current = s;
    s = browseViewReducer(s, {type:"settle", requests:[old], outcome:"preview"});
    expect(s).toBe(current);
    expect(s.results.latest.status).toBe("loading");
  });
  it("only blank pixels advance the bounded search; errors remain retryable", () => {
    let s = browseViewReducer(createBrowseView(windows), {type:"select",id:"jan"});
    s = browseViewReducer(s, {type:"settle",requests:[{id:"jan",...s.results.jan}],outcome:"blank"});
    expect(s.results.jan.requestedDate).toBe("2026-01-30");
    s = browseViewReducer(s, {type:"settle",requests:[{id:"jan",...s.results.jan}],outcome:"blank"});
    expect(s.results.jan.status).toBe("empty");
    s = browseViewReducer(s, {type:"select",id:"feb"});
    s = browseViewReducer(s, {type:"settle",requests:[{id:"feb",...s.results.feb}],outcome:"error"});
    expect(s.results.feb.requestedDate).toBe("2026-02-28");
    s = browseViewReducer(s, {type:"retry",id:"feb"});
    expect(s.results.feb.status).toBe("loading");
  });
  it("retains unknown pixel quality without inventing an observed date", () => {
    let s = createBrowseView(windows);
    s = browseViewReducer(s, {type:"settle",requests:[{id:"latest",...s.results.latest}],outcome:"unverified"});
    expect(s.results.latest.status).toBe("unverified");
    expect(s.results.latest).not.toHaveProperty("capturedAt");
  });
  it("handles no windows and a single January window without a comparison", () => {
    const empty=createBrowseView([]);
    expect(activeBrowseIds(empty)).toEqual([]);
    const single=createBrowseView([windows[2]]);
    expect(browseViewReducer(single,{type:"view",view:"compare"})).toBe(single);
  });
});

it("keeps the successful request identity so rendering the result does not reload the image",()=>{
 let s=createBrowseView(windows);const requestId=s.results.latest.requestId;
 s=browseViewReducer(s,{type:"settle",requests:[{id:"latest",...s.results.latest}],outcome:"preview"});
 expect(s.results.latest.requestId).toBe(requestId);
});

it("reports a failed reload of a previously viewed preview and ignores its superseded callbacks", () => {
 let state = createBrowseView(windows);
 const old = { id: "latest", ...state.results.latest };
 state = browseViewReducer(state, { type: "settle", requests: [old], outcome: "preview" });
 state = browseViewReducer(state, { type: "select", id: "jan" });
 state = browseViewReducer(state, { type: "select", id: "latest" });
 expect(browseViewReducer(state, { type: "settle", requests: [old], outcome: "error" })).toBe(state);
 const current = { id: "latest", ...state.results.latest };
 state = browseViewReducer(state, { type: "settle", requests: [current], outcome: "error" });
 expect(state.results.latest.status).toBe("error");
 state = browseViewReducer(state, { type: "retry", id: "latest" });
 expect(state.results.latest.status).toBe("loading");
});
