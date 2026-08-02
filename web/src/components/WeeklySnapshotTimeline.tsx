"use client";

import { useEffect, useState } from "react";
import { authHeaders } from "@/lib/api";
import type { CaptureAttempt, CaptureStatus } from "@/lib/types";

/**
 * The subset of WatchEntry (or an equivalent record, e.g. a CaseImagery
 * whose `started_on` has been narrowed to non-null by the caller) this
 * component actually needs to render a week-by-week history. Kept narrow
 * rather than requiring a full WatchEntry so CaseImageryHistory can reuse
 * this component for the case-imagery-backfill slice without a second,
 * duplicated week-state renderer — WatchEntry itself still satisfies this
 * shape structurally, so existing callers are unaffected.
 */
export interface WeekTimelineSource {
  parcel_id: string;
  started_on: string;
  captures: CaptureAttempt[];
  due_weeks: string[];
}

export interface WeeklySnapshotTimelineProps {
  entry: WeekTimelineSource;
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
  entry: WeekTimelineSource,
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

/** Fixed thumbnail box size — constrained per the contract ("constrained
 * size, lazy-loaded"), and shared by every one of CapturedWeekEvidence's
 * image states (loading / thumbnail / not-retained / unauthorized / error)
 * so none of them occupy a different footprint in the row (a placeholder
 * that shrinks to nothing would itself read as an empty box, which no
 * not-retained-shaped state may ever be). The images themselves are no
 * longer literally browser-native-`loading="lazy"` (they must be fetched
 * with credentials via JS — see useCapturedImage — so the browser cannot
 * defer the request the way it can for a plain `<img src>`); each row's
 * fetch still only starts once that row is actually mounted. */
const THUMBNAIL_WIDTH = 160;
const THUMBNAIL_HEIGHT = 90;

/**
 * Outcomes for fetching a captured week's scene image.
 *
 * "no-url" and "not-retained" both render the identical "hash on record,
 * image not retained" placeholder (see CapturedWeekEvidence) — one is known
 * in advance (attempt.image_url was null; there is provably nothing to
 * fetch), the other is discovered by actually requesting the candidate URL
 * and getting a genuine 404 back. Either way it is a true statement: the
 * server does not hold the bytes.
 *
 * "unauthorized" and "error" are deliberately NOT folded into that same
 * state. A 401/403 means the bytes ARE retained but this session could not
 * prove it was allowed to see them — collapsing that into "not retained"
 * would be a false statement in an evidence UI. "error" covers everything
 * else (network failure, 5xx): also not a "not retained" claim, since the
 * server never actually answered the question.
 */
type CapturedImageState =
  | { status: "no-url" }
  | { status: "loading" }
  | { status: "loaded"; objectUrl: string }
  | { status: "not-retained" }
  | { status: "unauthorized" }
  | { status: "error" };

/**
 * Fetches a captured week's scene image with the app's real credentials and
 * turns the response into an object URL for the `<img>`.
 *
 * A plain `<img src={attempt.image_url}>` cannot carry the
 * `Authorization: Bearer <token>` header the backend requires (HTTPBearer
 * has no cookie fallback, and the console typically talks to a different
 * origin than the API in real deployments — see contract-blobs.md and
 * mapencroach.api.auth._bearer_scheme), so it always 401s/403s against a
 * live backend. `authHeaders()` (src/lib/api.ts) is the same auth every
 * other API call in this app uses — cookie token or an explicit override,
 * never the removed NEXT_PUBLIC_API_TOKEN — and CORS already allows the
 * Authorization header cross-origin, so an authenticated `fetch` here works
 * where a bare `<img>` request cannot.
 *
 * Follows this codebase's established async-effect pattern (see
 * WatchToggle, PersonaSwitcher): a `cancelled` flag guards against setting
 * state from a stale/out-of-order response (including React StrictMode's
 * double-invoked effects in development), and the effect's cleanup revokes
 * whatever object URL that run created so successive fetches (a changed
 * `imageUrl`, a retry, or unmount) never leak one.
 */
function useCapturedImage(imageUrl: string | null): {
  state: CapturedImageState;
  retry: () => void;
} {
  const [state, setState] = useState<CapturedImageState>(
    imageUrl ? { status: "loading" } : { status: "no-url" }
  );
  const [retryNonce, setRetryNonce] = useState(0);

  useEffect(() => {
    if (!imageUrl) {
      setState({ status: "no-url" });
      return;
    }

    let cancelled = false;
    let createdObjectUrl: string | null = null;
    setState({ status: "loading" });

    fetch(imageUrl, { headers: authHeaders() })
      .then(async (res) => {
        if (!res.ok) {
          if (cancelled) return;
          // Only a genuine 404 may ever claim "not retained" — the server
          // is explicitly saying it does not hold the bytes. Every other
          // failure must be told apart, never folded into that claim.
          if (res.status === 404) {
            setState({ status: "not-retained" });
          } else if (res.status === 401 || res.status === 403) {
            setState({ status: "unauthorized" });
          } else {
            setState({ status: "error" });
          }
          return;
        }
        const blob = await res.blob();
        if (cancelled) return;
        createdObjectUrl = URL.createObjectURL(blob);
        setState({ status: "loaded", objectUrl: createdObjectUrl });
      })
      .catch(() => {
        if (cancelled) return;
        setState({ status: "error" });
      });

    return () => {
      cancelled = true;
      if (createdObjectUrl) URL.revokeObjectURL(createdObjectUrl);
    };
  }, [imageUrl, retryNonce]);

  return { state, retry: () => setRetryNonce((n) => n + 1) };
}

/**
 * The evidence pair for a captured week: the thumbnail (or its explicit
 * absence, truthfully explained) alongside cloud % and the sha256. Split out
 * of the main render so the several very different "captured" outcomes —
 * bytes retained, bytes genuinely not retained, bytes retained but this
 * session unauthorized to fetch them, and "could not tell" — are each a
 * single, clearly-named branch instead of one conditional buried in a
 * larger block. This whole feature's design principle is that a gap must
 * state its true reason; an unexplained or wrongly-explained gap is worse
 * than none, so these branches are kept distinguishable in both text and
 * `data-testid`, never by colour alone.
 */
function CapturedWeekEvidence({
  attempt,
  weekKey,
  weekStart,
  parcelId,
}: {
  attempt: CaptureAttempt;
  weekKey: string;
  weekStart: Date;
  parcelId: string;
}) {
  const dateLabel = formatWeekStart(weekStart);
  const { state: imageState, retry } = useCapturedImage(attempt.image_url);

  return (
    <div className="mt-1.5 flex flex-wrap items-start gap-3">
      {imageState.status === "loading" && (
        <div
          data-testid="snapshot-week-thumbnail-loading"
          role="status"
          aria-label={`Loading satellite image for week ${weekKey} (week of ${dateLabel}), parcel ${parcelId}`}
          style={{ width: THUMBNAIL_WIDTH, height: THUMBNAIL_HEIGHT }}
          className="flex shrink-0 items-center justify-center rounded border border-gray-200 bg-gray-50 text-[11px] text-gray-500"
        >
          Loading image…
        </div>
      )}

      {imageState.status === "loaded" && (
        // Opens the full-resolution scene in a new tab using the browser's
        // own image viewer, via the same object URL already fetched with
        // authenticated credentials above — an <a href={attempt.image_url}>
        // pointing at the raw, unauthenticated API path would 401/403
        // exactly like the bare <img> this replaces did.
        <a
          href={imageState.objectUrl}
          target="_blank"
          rel="noreferrer"
          aria-label={`Open full-size satellite image for week ${weekKey} (week of ${dateLabel}), parcel ${parcelId}`}
          className="block shrink-0 overflow-hidden rounded border border-gray-200 focus:outline-none focus:ring-2 focus:ring-gov focus:ring-offset-1"
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- src is a
              blob: object URL created from an authenticated fetch response,
              not a static/remote path next/image can optimize or allowlist
              via build-time `remotePatterns`. A plain <img> is the correct
              tool here, not a workaround. See useCapturedImage above. */}
          <img
            data-testid="snapshot-week-thumbnail"
            src={imageState.objectUrl}
            alt={`Satellite image captured for week ${weekKey} (week of ${dateLabel}), parcel ${parcelId}`}
            width={THUMBNAIL_WIDTH}
            height={THUMBNAIL_HEIGHT}
            style={{ width: THUMBNAIL_WIDTH, height: THUMBNAIL_HEIGHT }}
            className="object-cover"
          />
        </a>
      )}

      {(imageState.status === "no-url" ||
        imageState.status === "not-retained") && (
        // A captured week whose bytes were not retained — either known in
        // advance (image_url was null) or discovered just now by a genuine
        // 404 from the server. This must read as "we hold the hash, not
        // the image" — never as an empty box, and never mistakable for the
        // thumbnail above at a glance (dashed border, muted fill, and its
        // own explicit label rather than colour alone conveying the
        // difference).
        <div
          data-testid="snapshot-week-not-retained"
          role="note"
          aria-label={`Image not retained for week ${weekKey} (week of ${dateLabel}), parcel ${parcelId} — hash on record only`}
          style={{ width: THUMBNAIL_WIDTH, height: THUMBNAIL_HEIGHT }}
          className="flex shrink-0 flex-col items-start justify-center gap-0.5 rounded border border-dashed border-gray-300 bg-gray-50 px-2.5 py-2"
        >
          <span className="text-xs font-semibold text-gray-700">
            Image not retained
          </span>
          <span className="text-[11px] leading-4 text-gray-500">
            Hash on record — scene bytes were not kept.
          </span>
        </div>
      )}

      {imageState.status === "unauthorized" && (
        // The server never said the bytes are missing — it refused the
        // request. Saying "not retained" here would be false; this state
        // exists specifically so that false claim is never made.
        <div
          data-testid="snapshot-week-unauthorized"
          role="note"
          aria-label={`Image not authorized for week ${weekKey} (week of ${dateLabel}), parcel ${parcelId} — the scene is retained but this session could not be authorized to view it`}
          style={{ width: THUMBNAIL_WIDTH, height: THUMBNAIL_HEIGHT }}
          className="flex shrink-0 flex-col items-start justify-center gap-0.5 rounded border border-dashed border-amber-300 bg-amber-50 px-2.5 py-2"
        >
          <span className="text-xs font-semibold text-amber-800">
            Image not authorized
          </span>
          <span className="text-[11px] leading-4 text-amber-700">
            The scene is retained — this session is not authorized to view
            it.
          </span>
        </div>
      )}

      {imageState.status === "error" && (
        <div
          data-testid="snapshot-week-load-error"
          role="alert"
          aria-label={`Image could not be loaded for week ${weekKey} (week of ${dateLabel}), parcel ${parcelId}`}
          style={{ width: THUMBNAIL_WIDTH, height: THUMBNAIL_HEIGHT }}
          className="flex shrink-0 flex-col items-start justify-center gap-1 rounded border border-dashed border-red-300 bg-red-50 px-2.5 py-2"
        >
          <span className="text-xs font-semibold text-red-800">
            Image could not be loaded
          </span>
          <button
            type="button"
            data-testid="snapshot-week-retry"
            onClick={retry}
            className="self-start text-[11px] font-medium text-red-700 underline hover:text-red-900"
          >
            Retry
          </button>
        </div>
      )}

      <div className="flex flex-col gap-1 pt-0.5 text-xs text-gray-600">
        {attempt.cloud_pct != null && (
          <span>{formatCloudPct(attempt.cloud_pct)}</span>
        )}
        {attempt.sha256 && (
          <span
            data-testid="snapshot-week-sha256"
            title={attempt.sha256}
            className="font-mono"
          >
            sha256:{abbreviateHash(attempt.sha256)}
          </span>
        )}
      </div>
    </div>
  );
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
      aria-label={`Weekly capture history for ${entry.parcel_id}, covering weeks from ${entry.started_on}`}
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
            <CapturedWeekEvidence
              attempt={row.attempt}
              weekKey={row.key}
              weekStart={row.weekStart}
              parcelId={entry.parcel_id}
            />
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
