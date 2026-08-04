import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import {
  computeWatchWeeks,
  WeeklySnapshotTimeline,
} from "./WeeklySnapshotTimeline";
import type { WatchEntry } from "@/lib/types";

const TODAY = new Date("2026-06-22T12:00:00Z"); // Monday of ISO week 2026-W26
const RETAINED_IMAGE_URL =
  "https://api.example.test/watchlist/ALT-5001/weeks/2026-W23/image";

const BASE_ENTRY: WatchEntry = {
  alert_id: "ALT-5001",
  parcel_id: "PCL-1001",
  started_on: "2026-06-01", // Monday of 2026-W23
  cadence: "weekly",
  watched_by: "Enforcement Officer, Haridwar",
  captures: [
    {
      week: "2026-W23",
      status: "captured",
      attempted_at: "2026-06-01T06:15:00Z",
      scene_id: "S2A_SCENE_001",
      sha256: "e57738c57fbbf69c54a29e1f16142c3d44b54990cd3ec625158fd01c63a973d",
      cloud_pct: 8.5,
      reason: null,
      // Captured and retained — the "real thumbnail" case.
      image_url: RETAINED_IMAGE_URL,
    },
    {
      week: "2026-W24",
      status: "no_usable_scene",
      attempted_at: "2026-06-08T06:15:00Z",
      scene_id: null,
      sha256: null,
      cloud_pct: 78.0,
      reason: "Cloud cover 78.0% exceeds the 40.0% usability threshold.",
      image_url: null,
    },
    {
      week: "2026-W25",
      status: "provider_error",
      attempted_at: "2026-06-15T06:15:00Z",
      scene_id: null,
      sha256: null,
      cloud_pct: null,
      reason: "Provider request failed: 503 Service Unavailable.",
      image_url: null,
    },
  ],
  due_weeks: ["2026-W26"],
};

describe("computeWatchWeeks", () => {
  it("builds one row per ISO week from started_on through today, inclusive", () => {
    const rows = computeWatchWeeks(BASE_ENTRY, TODAY);

    expect(rows.map((r) => r.key)).toEqual([
      "2026-W23",
      "2026-W24",
      "2026-W25",
      "2026-W26",
    ]);
    expect(rows.map((r) => r.status)).toEqual([
      "captured",
      "no_usable_scene",
      "provider_error",
      "due",
    ]);
  });

  it("marks a week neither captured nor listed as due as an explicit gap, not silently dropping it", () => {
    const entryWithUndocumentedWeek: WatchEntry = {
      ...BASE_ENTRY,
      due_weeks: [], // 2026-W26 is neither captured nor due
    };

    const rows = computeWatchWeeks(entryWithUndocumentedWeek, TODAY);
    const lastRow = rows[rows.length - 1];

    expect(lastRow.key).toBe("2026-W26");
    expect(lastRow.status).toBe("gap");
  });
});

describe("WeeklySnapshotTimeline", () => {
  it("renders one list item per week, in chronological order, as a semantic list", () => {
    render(<WeeklySnapshotTimeline entry={BASE_ENTRY} today={TODAY} />);

    const list = screen.getByRole("list", {
      name: /weekly capture history for PCL-1001/i,
    });
    expect(list.tagName).toBe("OL");

    const items = screen.getAllByTestId("snapshot-week");
    expect(items.map((el) => el.getAttribute("data-week"))).toEqual([
      "2026-W23",
      "2026-W24",
      "2026-W25",
      "2026-W26",
    ]);
  });

  it("renders a captured week with cloud % and an abbreviated sha256, distinct from other states by text", () => {
    render(<WeeklySnapshotTimeline entry={BASE_ENTRY} today={TODAY} />);

    const rows = screen.getAllByTestId("snapshot-week");
    const capturedRow = rows.find(
      (r) => r.getAttribute("data-week") === "2026-W23"
    )!;
    expect(capturedRow).toHaveAttribute("data-status", "captured");
    expect(capturedRow).toHaveTextContent("Captured");
    expect(capturedRow).toHaveTextContent("8.5% cloud cover");

    const hash = screen.getByTestId("snapshot-week-sha256");
    expect(hash).toHaveTextContent("sha256:e57738c57fbbf69c…");
    // The full hash is preserved (not lost to abbreviation) as the
    // evidence anchor, even though only a prefix is shown.
    expect(hash).toHaveAttribute(
      "title",
      "e57738c57fbbf69c54a29e1f16142c3d44b54990cd3ec625158fd01c63a973d"
    );
  });

  it("renders a no_usable_scene week with its reason, not blank space", () => {
    render(<WeeklySnapshotTimeline entry={BASE_ENTRY} today={TODAY} />);

    const rows = screen.getAllByTestId("snapshot-week");
    const noSceneRow = rows.find(
      (r) => r.getAttribute("data-week") === "2026-W24"
    )!;
    expect(noSceneRow).toHaveAttribute("data-status", "no_usable_scene");
    expect(noSceneRow).toHaveTextContent("No usable scene");
    expect(noSceneRow).toHaveTextContent(
      "Cloud cover 78.0% exceeds the 40.0% usability threshold."
    );
  });

  it("renders a provider_error week with its reason", () => {
    render(<WeeklySnapshotTimeline entry={BASE_ENTRY} today={TODAY} />);

    const rows = screen.getAllByTestId("snapshot-week");
    const errorRow = rows.find(
      (r) => r.getAttribute("data-week") === "2026-W25"
    )!;
    expect(errorRow).toHaveAttribute("data-status", "provider_error");
    expect(errorRow).toHaveTextContent("Provider error");
    expect(errorRow).toHaveTextContent(
      "Provider request failed: 503 Service Unavailable."
    );
  });

  it("renders a due week explicitly, not as blank space", () => {
    render(<WeeklySnapshotTimeline entry={BASE_ENTRY} today={TODAY} />);

    const rows = screen.getAllByTestId("snapshot-week");
    const dueRow = rows.find(
      (r) => r.getAttribute("data-week") === "2026-W26"
    )!;
    expect(dueRow).toHaveAttribute("data-status", "due");
    expect(dueRow).toHaveTextContent("Due — not yet attempted");
    expect(dueRow).toHaveTextContent(
      "This week is due but has not been attempted yet."
    );
  });

  it("renders an undocumented gap week with an explicit explanation, not silence", () => {
    const entryWithUndocumentedWeek: WatchEntry = {
      ...BASE_ENTRY,
      due_weeks: [],
    };
    render(
      <WeeklySnapshotTimeline entry={entryWithUndocumentedWeek} today={TODAY} />
    );

    const rows = screen.getAllByTestId("snapshot-week");
    const gapRow = rows.find(
      (r) => r.getAttribute("data-week") === "2026-W26"
    )!;
    expect(gapRow).toHaveAttribute("data-status", "gap");
    expect(gapRow).toHaveTextContent("Gap — no capture record");
    expect(gapRow).toHaveTextContent(/unexplained gap/i);
  });

  it("renders the not-retained placeholder for a captured week with a null image_url (fixture/demo mode), without ever fetching", () => {
    // Fixture mode has no server behind it — image_url is always null there
    // deliberately (see fixtures.ts). This must render the honest
    // not-retained state and must NOT attempt any network request.
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const entryWithNoImage: WatchEntry = {
      ...BASE_ENTRY,
      captures: BASE_ENTRY.captures.map((capture) =>
        capture.week === "2026-W23"
          ? { ...capture, image_url: null }
          : capture
      ),
    };
    render(<WeeklySnapshotTimeline entry={entryWithNoImage} today={TODAY} />);

    const placeholder = screen.getByTestId("snapshot-week-not-retained");
    expect(placeholder).toHaveTextContent(/image not retained/i);
    expect(placeholder).toHaveTextContent(/hash on record/i);
    expect(
      screen.queryByTestId("snapshot-week-thumbnail")
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("snapshot-week-unauthorized")
    ).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
  });
});

describe("WeeklySnapshotTimeline captured-image loading", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let createObjectURLMock: ReturnType<typeof vi.fn>;
  let revokeObjectURLMock: ReturnType<typeof vi.fn>;

  // jsdom does not implement URL.createObjectURL/revokeObjectURL — assign
  // them directly as static properties (rather than vi.stubGlobal("URL",
  // ...), which would replace the URL constructor itself and break any
  // unrelated `new URL(...)` use) and restore afterwards.
  const originalCreateObjectURL = URL.createObjectURL;
  const originalRevokeObjectURL = URL.revokeObjectURL;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    createObjectURLMock = vi.fn(() => "blob:mock-object-url");
    revokeObjectURLMock = vi.fn();
    URL.createObjectURL = createObjectURLMock;
    URL.revokeObjectURL = revokeObjectURLMock;
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
  });

  it("fetches the image with the app's real auth headers (cookie token), and renders the thumbnail on a 200", async () => {
    document.cookie = "mapencroach_token=test-token-123; path=/";
    const fakeBlob = new Blob(["fake-bytes"], { type: "image/jpeg" });
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      blob: async () => fakeBlob,
    });

    render(<WeeklySnapshotTimeline entry={BASE_ENTRY} today={TODAY} />);

    // A bare <img src> cannot carry the Authorization header the backend
    // requires — the fix fetches with it explicitly instead.
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        RETAINED_IMAGE_URL,
        expect.objectContaining({
          headers: { Authorization: "Bearer test-token-123" },
        })
      );
    });

    const thumbnail = await screen.findByTestId("snapshot-week-thumbnail");
    expect(thumbnail.tagName).toBe("IMG");
    expect(thumbnail).toHaveAttribute("src", "blob:mock-object-url");
    const alt = thumbnail.getAttribute("alt")!;
    expect(alt).toContain("2026-W23");
    expect(alt).toContain("PCL-1001");
    expect(alt.toLowerCase()).not.toBe("image");

    // The "open full size" link now points at the already-fetched object
    // URL (which works cross-origin/unauthenticated once opened), not the
    // raw API path, which would 401/403 exactly like the old <img> did.
    const link = thumbnail.closest("a")!;
    expect(link).toHaveAttribute("href", "blob:mock-object-url");
    expect(link).toHaveAttribute("target", "_blank");

    // No other state is rendered alongside the thumbnail.
    expect(
      screen.queryByTestId("snapshot-week-not-retained")
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("snapshot-week-unauthorized")
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("snapshot-week-load-error")
    ).not.toBeInTheDocument();

    document.cookie = "mapencroach_token=; path=/; max-age=0";
  });

  it("shows a loading state while the fetch is in flight", async () => {
    let resolveFetch!: (value: unknown) => void;
    fetchMock.mockReturnValue(
      new Promise((resolve) => {
        resolveFetch = resolve;
      })
    );

    render(<WeeklySnapshotTimeline entry={BASE_ENTRY} today={TODAY} />);

    expect(
      screen.getByTestId("snapshot-week-thumbnail-loading")
    ).toBeInTheDocument();

    resolveFetch({
      ok: true,
      status: 200,
      blob: async () => new Blob(["x"]),
    });

    await screen.findByTestId("snapshot-week-thumbnail");
  });

  it("renders the truthful not-retained state on a genuine 404 — the only case allowed to claim it", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 404,
      statusText: "Not Found",
    });

    render(<WeeklySnapshotTimeline entry={BASE_ENTRY} today={TODAY} />);

    const placeholder = await screen.findByTestId("snapshot-week-not-retained");
    expect(placeholder).toHaveTextContent(/image not retained/i);
    expect(placeholder).toHaveTextContent(/hash on record/i);
    // The hash stays visible even once the image load has failed.
    expect(screen.getByTestId("snapshot-week-sha256")).toBeInTheDocument();
    expect(
      screen.queryByTestId("snapshot-week-thumbnail")
    ).not.toBeInTheDocument();
  });

  it("renders a distinct unauthorized state on a 401 — and never claims the bytes are not retained", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 401,
      statusText: "Unauthorized",
    });

    render(<WeeklySnapshotTimeline entry={BASE_ENTRY} today={TODAY} />);

    const unauthorized = await screen.findByTestId("snapshot-week-unauthorized");
    expect(unauthorized).toHaveTextContent(/not authorized/i);
    expect(unauthorized.textContent?.toLowerCase()).not.toContain(
      "not retained"
    );
    expect(
      screen.queryByTestId("snapshot-week-not-retained")
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("snapshot-week-thumbnail")
    ).not.toBeInTheDocument();
  });

  it("renders the same distinct unauthorized state on a 403, never claiming 'not retained'", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 403,
      statusText: "Forbidden",
    });

    render(<WeeklySnapshotTimeline entry={BASE_ENTRY} today={TODAY} />);

    const unauthorized = await screen.findByTestId("snapshot-week-unauthorized");
    expect(unauthorized.textContent?.toLowerCase()).not.toContain(
      "not retained"
    );
    expect(
      screen.queryByTestId("snapshot-week-not-retained")
    ).not.toBeInTheDocument();
  });

  it("renders a distinct, retryable error state on a network failure — not the not-retained state", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));

    render(<WeeklySnapshotTimeline entry={BASE_ENTRY} today={TODAY} />);

    const errorState = await screen.findByTestId("snapshot-week-load-error");
    expect(errorState).toHaveTextContent(/could not be loaded/i);
    expect(errorState.textContent?.toLowerCase()).not.toContain(
      "not retained"
    );
    expect(
      screen.queryByTestId("snapshot-week-not-retained")
    ).not.toBeInTheDocument();

    const retryButton = screen.getByTestId("snapshot-week-retry");
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      blob: async () => new Blob(["x"]),
    });
    fireEvent.click(retryButton);

    await screen.findByTestId("snapshot-week-thumbnail");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("renders the same distinct error state on a non-404/401/403 failure status (e.g. 500)", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
    });

    render(<WeeklySnapshotTimeline entry={BASE_ENTRY} today={TODAY} />);

    const errorState = await screen.findByTestId("snapshot-week-load-error");
    expect(errorState.textContent?.toLowerCase()).not.toContain(
      "not retained"
    );
  });

  it("revokes the created object URL on unmount, and does not update state after unmount", async () => {
    let resolveFetch!: (value: unknown) => void;
    fetchMock.mockReturnValue(
      new Promise((resolve) => {
        resolveFetch = resolve;
      })
    );

    const { unmount } = render(
      <WeeklySnapshotTimeline entry={BASE_ENTRY} today={TODAY} />
    );
    expect(
      screen.getByTestId("snapshot-week-thumbnail-loading")
    ).toBeInTheDocument();

    unmount();

    // Resolve after unmount — the cancellation flag must prevent a
    // setState-after-unmount and must not leak an unrevoked object URL.
    resolveFetch({
      ok: true,
      status: 200,
      blob: async () => new Blob(["x"]),
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(createObjectURLMock).not.toHaveBeenCalled();
  });

  it("revokes a previously created object URL when the fetch resolves before unmount, then component unmounts", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      blob: async () => new Blob(["x"]),
    });

    const { unmount } = render(
      <WeeklySnapshotTimeline entry={BASE_ENTRY} today={TODAY} />
    );

    await screen.findByTestId("snapshot-week-thumbnail");
    expect(createObjectURLMock).toHaveBeenCalledTimes(1);
    expect(revokeObjectURLMock).not.toHaveBeenCalled();

    unmount();

    expect(revokeObjectURLMock).toHaveBeenCalledWith("blob:mock-object-url");
  });
});
