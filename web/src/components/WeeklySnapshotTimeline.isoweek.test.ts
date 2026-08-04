import { describe, expect, it } from "vitest";
import { computeWatchWeeks } from "./WeeklySnapshotTimeline";
import type { WatchEntry } from "@/lib/types";

/**
 * The timeline derives ISO week keys in TypeScript, while the backend
 * derives them in Python. Both label the same evidence, so a divergence
 * would file a snapshot under a week the API never used -- and it would
 * only show up at a year boundary, months after the code shipped.
 *
 * Every expected value below is the output of Python's
 * `date.isocalendar()`, covering the year boundaries where the ISO year
 * differs from the calendar year (2019-12-30 is 2020-W01) and the
 * 53-week years (2020, 2026). The full sweep of every Monday from 2019
 * to 2031 was verified to agree; these are the cases worth keeping
 * pinned.
 */
const PYTHON_ISOCALENDAR: ReadonlyArray<readonly [string, string]> = [
  ["2019-12-23", "2019-W52"],
  ["2019-12-30", "2020-W01"],
  ["2020-12-21", "2020-W52"],
  ["2020-12-28", "2020-W53"], // 2020 has 53 ISO weeks
  ["2021-01-04", "2021-W01"],
  ["2021-12-27", "2021-W52"],
  ["2022-01-03", "2022-W01"],
  ["2023-01-02", "2023-W01"],
  ["2024-01-01", "2024-W01"],
  ["2024-12-30", "2025-W01"],
  ["2025-12-29", "2026-W01"],
  ["2026-12-21", "2026-W52"],
  ["2026-12-28", "2026-W53"], // 2026 has 53 ISO weeks
  ["2027-01-04", "2027-W01"],
  ["2029-12-31", "2030-W01"],
  ["2031-12-29", "2032-W01"],
];

function entryStartedOn(startedOn: string): WatchEntry {
  return {
    alert_id: "alert-iso",
    parcel_id: "PCL-ISO",
    started_on: startedOn,
    cadence: "weekly",
    watched_by: "officer-1",
    captures: [],
    due_weeks: [],
  };
}

describe("WeeklySnapshotTimeline ISO week keys", () => {
  it.each(PYTHON_ISOCALENDAR)(
    "labels the week beginning %s as %s, matching Python isocalendar",
    (monday, expectedKey) => {
      const rows = computeWatchWeeks(
        entryStartedOn(monday),
        new Date(`${monday}T00:00:00Z`)
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].key).toBe(expectedKey);
    }
  );

  it("walks a 53-week year end into the next ISO year without skipping a week", () => {
    const rows = computeWatchWeeks(
      entryStartedOn("2026-12-21"),
      new Date("2027-01-11T00:00:00Z")
    );
    expect(rows.map((row) => row.key)).toEqual([
      "2026-W52",
      "2026-W53",
      "2027-W01",
      "2027-W02",
    ]);
  });
});
