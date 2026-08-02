import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  computeWatchWeeks,
  WeeklySnapshotTimeline,
} from "./WeeklySnapshotTimeline";
import type { WatchEntry } from "@/lib/types";

const TODAY = new Date("2026-06-22T12:00:00Z"); // Monday of ISO week 2026-W26

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
});
