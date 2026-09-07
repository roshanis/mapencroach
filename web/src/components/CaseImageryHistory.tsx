"use client";

import { useState } from "react";
import { backfillCaseImagery, runCaptures } from "@/lib/api";
import { WeeklySnapshotTimeline } from "./WeeklySnapshotTimeline";
import type { CaptureAttempt, CaseImagery } from "@/lib/types";
import { useDemoReadOnly } from "./DemoModeBanner";

export interface CaseImageryHistoryProps {
  caseId: string;
  initialImagery: CaseImagery;
  /** Forwarded to the nested WeeklySnapshotTimeline; defaults to the real
   * current time. Overridable so tests (and any caller) can pin "now". */
  today?: Date;
}

/** Safety cap on the backfill loop's iteration count. The contract's
 * intended client loop is "repeat until remaining_backfill_weeks is 0", but
 * that is only safe against a backend that reliably makes progress — this
 * cap stops the loop from spinning forever against a misbehaving response
 * (e.g. remaining never reaching 0) instead of hanging the tab. */
const MAX_BACKFILL_ITERATIONS = 100;

function weekWord(count: number): string {
  return count === 1 ? "week" : "weeks";
}

/** Merges newly attempted weeks into the existing capture list by week key
 * (idempotent per week per the contract, but merge defensively rather than
 * assuming no overlap) and keeps the result ascending, matching how
 * WatchlistEntryCard merges runCaptures results into its timeline. */
function mergeCaptures(
  current: CaptureAttempt[],
  attempted: CaptureAttempt[]
): CaptureAttempt[] {
  const byWeek = new Map(current.map((capture) => [capture.week, capture]));
  for (const attempt of attempted) {
    byWeek.set(attempt.week, attempt);
  }
  return [...byWeek.values()].sort((a, b) => a.week.localeCompare(b.week));
}

/**
 * A red-flagged case's weekly imagery history, reaching back toward the
 * backfill floor (Jan 2026) so an officer can see when a change first
 * appeared rather than only that it exists now.
 *
 * Reuses WeeklySnapshotTimeline for the actual week-by-week rendering
 * (captured / no_usable_scene / provider_error / due / gap) rather than
 * duplicating that logic — CaseImagery is a case-scoped view of the same
 * one-timeline-per-alert record the weekly-snapshot slice already renders,
 * so the same explicit, no-blank-weeks rendering applies unchanged. This
 * component adds only what is specific to backfill: the chunked "continue
 * backfill" loop, its progress/failure handling, and being explicit about
 * how far back the visible history actually reaches.
 */
export function CaseImageryHistory({
  caseId,
  initialImagery,
  today,
}: CaseImageryHistoryProps) {
  const [imagery, setImagery] = useState(initialImagery);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(
    null
  );
  const demoReadOnly = useDemoReadOnly();

  const hasTimeline = imagery.started_on !== null;
  const remaining = imagery.remaining_backfill_weeks;
  const retryableCount = imagery.retryable_weeks?.length ?? 0;

  async function handleRetryErrors() {
    setSubmitting(true);
    setError(null);
    setNotice(null);
    try {
      const result = await runCaptures(imagery.alert_id, undefined, {
        retryErrors: true,
      });
      if (!result.ok) {
        setError(`Refused (HTTP ${result.status}): ${result.detail}`);
        return;
      }
      const attempts = result.attempts ?? [];
      setImagery((current) => ({
        ...current,
        captures: mergeCaptures(current.captures, attempts),
        retryable_weeks: mergeCaptures(current.captures, attempts)
          .filter(attempt => attempt.status === "provider_error").map(attempt => attempt.week),
      }));
      setNotice(
        attempts.length === 0
          ? "No failed imagery weeks were ready to retry."
          : `Retried ${attempts.length} failed imagery week${attempts.length === 1 ? "" : "s"}.`
      );
    } catch {
      setError("Imagery retry service could not be reached. No retries were run — try again.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleBackfill() {
    setSubmitting(true);
    setError(null);
    setNotice(null);
    const total = remaining;
    let done = 0;
    let stillRemaining = total;
    let iterations = 0;
    setProgress({ done, total });
    try {
      while (stillRemaining > 0 && iterations < MAX_BACKFILL_ITERATIONS) {
        iterations += 1;
        const result = await backfillCaseImagery(caseId, {});
        if (!result.ok) {
          setError(`Refused (HTTP ${result.status}): ${result.detail}`);
          // Whatever earlier chunks already merged into `imagery` state
          // stays — only this chunk's attempt is lost, not prior progress.
          return;
        }
        const attempted = result.attempted ?? [];
        stillRemaining = result.remaining_backfill_weeks ?? 0;
        done += attempted.length;
        setImagery((current) => ({
          ...current,
          started_on: result.started_on ?? current.started_on,
          captures: mergeCaptures(current.captures, attempted),
          remaining_backfill_weeks: stillRemaining,
          monitoring_active: result.monitoring_active ?? current.monitoring_active,
          retryable_weeks: result.retryable_weeks ?? mergeCaptures(current.captures, attempted)
            .filter(attempt => attempt.status === "provider_error").map(attempt => attempt.week),
        }));
        setProgress({ done, total });
        // A chunk that captured nothing but still reports weeks remaining
        // would otherwise spin forever — stop and let the officer retry.
        if (attempted.length === 0 && stillRemaining > 0) {
          setError(
            "Backfill made no progress on the last attempt — stopping before the floor was reached. Try again."
          );
          return;
        }
      }
      if (stillRemaining === 0) {
        setNotice(
          `Backfill complete — history now reaches the ${imagery.backfill_floor} floor.`
        );
      } else {
        setError(
          "Backfill stopped after many attempts without finishing — try again."
        );
      }
    } catch {
      setError(
        "Backfill service could not be reached. Weeks already fetched were kept — try again to continue."
      );
    } finally {
      setSubmitting(false);
    }
  }

  if (!imagery.watchable) {
    return (
      <div data-testid="case-imagery-history" className="flex flex-col gap-3">
        <p data-testid="case-imagery-not-watchable" className="text-xs text-slate-500">
          Imagery backfill is only offered for red-flagged cases. This
          case&apos;s originating alert is {imagery.alert_tier.toLowerCase()}{" "}
          tier, so no backfill control is offered here.
        </p>
        {hasTimeline && imagery.started_on && (
          <WeeklySnapshotTimeline
            entry={{
              active: imagery.monitoring_active,
              parcel_id: imagery.parcel_id,
              started_on: imagery.started_on,
              captures: imagery.captures,
              due_weeks: imagery.due_weeks,
            }}
            today={today}
          />
        )}
      </div>
    );
  }

  return (
    <div data-testid="case-imagery-history" className="flex flex-col gap-3">
      {imagery.monitoring_active === false && hasTimeline && (
        <p role="note" className="rounded-md bg-slate-100 px-3 py-2 text-sm text-slate-700">
          Monitoring is inactive. Previous captures are preserved; uncaptured
          weeks are shown as missing without claiming when monitoring stopped.
        </p>
      )}
      {!hasTimeline && (
        <p data-testid="case-imagery-empty" className="text-sm text-gray-500">
          No imagery history exists yet for this case. Backfill has not been
          run — nothing shown below means nothing has been fetched, not that
          nothing happened.
        </p>
      )}

      {hasTimeline && remaining > 0 && (
        <p
          data-testid="case-imagery-coverage-note"
          className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs leading-5 text-amber-900"
        >
          This history currently starts {imagery.started_on} and does not yet
          reach the {imagery.backfill_floor} floor — {remaining}{" "}
          earlier {weekWord(remaining)} still need to be backfilled. That gap
          is unbackfilled, not evidence that nothing happened before{" "}
          {imagery.started_on}.
        </p>
      )}

      {hasTimeline && remaining === 0 && (
        <p
          data-testid="case-imagery-complete-note"
          className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-xs leading-5 text-emerald-900"
        >
          Capture attempts reach the {imagery.backfill_floor} floor.
          This does not mean every week has usable imagery; check each week’s result.
        </p>
      )}

      {remaining > 0 && (
        <div className="flex flex-col items-start gap-1">
          <button
            type="button"
            data-testid="case-imagery-backfill-button"
            aria-label={
              hasTimeline
                ? `Continue imagery backfill for ${imagery.parcel_id} (${remaining} ${weekWord(remaining)} remaining)`
                : `Start imagery backfill to ${imagery.backfill_floor} for ${imagery.parcel_id} (${remaining} ${weekWord(remaining)})`
            }
            onClick={() => void handleBackfill()}
            disabled={demoReadOnly || submitting}
            className="inline-flex items-center justify-center rounded-md bg-gov px-3 py-2 text-sm font-semibold text-white hover:bg-gov-dark disabled:opacity-50"
          >
            {submitting
              ? "Backfilling…"
              : hasTimeline
                ? `Continue backfill (${remaining} ${weekWord(remaining)} remaining)`
                : `Start backfill to ${imagery.backfill_floor}`}
          </button>
          <p className="text-xs text-slate-400">
            Manual action — backfill runs only when you trigger it here;
            there is no automatic scheduler.
          </p>
        </div>
      )}

      {retryableCount > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            data-testid="case-imagery-retry-button"
            aria-label={`Retry failed imagery captures for ${imagery.parcel_id} (${retryableCount})`}
            onClick={() => void handleRetryErrors()}
            disabled={demoReadOnly || submitting}
            className="inline-flex min-h-11 items-center justify-center rounded-md border border-red-300 px-3 py-2 text-sm font-semibold text-red-800 hover:bg-red-50 disabled:opacity-50"
          >
            {submitting ? "Retrying…" : `Retry failed imagery (${retryableCount})`}
          </button>
          <p className="text-xs text-slate-500">
            Retries provider errors only; existing outcomes stay recorded.
          </p>
        </div>
      )}

      {progress && submitting && (
        <p role="status" data-testid="case-imagery-progress" className="text-xs text-slate-600">
          Fetching week {Math.min(progress.done + 1, progress.total)} of{" "}
          {progress.total}…
        </p>
      )}

      {notice && (
        <p role="status" data-testid="case-imagery-notice" className="text-xs text-emerald-700">
          {notice}
        </p>
      )}
      {error && (
        <p role="alert" data-testid="case-imagery-error" className="text-xs text-red-600">
          {error}
        </p>
      )}

      {hasTimeline && imagery.started_on && (
        <WeeklySnapshotTimeline
          entry={{
            active: imagery.monitoring_active,
            parcel_id: imagery.parcel_id,
            started_on: imagery.started_on,
            captures: imagery.captures,
            due_weeks: imagery.due_weeks,
          }}
          today={today}
        />
      )}
    </div>
  );
}
