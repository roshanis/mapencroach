import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { CaseImageryHistory } from "./CaseImageryHistory";
import { backfillCaseImagery } from "@/lib/api";
import type { BackfillCaseImageryResult } from "@/lib/api";
import type { CaptureAttempt, CaseImagery } from "@/lib/types";

vi.mock("@/lib/api", () => ({
  backfillCaseImagery: vi.fn(),
}));

// The mocked backfillCaseImagery is a single shared vi.fn() instance across
// this whole file (vi.mock's factory runs once) — clear it between tests so
// queued mockResolvedValueOnce/mockReturnValueOnce implementations and call
// counts from one test never bleed into the next.
afterEach(() => {
  vi.clearAllMocks();
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function capturedWeek(week: string, cloudPct: number): CaptureAttempt {
  return {
    week,
    status: "captured",
    attempted_at: "2026-08-01T09:00:00Z",
    scene_id: `S2A_MSIL2A_${week.replace(/[^0-9]/g, "")}_T44RNA`,
    sha256: `${week}-fake-digest`.padEnd(64, "0"),
    cloud_pct: cloudPct,
    reason: null,
    // These fixtures represent captured-but-not-retained bytes (no backend
    // in these component tests to actually serve anything from), matching
    // WeeklySnapshotTimeline's "not retained" row for a captured week.
    image_url: null,
  };
}

const BASE_IMAGERY: CaseImagery = {
  case_id: "CASE-9001",
  alert_id: "ALT-5001",
  parcel_id: "PCL-1001",
  alert_tier: "RED",
  watchable: true,
  started_on: null,
  cadence: "weekly",
  captures: [],
  due_weeks: [],
  backfill_floor: "2026-01-01",
  remaining_backfill_weeks: 0,
};

describe("CaseImageryHistory", () => {
  describe("a non-RED case", () => {
    const imagery: CaseImagery = {
      ...BASE_IMAGERY,
      case_id: "CASE-9002",
      alert_id: "ALT-5004",
      parcel_id: "PCL-1006",
      alert_tier: "GREEN",
      watchable: false,
    };

    it("explains that backfill is scoped to red-flagged cases and never offers a control", () => {
      render(<CaseImageryHistory caseId="CASE-9002" initialImagery={imagery} />);

      expect(screen.getByTestId("case-imagery-not-watchable")).toHaveTextContent(
        /only offered for red-flagged cases/i
      );
      expect(screen.getByTestId("case-imagery-not-watchable")).toHaveTextContent(
        /green/i
      );
      expect(screen.queryByRole("button")).not.toBeInTheDocument();
      expect(backfillCaseImagery).not.toHaveBeenCalled();
    });

    it("still shows existing history for a non-RED case without offering to continue backfilling it", () => {
      const withHistory: CaseImagery = {
        ...imagery,
        started_on: "2026-06-01",
        captures: [capturedWeek("2026-W23", 8.5)],
        due_weeks: [],
      };
      render(
        <CaseImageryHistory
          caseId="CASE-9002"
          initialImagery={withHistory}
          today={new Date("2026-06-01T12:00:00Z")}
        />
      );

      expect(screen.getAllByTestId("snapshot-week")).toHaveLength(1);
      expect(screen.queryByRole("button")).not.toBeInTheDocument();
    });
  });

  describe("a RED case with no timeline yet", () => {
    it("says plainly that nothing has been fetched and offers to start backfill", () => {
      const imagery: CaseImagery = {
        ...BASE_IMAGERY,
        parcel_id: "PCL-1008",
        remaining_backfill_weeks: 5,
      };
      render(<CaseImageryHistory caseId="CASE-9005" initialImagery={imagery} />);

      expect(screen.getByTestId("case-imagery-empty")).toHaveTextContent(
        /nothing shown below means nothing has been fetched/i
      );
      expect(
        screen.getByRole("button", {
          name: "Start imagery backfill to 2026-01-01 for PCL-1008 (5 weeks)",
        })
      ).toBeInTheDocument();
      expect(screen.queryByTestId("snapshot-week")).not.toBeInTheDocument();
    });
  });

  describe("a partially backfilled RED case", () => {
    const imagery: CaseImagery = {
      ...BASE_IMAGERY,
      parcel_id: "PCL-1001",
      started_on: "2026-03-09", // Monday of 2026-W11
      captures: [
        capturedWeek("2026-W11", 9.0),
        {
          week: "2026-W12",
          status: "no_usable_scene",
          attempted_at: "2026-08-01T09:00:00Z",
          scene_id: null,
          sha256: null,
          cloud_pct: 70.0,
          reason:
            "Cloud cover 70.0% exceeds the 40.0% usability threshold for this week's pass.",
          image_url: null,
        },
        {
          week: "2026-W13",
          status: "no_usable_scene",
          attempted_at: "2026-08-01T09:00:00Z",
          scene_id: null,
          sha256: null,
          cloud_pct: null,
          reason:
            "No Sentinel-2 scene intersects this parcel's footprint within the 2026-03-23–2026-03-29 catalog window.",
          image_url: null,
        },
      ],
      due_weeks: [],
      remaining_backfill_weeks: 10,
    };
    const TODAY = new Date("2026-03-23T12:00:00Z"); // Monday of 2026-W13

    it("says honestly that the visible history does not yet reach the floor, without implying nothing existed earlier", () => {
      render(
        <CaseImageryHistory
          caseId="CASE-9001"
          initialImagery={imagery}
          today={TODAY}
        />
      );

      const note = screen.getByTestId("case-imagery-coverage-note");
      expect(note).toHaveTextContent("2026-03-09");
      expect(note).toHaveTextContent("2026-01-01");
      expect(note).toHaveTextContent(/10.*weeks still need to be backfilled/);
      expect(note).toHaveTextContent(/not evidence that nothing happened/i);
    });

    it("renders each gap week as an explicit, explained row rather than blank space", () => {
      render(
        <CaseImageryHistory
          caseId="CASE-9001"
          initialImagery={imagery}
          today={TODAY}
        />
      );

      const rows = screen.getAllByTestId("snapshot-week");
      expect(rows).toHaveLength(3);

      const cloudGap = rows.find((r) => r.getAttribute("data-week") === "2026-W12")!;
      expect(cloudGap).toHaveAttribute("data-status", "no_usable_scene");
      expect(cloudGap).toHaveTextContent(/cloud cover 70\.0%/i);

      const coverageGap = rows.find(
        (r) => r.getAttribute("data-week") === "2026-W13"
      )!;
      expect(coverageGap).toHaveAttribute("data-status", "no_usable_scene");
      expect(coverageGap).toHaveTextContent(/no sentinel-2 scene intersects/i);
    });

    it("offers a Continue backfill control naming the remaining count", () => {
      render(
        <CaseImageryHistory
          caseId="CASE-9001"
          initialImagery={imagery}
          today={TODAY}
        />
      );

      expect(
        screen.getByRole("button", {
          name: "Continue imagery backfill for PCL-1001 (10 weeks remaining)",
        })
      ).toBeInTheDocument();
    });
  });

  describe("a fully backfilled RED case", () => {
    it("confirms coverage reaches the floor and offers no further control", () => {
      const imagery: CaseImagery = {
        ...BASE_IMAGERY,
        parcel_id: "PCL-1001",
        started_on: "2025-12-29", // Monday of 2026-W01
        captures: [capturedWeek("2026-W01", 12.0)],
        due_weeks: [],
        remaining_backfill_weeks: 0,
      };
      render(
        <CaseImageryHistory
          caseId="CASE-9001"
          initialImagery={imagery}
          today={new Date("2025-12-29T12:00:00Z")}
        />
      );

      expect(screen.getByTestId("case-imagery-complete-note")).toHaveTextContent(
        "fully backfilled"
      );
      expect(screen.queryByRole("button")).not.toBeInTheDocument();
    });
  });

  describe("the chunked backfill loop", () => {
    function tenWeekImagery(caseId: string): CaseImagery {
      return {
        ...BASE_IMAGERY,
        case_id: caseId,
        parcel_id: "PCL-1001",
        remaining_backfill_weeks: 10,
      };
    }

    const FIRST_CHUNK = [
      "2026-W01",
      "2026-W02",
      "2026-W03",
      "2026-W04",
      "2026-W05",
      "2026-W06",
    ].map((week) => capturedWeek(week, 15.0));
    const SECOND_CHUNK = ["2026-W07", "2026-W08", "2026-W09", "2026-W10"].map(
      (week) => capturedWeek(week, 20.0)
    );

    it("keeps calling with the default (idempotent) chunk until remaining_backfill_weeks reaches 0, merging captures and announcing completion", async () => {
      vi.mocked(backfillCaseImagery)
        .mockResolvedValueOnce({
          ok: true,
          status: 201,
          attempted: FIRST_CHUNK,
          started_on: "2025-12-29",
          remaining_backfill_weeks: 4,
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 201,
          attempted: SECOND_CHUNK,
          started_on: "2025-12-29",
          remaining_backfill_weeks: 0,
        });

      render(
        <CaseImageryHistory
          caseId="CASE-LOOP"
          initialImagery={tenWeekImagery("CASE-LOOP")}
          today={new Date("2026-03-02T12:00:00Z")} // Monday of 2026-W10
        />
      );

      fireEvent.click(
        screen.getByRole("button", { name: /start imagery backfill/i })
      );

      await waitFor(() => {
        expect(screen.getByTestId("case-imagery-notice")).toHaveTextContent(
          "Backfill complete — history now reaches the 2026-01-01 floor."
        );
      });

      expect(backfillCaseImagery).toHaveBeenCalledTimes(2);
      expect(backfillCaseImagery).toHaveBeenNthCalledWith(1, "CASE-LOOP", {});
      expect(backfillCaseImagery).toHaveBeenNthCalledWith(2, "CASE-LOOP", {});

      // All ten backfilled weeks are now visible, none blank.
      const rows = screen.getAllByTestId("snapshot-week");
      expect(rows).toHaveLength(10);
      expect(rows.every((r) => r.getAttribute("data-status") === "captured")).toBe(
        true
      );
      // The control disappears once nothing remains.
      expect(screen.queryByRole("button")).not.toBeInTheDocument();
    });

    it("shows progress, announced through a status region, while the loop is running", async () => {
      const first = deferred<BackfillCaseImageryResult>();
      vi.mocked(backfillCaseImagery)
        .mockReturnValueOnce(first.promise)
        .mockResolvedValueOnce({
          ok: true,
          status: 201,
          attempted: SECOND_CHUNK,
          started_on: "2025-12-29",
          remaining_backfill_weeks: 0,
        });

      render(
        <CaseImageryHistory
          caseId="CASE-PROGRESS"
          initialImagery={tenWeekImagery("CASE-PROGRESS")}
          today={new Date("2026-03-02T12:00:00Z")}
        />
      );

      fireEvent.click(
        screen.getByRole("button", { name: /start imagery backfill/i })
      );

      await waitFor(() => {
        expect(screen.getByRole("status")).toHaveTextContent(
          "Fetching week 1 of 10…"
        );
      });

      first.resolve({
        ok: true,
        status: 201,
        attempted: FIRST_CHUNK,
        started_on: "2025-12-29",
        remaining_backfill_weeks: 4,
      });

      await waitFor(() => {
        expect(screen.getByTestId("case-imagery-notice")).toBeInTheDocument();
      });
      // Progress region is gone once the loop has finished (not submitting).
      expect(screen.queryByTestId("case-imagery-progress")).not.toBeInTheDocument();
    });

    it("stops on a mid-loop failure, keeps the progress already made, and surfaces the refusal like TagEditor does", async () => {
      vi.mocked(backfillCaseImagery)
        .mockResolvedValueOnce({
          ok: true,
          status: 201,
          attempted: FIRST_CHUNK,
          started_on: "2025-12-29",
          remaining_backfill_weeks: 4,
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 503,
          detail: "Copernicus Data Space token endpoint returned 503 Service Unavailable.",
        });

      render(
        <CaseImageryHistory
          caseId="CASE-MIDFAIL"
          initialImagery={tenWeekImagery("CASE-MIDFAIL")}
          today={new Date("2026-02-02T12:00:00Z")} // Monday of 2026-W06
        />
      );

      fireEvent.click(
        screen.getByRole("button", { name: /start imagery backfill/i })
      );

      await waitFor(() => {
        expect(screen.getByTestId("case-imagery-error")).toHaveTextContent(
          "Refused (HTTP 503): Copernicus Data Space token endpoint returned 503 Service Unavailable."
        );
      });

      expect(backfillCaseImagery).toHaveBeenCalledTimes(2);
      // The first chunk's six weeks were kept, not discarded by the failure.
      const rows = screen.getAllByTestId("snapshot-week");
      expect(rows).toHaveLength(6);
      expect(rows.every((r) => r.getAttribute("data-status") === "captured")).toBe(
        true
      );
      // The control reflects the reduced remaining count and is re-enabled
      // so the officer can retry.
      const retryButton = screen.getByRole("button", {
        name: "Continue imagery backfill for PCL-1001 (4 weeks remaining)",
      });
      expect(retryButton).not.toBeDisabled();
    });

    it("catches a thrown fetch rejection mid-loop, resets the spinner, and keeps progress already made", async () => {
      vi.mocked(backfillCaseImagery)
        .mockResolvedValueOnce({
          ok: true,
          status: 201,
          attempted: FIRST_CHUNK,
          started_on: "2025-12-29",
          remaining_backfill_weeks: 4,
        })
        .mockRejectedValueOnce(new TypeError("Failed to fetch"));

      render(
        <CaseImageryHistory
          caseId="CASE-NETFAIL"
          initialImagery={tenWeekImagery("CASE-NETFAIL")}
          today={new Date("2026-02-02T12:00:00Z")}
        />
      );

      const button = screen.getByRole("button", {
        name: /start imagery backfill/i,
      });
      fireEvent.click(button);

      await waitFor(() => {
        expect(screen.getByTestId("case-imagery-error")).toHaveTextContent(
          "Backfill service could not be reached. Weeks already fetched were kept — try again to continue."
        );
      });

      const retryButton = screen.getByRole("button", {
        name: "Continue imagery backfill for PCL-1001 (4 weeks remaining)",
      });
      expect(retryButton).not.toBeDisabled();
      expect(screen.getAllByTestId("snapshot-week")).toHaveLength(6);
    });
  });
});
