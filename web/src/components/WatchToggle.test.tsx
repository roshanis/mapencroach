import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { WatchToggle } from "./WatchToggle";
import { getWatchEntry, unwatchAlert, watchAlert } from "@/lib/api";
import { FIXTURE_ALERTS } from "@/lib/fixtures";
import type { WatchEntry } from "@/lib/types";

vi.mock("@/lib/api", () => ({
  getWatchEntry: vi.fn(),
  watchAlert: vi.fn(),
  unwatchAlert: vi.fn(),
}));

const RED_ALERT = FIXTURE_ALERTS.find((a) => a.tier === "red")!;
const AMBER_ALERT = FIXTURE_ALERTS.find((a) => a.tier === "amber")!;

const WATCH_ENTRY: WatchEntry = {
  alert_id: RED_ALERT.id,
  parcel_id: RED_ALERT.parcel_id,
  started_on: "2026-06-01",
  cadence: "weekly",
  watched_by: "Enforcement Officer, Haridwar",
  captures: [],
  due_weeks: ["2026-W23"],
};

describe("WatchToggle", () => {
  describe("RED-only rule", () => {
    it("does not offer watching for a non-RED alert, and never calls the watch API", async () => {
      render(<WatchToggle alert={AMBER_ALERT} />);

      expect(screen.getByTestId("watch-toggle-ineligible")).toHaveTextContent(
        "Only RED-tier alerts can be watched"
      );
      expect(
        screen.queryByRole("button", { name: /watch/i })
      ).not.toBeInTheDocument();
      expect(getWatchEntry).not.toHaveBeenCalled();
    });
  });

  describe("loading a RED alert's watch status", () => {
    it("shows a loading state, then the watch button once resolved", async () => {
      vi.mocked(getWatchEntry).mockResolvedValue(undefined);

      render(<WatchToggle alert={RED_ALERT} />);

      expect(screen.getByTestId("watch-toggle-loading")).toBeInTheDocument();

      await waitFor(() => {
        expect(screen.getByTestId("watch-toggle")).toBeInTheDocument();
      });
      expect(getWatchEntry).toHaveBeenCalledWith(RED_ALERT.id);
      const button = screen.getByRole("button", {
        name: `Watch alert ${RED_ALERT.id}`,
      });
      expect(button).toHaveAttribute("aria-pressed", "false");
    });

    it("shows the stop-watching state when already watched", async () => {
      vi.mocked(getWatchEntry).mockResolvedValue(WATCH_ENTRY);

      render(<WatchToggle alert={RED_ALERT} />);

      const button = await screen.findByRole("button", {
        name: `Stop watching alert ${RED_ALERT.id}`,
      });
      expect(button).toHaveAttribute("aria-pressed", "true");
      expect(
        screen.getByText("Watching weekly since 2026-06-01.")
      ).toBeInTheDocument();
    });

    it("surfaces a load error instead of silently treating the alert as unwatched", async () => {
      vi.mocked(getWatchEntry).mockRejectedValue(new Error("network down"));

      render(<WatchToggle alert={RED_ALERT} />);

      await waitFor(() => {
        expect(screen.getByTestId("watch-toggle-load-error")).toBeInTheDocument();
      });
      expect(screen.queryByRole("button")).not.toBeInTheDocument();
    });
  });

  describe("starting a watch", () => {
    it("calls watchAlert and flips to the watching state on success", async () => {
      vi.mocked(getWatchEntry).mockResolvedValue(undefined);
      vi.mocked(watchAlert).mockResolvedValue({
        ok: true,
        status: 201,
        entry: WATCH_ENTRY,
      });

      render(<WatchToggle alert={RED_ALERT} />);

      const startButton = await screen.findByRole("button", {
        name: `Watch alert ${RED_ALERT.id}`,
      });
      fireEvent.click(startButton);

      await waitFor(() => {
        expect(
          screen.getByRole("button", { name: `Stop watching alert ${RED_ALERT.id}` })
        ).toBeInTheDocument();
      });
      expect(watchAlert).toHaveBeenCalledWith(RED_ALERT.id);
    });

    it("shows the refusal detail on a 422 (non-RED at the backend) without flipping state", async () => {
      vi.mocked(getWatchEntry).mockResolvedValue(undefined);
      vi.mocked(watchAlert).mockResolvedValue({
        ok: false,
        status: 422,
        detail: "alert tier must be RED",
      });

      render(<WatchToggle alert={RED_ALERT} />);

      const startButton = await screen.findByRole("button", {
        name: `Watch alert ${RED_ALERT.id}`,
      });
      fireEvent.click(startButton);

      await waitFor(() => {
        expect(screen.getByTestId("watch-toggle-error")).toHaveTextContent(
          "Refused (HTTP 422): alert tier must be RED"
        );
      });
      // Still offering to start — the mutation was refused, not applied.
      expect(
        screen.getByRole("button", { name: `Watch alert ${RED_ALERT.id}` })
      ).toBeInTheDocument();
    });

    it("catches a thrown fetch rejection, resets the spinner, and surfaces an error", async () => {
      vi.mocked(getWatchEntry).mockResolvedValue(undefined);
      vi.mocked(watchAlert).mockRejectedValue(new TypeError("Failed to fetch"));

      render(<WatchToggle alert={RED_ALERT} />);

      const startButton = await screen.findByRole("button", {
        name: `Watch alert ${RED_ALERT.id}`,
      });
      fireEvent.click(startButton);

      await waitFor(() => {
        expect(screen.getByTestId("watch-toggle-error")).toHaveTextContent(
          "Watch service could not be reached. The alert was not added to the watchlist — try again."
        );
      });
      expect(
        screen.getByRole("button", { name: `Watch alert ${RED_ALERT.id}` })
      ).not.toBeDisabled();
    });
  });

  describe("stopping a watch", () => {
    it("calls unwatchAlert and flips back to the start-watching state on success", async () => {
      vi.mocked(getWatchEntry).mockResolvedValue(WATCH_ENTRY);
      vi.mocked(unwatchAlert).mockResolvedValue({ ok: true, status: 204 });

      render(<WatchToggle alert={RED_ALERT} />);

      const stopButton = await screen.findByRole("button", {
        name: `Stop watching alert ${RED_ALERT.id}`,
      });
      fireEvent.click(stopButton);

      await waitFor(() => {
        expect(
          screen.getByRole("button", { name: `Watch alert ${RED_ALERT.id}` })
        ).toBeInTheDocument();
      });
      expect(unwatchAlert).toHaveBeenCalledWith(RED_ALERT.id);
    });

    it("shows an error and keeps the watching state on a failed unwatch", async () => {
      vi.mocked(getWatchEntry).mockResolvedValue(WATCH_ENTRY);
      vi.mocked(unwatchAlert).mockResolvedValue({
        ok: false,
        status: 404,
        detail: "not watched",
      });

      render(<WatchToggle alert={RED_ALERT} />);

      const stopButton = await screen.findByRole("button", {
        name: `Stop watching alert ${RED_ALERT.id}`,
      });
      fireEvent.click(stopButton);

      await waitFor(() => {
        expect(screen.getByTestId("watch-toggle-error")).toHaveTextContent(
          "Refused (HTTP 404): not watched"
        );
      });
      expect(
        screen.getByRole("button", { name: `Stop watching alert ${RED_ALERT.id}` })
      ).toBeInTheDocument();
    });

    it("catches a thrown fetch rejection on stop, resets the spinner, and surfaces an error", async () => {
      vi.mocked(getWatchEntry).mockResolvedValue(WATCH_ENTRY);
      vi.mocked(unwatchAlert).mockRejectedValue(new TypeError("Failed to fetch"));

      render(<WatchToggle alert={RED_ALERT} />);

      const stopButton = await screen.findByRole("button", {
        name: `Stop watching alert ${RED_ALERT.id}`,
      });
      fireEvent.click(stopButton);

      await waitFor(() => {
        expect(screen.getByTestId("watch-toggle-error")).toHaveTextContent(
          "Watch service could not be reached. The alert is still on the watchlist — try again."
        );
      });
      expect(
        screen.getByRole("button", { name: `Stop watching alert ${RED_ALERT.id}` })
      ).not.toBeDisabled();
    });
  });
});
