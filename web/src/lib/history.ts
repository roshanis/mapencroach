// Turns a machine-oriented CaseEvent (state chain codes, "system"/"inspector-1"
// actor ids) into plain-language copy for the case Event History timeline.

import type { CaseEvent } from "@/lib/types";

export interface EventDescription {
  /** Plain-language sentence describing the transition, e.g. "Case triaged". */
  headline: string;
  /** The event's free-text note, when present. */
  detail?: string;
}

/** Narrative headlines for the eleven-step due-process chain. */
const CHAIN_HEADLINES: Record<string, string> = {
  NEW: "Case opened",
  TRIAGED: "Case triaged",
  INSPECTION_ASSIGNED: "Inspection assigned",
  INSPECTED: "Site inspection completed",
  SHOW_CAUSE_ISSUED: "Show-cause notice issued",
  RESPONSE_WINDOW: "Response window opened",
  HEARING_SCHEDULED: "Hearing scheduled",
  HEARING_HELD: "Hearing held",
  ORDER_ISSUED: "Order issued",
  ACTION_TAKEN: "Enforcement action taken",
  CLOSED: "Case closed",
};

/**
 * Narrative headlines for paused/off-chain special states — the completed-
 * action counterpart of TransitionPanel's imperative ACTION_LABELS (e.g.
 * "Record court stay" as an action button vs. "Court stay recorded" here as
 * a past event in the history).
 */
const SPECIAL_HEADLINES: Record<string, string> = {
  DISMISSED_FALSE_POSITIVE: "Dismissed as false positive",
  LEGACY_REFERRED: "Referred to legacy process",
  SURVEY_REQUESTED: "Boundary survey requested",
  STAYED_BY_COURT: "Court stay recorded",
};

/** Title-cases a SCREAMING_SNAKE_CASE state so an unrecognized state still
 * renders something readable instead of crashing the timeline. */
function humanizeState(state: string): string {
  return state
    .toLowerCase()
    .split("_")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/** Reads the value of a "key: value" artifact whose key matches `key`, or
 * null when no such artifact is present. */
function artifactValue(artifacts: string[], key: string): string | null {
  for (const raw of artifacts) {
    const separatorIndex = raw.indexOf(":");
    if (separatorIndex === -1) continue;
    if (raw.slice(0, separatorIndex).trim() === key) {
      return raw.slice(separatorIndex + 1).trim();
    }
  }
  return null;
}

/**
 * Describes a CaseEvent as plain-language copy for a non-technical audience:
 * a headline sentence for the transition (e.g. "Case triaged" instead of
 * "NEW -> TRIAGED"), plus the event's note as `detail` when present.
 */
export function describeEvent(event: CaseEvent): EventDescription {
  const toState = event.to_state;
  let headline =
    CHAIN_HEADLINES[toState] ??
    SPECIAL_HEADLINES[toState] ??
    humanizeState(toState);

  if (toState === "INSPECTION_ASSIGNED") {
    const inspectorId = artifactValue(event.artifacts, "inspector_id");
    if (inspectorId) headline = `${headline} to ${inspectorId}`;
  }

  return event.note ? { headline, detail: event.note } : { headline };
}

/**
 * Humanizes an actor id for display: "system" or any "system:<subsystem>"
 * id (e.g. "system:detector", "system:workflow") -> "System"; a
 * "<role>-<n>" id (e.g. "inspector-1", "officer-1") keeps the id but
 * title-cases the encoded role prefix ("Inspector inspector-1", "Officer
 * officer-1"); anything else (e.g. a full name) is returned verbatim.
 */
export function describeActor(actor: string): string {
  if (actor === "system" || actor.startsWith("system:")) return "System";
  const match = actor.match(/^([a-z]+)-\d+$/i);
  if (match) {
    const role = match[1];
    const titled = role.charAt(0).toUpperCase() + role.slice(1).toLowerCase();
    return `${titled} ${actor}`;
  }
  return actor;
}
