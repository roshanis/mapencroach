import { parseArtifact } from "@/lib/format";
import { describeActor, describeEvent } from "@/lib/history";
import type { CaseEvent } from "@/lib/types";

export interface EventTimelineProps {
  events: CaseEvent[];
}

function formatEventTimestamp(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return iso;
  return parsed.toLocaleString("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

/**
 * A vertical narrative timeline for a case's Event History: one node per
 * event with a plain-language headline (from describeEvent), a muted
 * "by {actor} · {date}" meta line, the event's note as detail text, and
 * artifacts rendered as small humanized chips (via parseArtifact) instead of
 * raw "key: value" strings. Events render oldest-first (chain order).
 */
export function EventTimeline({ events }: EventTimelineProps) {
  if (events.length === 0) {
    return (
      <div
        data-testid="event-timeline"
        className="flex h-20 items-center justify-center rounded border border-dashed border-gray-300 text-sm text-gray-400"
      >
        No events recorded yet.
      </div>
    );
  }

  return (
    <ol data-testid="event-timeline" className="flex flex-col">
      {events.map((event, index) => {
        const { headline, detail } = describeEvent(event);
        const isLast = index === events.length - 1;
        return (
          <li
            key={`${event.to_state}-${event.occurred_at}-${index}`}
            data-testid="event-item"
            className="relative flex gap-3"
          >
            <div className="flex flex-col items-center">
              <span
                aria-hidden
                className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full bg-gov ring-4 ring-gov/15"
              />
              {!isLast && (
                <span aria-hidden className="w-px flex-1 bg-gray-200" />
              )}
            </div>
            <div className={`flex flex-1 flex-col gap-1 ${isLast ? "pb-0" : "pb-5"}`}>
              <p className="text-sm font-medium text-gray-900">{headline}</p>
              <p className="text-xs text-gray-400">
                by {describeActor(event.actor)} · {formatEventTimestamp(event.occurred_at)}
              </p>
              {detail && <p className="text-sm text-gray-700">{detail}</p>}
              {event.artifacts.length > 0 && (
                <ul className="mt-1 flex flex-wrap gap-2">
                  {event.artifacts.map((artifact) => {
                    const { kind, label } = parseArtifact(artifact);
                    return (
                      <li
                        key={artifact}
                        className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-600"
                      >
                        {kind} · {label}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
