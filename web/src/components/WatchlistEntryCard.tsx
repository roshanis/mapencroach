"use client";

import { useState } from "react";
import Link from "next/link";
import { runCaptures } from "@/lib/api";
import { WeeklySnapshotTimeline } from "./WeeklySnapshotTimeline";
import type { WatchEntry } from "@/lib/types";

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

  const dueCount = entry.due_weeks.length;

  async function handleRunCaptures() {
    setSubmitting(true);
    setError(null);
    setNotice(null);
    try {
      const result = await runCaptures(entry.alert_id);
      if (result.ok) {
        const attempts = result.attempts ?? [];
        setEntry((current) => ({
          ...current,
          captures: [...current.captures, ...attempts].sort((a, b) =>
            a.week.localeCompare(b.week)
          ),
          due_weeks: current.due_weeks.filter(
            (week) => !attempts.some((attempt) => attempt.week === week)
          ),
        }));
        setNotice(
          attempts.length === 0
            ? "No weeks were due — nothing to capture."
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
            disabled={submitting || dueCount === 0}
            className="inline-flex min-h-11 items-center justify-center rounded-md bg-gov px-3 py-2 text-sm font-semibold text-white hover:bg-gov-dark disabled:opacity-50"
          >
            {submitting ? "Running…" : `Run due captures now (${dueCount})`}
          </button>
          <p className="text-xs text-slate-400">
            Manual action — there is no automatic scheduler yet.
          </p>
        </div>
      </div>

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
