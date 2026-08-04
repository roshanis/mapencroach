import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { WatchlistEntryCard } from "./WatchlistEntryCard";
import { runCaptures } from "@/lib/api";
import type { WatchEntry } from "@/lib/types";

vi.mock("@/lib/api", () => ({
  runCaptures: vi.fn(),
}));

const ENTRY: WatchEntry = {
  alert_id: "ALT-5001",
  parcel_id: "PCL-1001",
  started_on: "2026-06-01",
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
      image_url: null,
    },
  ],
  due_weeks: ["2026-W24"],
};

describe("WatchlistEntryCard", () => {
  it("shows the alert identity, the honest 'manual action' label, and the due count", () => {
    render(<WatchlistEntryCard initialEntry={ENTRY} />);

    expect(screen.getByText("PCL-1001")).toBeInTheDocument();
    expect(
      screen.getByText(/Alert ALT-5001 · watched by Enforcement Officer, Haridwar · weekly since 2026-06-01/)
    ).toBeInTheDocument();
    expect(
      screen.getByText("Manual action — there is no automatic scheduler yet.")
    ).toBeInTheDocument();

    const button = screen.getByRole("button", {
      name: "Run due captures now for PCL-1001 (1 due)",
    });
    expect(button).not.toBeDisabled();
    expect(button).toHaveTextContent("Run due captures now (1)");
  });

  it("disables the run-captures control when nothing is due", () => {
    render(
      <WatchlistEntryCard initialEntry={{ ...ENTRY, due_weeks: [] }} />
    );

    expect(
      screen.getByRole("button", {
        name: "Run due captures now for PCL-1001 (0 due)",
      })
    ).toBeDisabled();
  });

  it("runs due captures, merges the new attempt into the timeline, and clears the due week", async () => {
    vi.mocked(runCaptures).mockResolvedValue({
      ok: true,
      status: 201,
      attempts: [
        {
          week: "2026-W24",
          status: "captured",
          attempted_at: "2026-06-08T06:15:00Z",
          scene_id: "S2A_SCENE_002",
          sha256: "6f8194b1d3adfcb6f8d2542e43d5b5f019e14b142903d90a89da0a192d7e567",
          cloud_pct: 22.0,
          reason: null,
          image_url: null,
        },
      ],
    });

    render(<WatchlistEntryCard initialEntry={ENTRY} />);

    fireEvent.click(
      screen.getByRole("button", {
        name: "Run due captures now for PCL-1001 (1 due)",
      })
    );

    await waitFor(() => {
      expect(screen.getByTestId("run-captures-notice")).toHaveTextContent(
        "Ran 1 due week."
      );
    });
    expect(runCaptures).toHaveBeenCalledWith("ALT-5001");
    // The due count dropped to zero and the control is now disabled.
    expect(
      screen.getByRole("button", {
        name: "Run due captures now for PCL-1001 (0 due)",
      })
    ).toBeDisabled();
    // The newly captured week is now visible in the timeline.
    const week24Row = screen
      .getAllByTestId("snapshot-week")
      .find((row) => row.getAttribute("data-week") === "2026-W24")!;
    expect(week24Row).toHaveAttribute("data-status", "captured");
  });

  it("reports when a run finds nothing due", async () => {
    vi.mocked(runCaptures).mockResolvedValue({ ok: true, status: 201, attempts: [] });

    render(<WatchlistEntryCard initialEntry={ENTRY} />);

    fireEvent.click(
      screen.getByRole("button", {
        name: "Run due captures now for PCL-1001 (1 due)",
      })
    );

    await waitFor(() => {
      expect(screen.getByTestId("run-captures-notice")).toHaveTextContent(
        "No weeks were due — nothing to capture."
      );
    });
  });

  it("shows the refusal detail on failure without touching the timeline", async () => {
    vi.mocked(runCaptures).mockResolvedValue({
      ok: false,
      status: 403,
      detail: "viewer role cannot run captures",
    });

    render(<WatchlistEntryCard initialEntry={ENTRY} />);

    fireEvent.click(
      screen.getByRole("button", {
        name: "Run due captures now for PCL-1001 (1 due)",
      })
    );

    await waitFor(() => {
      expect(screen.getByTestId("run-captures-error")).toHaveTextContent(
        "Refused (HTTP 403): viewer role cannot run captures"
      );
    });
    expect(
      screen.getByRole("button", {
        name: "Run due captures now for PCL-1001 (1 due)",
      })
    ).toBeInTheDocument();
  });

  it("catches a thrown fetch rejection, resets the spinner, and surfaces an error", async () => {
    vi.mocked(runCaptures).mockRejectedValue(new TypeError("Failed to fetch"));

    render(<WatchlistEntryCard initialEntry={ENTRY} />);

    const button = screen.getByRole("button", {
      name: "Run due captures now for PCL-1001 (1 due)",
    });
    fireEvent.click(button);

    await waitFor(() => {
      expect(screen.getByTestId("run-captures-error")).toHaveTextContent(
        "Capture service could not be reached. No captures were run — try again."
      );
    });
    expect(button).not.toBeDisabled();
  });
});
