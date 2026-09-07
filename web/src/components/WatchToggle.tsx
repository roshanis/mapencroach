"use client";

import { useEffect, useRef, useState } from "react";
import { getWatchEntry, unwatchAlert, watchAlert } from "@/lib/api";
import type { Alert, WatchEntry } from "@/lib/types";
import { useDemoReadOnly } from "./DemoModeBanner";
import Link from "next/link";

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
  const [loadErrorStatus, setLoadErrorStatus] = useState<number | undefined>();
  const [loadRetry, setLoadRetry] = useState(0);
  const demoReadOnly = useDemoReadOnly();
  const currentAlertIdRef = useRef(alert.id);
  currentAlertIdRef.current = alert.id;

  const watchable = alert.tier === "red";

  useEffect(() => {
    if (!watchable) {
      setLoadState("ready");
      setEntry(undefined);
      return;
    }
    let cancelled = false;
    setLoadState("loading");
    setSubmitting(false);
    setEntry(undefined);
    setError(null);
    setLoadErrorStatus(undefined);
    getWatchEntry(alert.id)
      .then((result) => {
        if (cancelled) return;
        setEntry(result);
        setLoadState("ready");
      })
      .catch((reason: unknown) => {
        if (cancelled) return;
        setLoadErrorStatus(
          typeof reason === "object" && reason !== null && "status" in reason
            ? Number((reason as { status?: unknown }).status)
            : undefined
        );
        setLoadState("error");
      });
    return () => {
      cancelled = true;
    };
  }, [alert.id, watchable, loadRetry]);

  async function handleStart() {
    const requestedAlertId = alert.id;
    setSubmitting(true);
    setError(null);
    try {
      const result = await watchAlert(alert.id);
      if (currentAlertIdRef.current !== requestedAlertId) return;
      if (result.ok && result.entry) {
        setEntry(result.entry);
      } else {
        setError(`Refused (HTTP ${result.status}): ${result.detail}`);
      }
    } catch {
      if (currentAlertIdRef.current !== requestedAlertId) return;
      setError(
        "Watch service could not be reached. The alert was not added to the watchlist — try again."
      );
    } finally {
      if (currentAlertIdRef.current === requestedAlertId) setSubmitting(false);
    }
  }

  async function handleStop() {
    const requestedAlertId = alert.id;
    setSubmitting(true);
    setError(null);
    try {
      const result = await unwatchAlert(alert.id);
      if (currentAlertIdRef.current !== requestedAlertId) return;
      if (result.ok) {
        setEntry(undefined);
      } else {
        setError(`Refused (HTTP ${result.status}): ${result.detail}`);
      }
    } catch {
      if (currentAlertIdRef.current !== requestedAlertId) return;
      setError(
        "Watch service could not be reached. The alert is still on the watchlist — try again."
      );
    } finally {
      if (currentAlertIdRef.current === requestedAlertId) setSubmitting(false);
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
      <div data-testid="watch-toggle-load-error" className="flex flex-col items-start gap-2 text-xs text-red-600">
        <p>
          {loadErrorStatus === 401 || loadErrorStatus === 403
            ? "Your demo session may have expired. Choose a persona, then retry."
            : "Watch status could not be loaded. This does not mean the alert is unwatched."}
        </p>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setLoadRetry((value) => value + 1)}
            className="rounded border border-red-300 px-2 py-1 font-medium text-red-800 hover:bg-red-50"
          >
            Retry
          </button>
          {(loadErrorStatus === 401 || loadErrorStatus === 403) && (
            <Link href="/personas" className="font-medium text-gov underline">
              Choose a persona
            </Link>
          )}
        </div>
      </div>
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
        disabled={demoReadOnly || submitting}
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
