import type { CaptureAttempt, CaptureStatus, WatchEntry } from "@/lib/types";

export interface WeeklySnapshotTimelineProps {
  entry: WatchEntry;
  /** Defaults to the real current time; overridable so tests (and any
   * caller) can pin "now" instead of depending on the wall clock. */
  today?: Date;
}

/** A week's row status. The first three mirror CaptureStatus; "due" is a
 * week the backend has explicitly listed as not-yet-attempted (WatchEntry
 * .due_weeks); "gap" is a week that is in neither captures nor due_weeks —
 * it should not happen given the contract (weeks_from minus attempted
 * always accounts for every week through today), but if it ever does, the
 * gap must still render as an explicit, explained row rather than as
 * nothing. */
export type WeekRowStatus = CaptureStatus | "due" | "gap";

export interface WeekRow {
  key: string;
  weekStart: Date;
  status: WeekRowStatus;
  attempt?: CaptureAttempt;
}

function parseIsoDate(value: string): Date {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

/** Monday (UTC midnight) of the ISO week containing `date`. */
function mondayOfWeek(date: Date): Date {
  const truncated = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
  );
  const dayIndex = (truncated.getUTCDay() + 6) % 7; // Mon=0 .. Sun=6
  truncated.setUTCDate(truncated.getUTCDate() - dayIndex);
  return truncated;
}

/** ISO-8601 week key ("2026-W31") for a UTC date, per WeekRef.key. */
function isoWeekKey(date: Date): string {
  // Shift to the Thursday of this week — the ISO week-numbering year is
  // defined by whichever year owns that Thursday.
  const thursday = new Date(date.getTime());
  const dayIndex = (thursday.getUTCDay() + 6) % 7;
  thursday.setUTCDate(thursday.getUTCDate() - dayIndex + 3);

  const isoYear = thursday.getUTCFullYear();
  const firstThursday = new Date(Date.UTC(isoYear, 0, 4));
  const firstThursdayIndex = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstThursdayIndex + 3);

  const week =
    1 +
    Math.round(
      (thursday.getTime() - firstThursday.getTime()) / (7 * 86_400_000)
    );
  return `${isoYear}-W${String(week).padStart(2, "0")}`;
}

/**
 * Builds one row per ISO week from `entry.started_on` through `today`,
 * inclusive — mirroring the backend's weeks_from(started_on, today). Every
 * week in that range gets a row: captured/no_usable_scene/provider_error
 * from a matching capture attempt, "due" when the backend lists the week as
 * not yet attempted, or "gap" as an explicit fallback so no week is ever
 * silently dropped from the evidence record.
 */
export function computeWatchWeeks(
  entry: WatchEntry,
  today: Date = new Date()
): WeekRow[] {
  const attemptsByWeek = new Map(entry.captures.map((c) => [c.week, c]));
  const dueWeeks = new Set(entry.due_weeks);

  const start = mondayOfWeek(parseIsoDate(entry.started_on));
  const end = mondayOfWeek(today);

  const rows: WeekRow[] = [];
  for (
    let cursor = start;
    cursor.getTime() <= end.getTime();
    cursor = new Date(cursor.getTime() + 7 * 86_400_000)
  ) {
    const key = isoWeekKey(cursor);
    const attempt = attemptsByWeek.get(key);
    const status: WeekRowStatus = attempt
      ? attempt.status
      : dueWeeks.has(key)
        ? "due"
        : "gap";
    rows.push({ key, weekStart: cursor, status, attempt });
  }
  return rows;
}

const WEEK_DATE_FORMAT = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

function formatWeekStart(date: Date): string {
  return WEEK_DATE_FORMAT.format(date);
}

function formatCloudPct(cloudPct: number): string {
  return `${Math.round(cloudPct * 10) / 10}% cloud cover`;
}

function abbreviateHash(sha256: string): string {
  return sha256.length > 16 ? `${sha256.slice(0, 16)}…` : sha256;
}

const STATUS_LABELS: Record<WeekRowStatus, string> = {
  captured: "Captured",
  no_usable_scene: "No usable scene",
  provider_error: "Provider error",
  due: "Due — not yet attempted",
  gap: "Gap — no capture record",
};

const STATUS_CLASSES: Record<WeekRowStatus, string> = {
  captured: "bg-emerald-50 text-emerald-800 ring-emerald-600/30",
  no_usable_scene: "bg-amber-50 text-amber-800 ring-amber-600/30",
  provider_error: "bg-red-50 text-red-700 ring-red-600/30",
  due: "bg-gray-100 text-gray-600 ring-gray-400/30",
  gap: "bg-red-50 text-red-700 ring-red-600/30",
};

function WeekStatusBadge({ status }: { status: WeekRowStatus }) {
  return (
    <span
      data-testid="snapshot-week-status"
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${STATUS_CLASSES[status]}`}
    >
      {STATUS_LABELS[status]}
    </span>
  );
}

export function WeeklySnapshotTimeline({
  entry,
  today = new Date(),
}: WeeklySnapshotTimelineProps) {
  const rows = computeWatchWeeks(entry, today);

  return (
    <ol
      data-testid="weekly-snapshot-timeline"
      aria-label={`Weekly capture history for ${entry.parcel_id}, watched since ${entry.started_on}`}
      className="flex flex-col gap-2"
    >
      {rows.map((row) => (
        <li
          key={row.key}
          data-testid="snapshot-week"
          data-week={row.key}
          data-status={row.status}
          className="rounded-md border border-gray-200 bg-white px-3 py-2.5"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-gray-500">
                {row.key}
              </span>
              <time dateTime={row.weekStart.toISOString().slice(0, 10)} className="text-xs text-gray-400">
                Week of {formatWeekStart(row.weekStart)}
              </time>
            </div>
            <WeekStatusBadge status={row.status} />
          </div>

          {row.status === "captured" && row.attempt && (
            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-600">
              {row.attempt.cloud_pct != null && (
                <span>{formatCloudPct(row.attempt.cloud_pct)}</span>
              )}
              {row.attempt.sha256 && (
                <span
                  data-testid="snapshot-week-sha256"
                  title={row.attempt.sha256}
                  className="font-mono"
                >
                  sha256:{abbreviateHash(row.attempt.sha256)}
                </span>
              )}
            </div>
          )}

          {(row.status === "no_usable_scene" || row.status === "provider_error") &&
            row.attempt?.reason && (
              <p
                data-testid="snapshot-week-reason"
                className="mt-1.5 text-xs text-gray-600"
              >
                {row.attempt.reason}
                {row.attempt.cloud_pct != null &&
                  ` (${formatCloudPct(row.attempt.cloud_pct)})`}
              </p>
            )}

          {row.status === "due" && (
            <p className="mt-1.5 text-xs text-gray-500">
              This week is due but has not been attempted yet.
            </p>
          )}

          {row.status === "gap" && (
            <p className="mt-1.5 text-xs text-red-700">
              No capture attempt or due-week record exists for this week —
              this is an unexplained gap in the evidence record and should
              be investigated.
            </p>
          )}
        </li>
      ))}
      {rows.length === 0 && (
        <li className="rounded-md border border-gray-200 bg-white px-3 py-6 text-center text-sm text-gray-400">
          No weeks have elapsed since the watch started.
        </li>
      )}
    </ol>
  );
}
