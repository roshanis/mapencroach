"use client";

import { useState } from "react";
import Link from "next/link";
import { runCaptures } from "@/lib/api";
import { WeeklySnapshotTimeline } from "./WeeklySnapshotTimeline";
import type { WatchEntry } from "@/lib/types";
import { useDemoReadOnly } from "./DemoModeBanner";

export interface WatchlistEntryCardProps {
  initialEntry: WatchEntry;
}

/**
 * One watched alert's card on the watchlist page: identity, a manual
 * "run due captures now" control, and its weekly snapshot timeline.
 *
 * There is no scheduler behind capture runs yet, so the control is labeled
 * as an explicit, officer-triggered action ("run due captures now") rather
 * than implying anything automatic happens on its own.
 */
export function WatchlistEntryCard({ initialEntry }: WatchlistEntryCardProps) {
  const [entry, setEntry] = useState(initialEntry);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const demoReadOnly = useDemoReadOnly();

  const dueCount = entry.due_weeks.length;
  const retryableCount = entry.retryable_weeks?.length ?? 0;

  async function handleRunCaptures(retryErrors = false) {
    setSubmitting(true);
    setError(null);
    setNotice(null);
    try {
      // The watch's own id, not its alert: parcel-originated watches have
      // no alert behind them.
      const watchId = entry.watch_id ?? entry.alert_id ?? "";
      const result = retryErrors
        ? await runCaptures(watchId, undefined, { retryErrors: true })
        : await runCaptures(watchId);
      if (result.ok) {
        const attempts = result.attempts ?? [];
        setEntry((current) => ({
          ...current,
          captures: [...new Map(
            [...current.captures, ...attempts].map((attempt) => [attempt.week, attempt])
          ).values()].sort((a, b) => a.week.localeCompare(b.week)),
          due_weeks: current.due_weeks.filter(
            (week) => !attempts.some((attempt) => attempt.week === week)
          ),
          retryable_weeks: [...new Map([...current.captures, ...attempts].map(attempt => [attempt.week, attempt])).values()]
            .filter(attempt => attempt.status === "provider_error").map(attempt => attempt.week),
        }));
        setNotice(
          attempts.length === 0
            ? "No weeks were due — nothing to capture."
            : retryErrors
              ? `Retried ${attempts.length} failed week${attempts.length === 1 ? "" : "s"}.`
              : `Ran ${attempts.length} due week${attempts.length === 1 ? "" : "s"}.`
        );
      } else {
        setError(`Refused (HTTP ${result.status}): ${result.detail}`);
      }
    } catch {
      setError(
        "Capture service could not be reached. No captures were run — try again."
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section
      data-testid="watchlist-entry"
      className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-gray-900">
            <Link
              href={`/parcels/${entry.parcel_id}`}
              className="text-gov hover:underline"
            >
              {entry.parcel_id}
            </Link>
          </h2>
          <p className="text-xs text-slate-500">
            Alert {entry.alert_id} · watched by {entry.watched_by} · weekly
            since {entry.started_on}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <button
            type="button"
            data-testid="run-captures-button"
            aria-label={`Run due captures now for ${entry.parcel_id} (${dueCount} due)`}
            onClick={() => void handleRunCaptures()}
            disabled={demoReadOnly || submitting || dueCount === 0}
            className="inline-flex min-h-11 items-center justify-center rounded-md bg-gov px-3 py-2 text-sm font-semibold text-white hover:bg-gov-dark disabled:opacity-50"
          >
            {submitting ? "Running…" : `Run due captures now (${dueCount})`}
          </button>
          <p className="text-xs text-slate-400">
            Manual action — there is no automatic scheduler yet.
          </p>
        </div>
      </div>

      {retryableCount > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button
            type="button"
            data-testid="retry-captures-button"
            aria-label={`Retry failed captures for ${entry.parcel_id} (${retryableCount})`}
            onClick={() => void handleRunCaptures(true)}
            disabled={demoReadOnly || submitting}
            className="inline-flex min-h-11 items-center justify-center rounded-md border border-red-300 px-3 py-2 text-sm font-semibold text-red-800 hover:bg-red-50 disabled:opacity-50"
          >
            {submitting ? "Retrying…" : `Retry failed captures (${retryableCount})`}
          </button>
          <p className="text-xs text-slate-500">
            Retries provider errors only; existing outcomes stay recorded.
          </p>
        </div>
      )}

      {notice && (
        <p data-testid="run-captures-notice" className="mt-2 text-xs text-emerald-700">
          {notice}
        </p>
      )}
      {error && (
        <p data-testid="run-captures-error" className="mt-2 text-xs text-red-600">
          {error}
        </p>
      )}

      <div className="mt-4">
        <WeeklySnapshotTimeline entry={entry} />
      </div>
    </section>
  );
}
