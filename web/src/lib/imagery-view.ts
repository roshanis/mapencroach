import { isoDayBefore, type SceneWindow } from "./latest-imagery";
import type { CaptureAttempt } from "./types";

export type BrowseStatus = "unrequested" | "loading" | "preview" | "unverified" | "empty" | "error";
export interface BrowseResult {
  requestedDate: string;
  status: BrowseStatus;
  requestId: number;
}
export type ImageryObservation =
  | { kind: "browse"; window: SceneWindow; result: BrowseResult }
  | { kind: "registered"; attempt: CaptureAttempt };
export interface BrowseView {
  windows: SceneWindow[];
  mode: "single" | "compare";
  selectedId: string;
  a: string;
  b: string;
  revision: number;
  results: Record<string, BrowseResult>;
}
export type BrowseAction =
  | { type: "select"; id: string }
  | { type: "choose"; side: "a" | "b"; id: string }
  | { type: "view"; view: "single" | "compare" }
  | { type: "swap" }
  | { type: "retry"; id: string }
  | { type: "settle"; requests: { id: string; requestedDate: string; requestId: number }[];
      outcome: "blank" | "preview" | "unverified" | "error" };

export function activeBrowseIds(state: BrowseView): string[] {
  return [...new Set(state.mode === "compare" ? [state.a, state.b] : [state.selectedId])]
    .filter(id => state.windows.some(window => window.id === id));
}

function activate(state: BrowseView, previouslyActive: string[] = []): BrowseView {
  const ids = activeBrowseIds(state);
  const next = { ...state, results: { ...state.results } };
  for (const window of state.windows) {
    const result = next.results[window.id];
    if (!ids.includes(window.id) && (result.status === "loading" || previouslyActive.includes(window.id))) {
      next.results[window.id] = { ...result,
        status: result.status === "loading" ? "unrequested" : result.status,
        requestId: ++next.revision };
    } else if (ids.includes(window.id) && result.status === "unrequested") {
      next.results[window.id] = { ...result, status: "loading", requestId: ++next.revision };
    }
  }
  return next;
}

export function createBrowseView(windows: SceneWindow[]): BrowseView {
  const last = windows.at(-1)?.id ?? "";
  return activate({ windows, mode: "single", selectedId: last, a: windows[0]?.id ?? "", b: last,
    revision: 0, results: Object.fromEntries(windows.map(window => [window.id,
      {requestedDate:window.endDate, status:"unrequested", requestId:0}])) });
}

export function browseViewReducer(state: BrowseView, action: BrowseAction): BrowseView {
  if (action.type === "select" || action.type === "choose" || action.type === "retry") {
    if (!state.results[action.id]) return state;
  }
  if (action.type === "select") return activate({ ...state, selectedId: action.id }, activeBrowseIds(state));
  if (action.type === "choose") {
    if (action.id === state[action.side === "a" ? "b" : "a"]) return state;
    return activate({ ...state, [action.side]: action.id }, activeBrowseIds(state));
  }
  if (action.type === "view") {
    if (action.view === "compare" && state.windows.length < 2) return state;
    // Prefer already inspected previews without fetching an entire catalog.
    const previews = state.windows.filter(w => ["preview", "unverified"].includes(state.results[w.id].status));
    return activate({ ...state, mode: action.view,
      ...(action.view === "compare" && state.mode === "single" && previews.length >= 2
        ? { a: previews[0].id, b: previews.at(-1)!.id } : {}) }, activeBrowseIds(state));
  }
  if (action.type === "swap") return { ...state, a: state.b, b: state.a };
  if (action.type === "retry") {
    if (!activeBrowseIds(state).includes(action.id)) return state;
    const window = state.windows.find(w => w.id === action.id)!;
    return { ...state, revision:state.revision+1, results:{...state.results, [action.id]:{
      requestedDate:window.endDate, status:"loading", requestId:state.revision+1,
    }} };
  }
  let next = state;
  for (const request of action.requests) {
    const result = next.results[request.id];
    // A previously inspected preview can fail when remounted; keep that failure
    // visible while rejecting callbacks from a superseded image element.
    const canSettle = result && (result.status === "loading" ||
      (action.outcome === "error" && ["preview", "unverified"].includes(result.status)));
    if (!activeBrowseIds(next).includes(request.id) || !canSettle ||
      result.requestId !== request.requestId || result.requestedDate !== request.requestedDate) continue;
    const window = state.windows.find(w => w.id === request.id)!;
    const previous = isoDayBefore(result.requestedDate);
    const advance = action.outcome === "blank" && previous >= window.startDate;
    next = { ...next, revision:next.revision+1, results:{...next.results, [request.id]:{
      requestedDate:advance ? previous : result.requestedDate,
      status:action.outcome === "blank" ? (advance ? "loading" : "empty") : action.outcome,
      requestId:advance ? next.revision+1 : result.requestId,
    }} };
  }
  return next;
}

export const BROWSE_STATUS_LABELS: Record<BrowseStatus, string> = {
  unrequested: "Not loaded", loading: "Searching previews", preview: "Preview available",
  unverified: "Preview quality unverified", empty: "No nonblank preview found", error: "Provider error",
};
