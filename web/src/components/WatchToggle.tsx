"use client";

import { useEffect, useState } from "react";
import { getWatchEntry, unwatchAlert, watchAlert } from "@/lib/api";
import type { Alert, WatchEntry } from "@/lib/types";

export interface WatchToggleProps {
  alert: Alert;
}

type LoadState = "loading" | "ready" | "error";

/**
 * Lets an officer start or stop watching a RED-tier alert for the weekly
 * snapshot feature. Only RED alerts are watchable server-side (the backend
 * returns 422 otherwise) — this control reflects that rule itself, rather
 * than letting an officer click a button that is guaranteed to fail.
 *
 * Placed on SelectedAlertCard (the single-alert action panel shown when an
 * alert is selected on the map) rather than as a column in AlertsTable:
 * this is a per-alert mutation with its own loading/submitting/error state
 * — the same shape as TagEditor's per-parcel tag mutations — and
 * SelectedAlertCard is already the place that panel pattern lives (it has
 * one other action, "Open parcel record"). AlertsTable is a dense,
 * filterable list; giving every row its own fetch-on-mount + mutation
 * state would either require lifting all of that into the table (coupling
 * the list to watch status for every alert, not just the one being acted
 * on) or a lot of new per-row plumbing for no benefit, since only one
 * alert is ever being acted on at a time.
 */
export function WatchToggle({ alert }: WatchToggleProps) {
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [entry, setEntry] = useState<WatchEntry | undefined>(undefined);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const watchable = alert.tier === "red";

  useEffect(() => {
    if (!watchable) {
      setLoadState("ready");
      setEntry(undefined);
      return;
    }
    let cancelled = false;
    setLoadState("loading");
    setError(null);
    getWatchEntry(alert.id)
      .then((result) => {
        if (cancelled) return;
        setEntry(result);
        setLoadState("ready");
      })
      .catch(() => {
        if (cancelled) return;
        setLoadState("error");
      });
    return () => {
      cancelled = true;
    };
  }, [alert.id, watchable]);

  async function handleStart() {
    setSubmitting(true);
    setError(null);
    try {
      const result = await watchAlert(alert.id);
      if (result.ok && result.entry) {
        setEntry(result.entry);
      } else {
        setError(`Refused (HTTP ${result.status}): ${result.detail}`);
      }
    } catch {
      setError(
        "Watch service could not be reached. The alert was not added to the watchlist — try again."
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function handleStop() {
    setSubmitting(true);
    setError(null);
    try {
      const result = await unwatchAlert(alert.id);
      if (result.ok) {
        setEntry(undefined);
      } else {
        setError(`Refused (HTTP ${result.status}): ${result.detail}`);
      }
    } catch {
      setError(
        "Watch service could not be reached. The alert is still on the watchlist — try again."
      );
    } finally {
      setSubmitting(false);
    }
  }

  if (!watchable) {
    return (
      <p data-testid="watch-toggle-ineligible" className="text-xs text-slate-500">
        Only RED-tier alerts can be watched for weekly snapshots.
      </p>
    );
  }

  if (loadState === "loading") {
    return (
      <p data-testid="watch-toggle-loading" className="text-xs text-slate-500">
        Checking watch status…
      </p>
    );
  }

  if (loadState === "error") {
    return (
      <p data-testid="watch-toggle-load-error" className="text-xs text-red-600">
        Watch status could not be loaded. Reload to try again.
      </p>
    );
  }

  const watching = entry !== undefined;

  return (
    <div data-testid="watch-toggle" className="flex flex-col gap-1.5">
      <button
        type="button"
        data-testid="watch-toggle-button"
        aria-label={
          watching ? `Stop watching alert ${alert.id}` : `Watch alert ${alert.id}`
        }
        aria-pressed={watching}
        onClick={watching ? handleStop : handleStart}
        disabled={submitting}
        className={`inline-flex min-h-11 items-center justify-center rounded-md px-3 py-2 text-sm font-semibold disabled:opacity-50 ${
          watching
            ? "border border-gray-300 text-gray-700 hover:bg-gray-50"
            : "bg-gov text-white hover:bg-gov-dark"
        }`}
      >
        {submitting ? "Saving…" : watching ? "Stop watching" : "Watch this alert"}
      </button>
      {watching && entry && (
        <p className="text-xs text-slate-500">
          Watching weekly since {entry.started_on}.
        </p>
      )}
      {error && (
        <p data-testid="watch-toggle-error" className="text-xs text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}
