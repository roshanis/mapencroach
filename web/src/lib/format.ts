export function ageFromNow(isoTimestamp: string, now: Date = new Date()): string {
  const then = new Date(isoTimestamp).getTime();
  const diffMs = now.getTime() - then;
  const diffMinutes = Math.floor(diffMs / 60000);

  if (diffMinutes < 60) return `${Math.max(diffMinutes, 0)}m ago`;

  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h ago`;

  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}

/** Sort alerts by severity_score, descending (highest severity first). */
export function sortBySeverityDesc<T extends { severity_score: number }>(
  items: T[]
): T[] {
  return [...items].sort((a, b) => b.severity_score - a.severity_score);
}

export const JURISDICTION_FALLBACK_LABELS: Record<string, string> = {
  state: "Haridwar–Roorkee Development Authority",
  "dist-a": "Haridwar Division",
  "dist-b": "Roorkee Division",
  "taluk-a1": "Haridwar City",
  "taluk-a2": "Kankhal",
  "taluk-a3": "Laksar",
  "taluk-b1": "Roorkee City",
  "taluk-b2": "Bahadarabad",
  "taluk-b3": "Narsan",
};

/**
 * Humanizes a jurisdiction id for display. Prefers an explicit `name` if
 * provided (non-empty); otherwise looks up a known fallback label; otherwise
 * title-cases the id (hyphens become spaces, each word capitalized).
 */
export function jurisdictionLabel(id: string, name?: string): string {
  if (name && name.trim().length > 0) return name;
  if (id in JURISDICTION_FALLBACK_LABELS) return JURISDICTION_FALLBACK_LABELS[id];
  return id
    .split("-")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

/** Humanizes a snake_case persona role (e.g. "case_officer" -> "Case Officer"). */
export function roleLabel(role: string): string {
  return role
    .split("_")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

/**
 * Humanizes a day count into a coarse, readable duration:
 * 0 -> "today"; 1 -> "1 day"; <60 -> "N days"; then months (rounded to the
 * nearest month) until the month count reaches 24, after which it switches
 * to years (rounded to the nearest year).
 */
export function formatDuration(days: number): string {
  if (days <= 0) return "today";
  if (days === 1) return "1 day";
  if (days < 60) return `${days} days`;

  const months = Math.round(days / 30);
  if (months >= 24) {
    const years = Math.round(months / 12);
    return years === 1 ? "1 year" : `${years} years`;
  }
  return months === 1 ? "1 month" : `${months} months`;
}

export interface ParsedArtifact {
  /** Humanized artifact kind, e.g. "Inspection report" or "Attachment". */
  kind: string;
  /** Display value — same as `value`, kept for callers that want a label. */
  label: string;
  /** The raw value portion of the artifact string. */
  value: string;
}

/** Humanizes a snake_case artifact key into sentence case, e.g. "inspection_report" -> "Inspection report". */
function humanizeArtifactKind(key: string): string {
  const words = key.split("_").filter(Boolean);
  if (words.length === 0) return "Attachment";
  return words
    .map((word, index) =>
      index === 0
        ? word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
        : word.toLowerCase()
    )
    .join(" ");
}

/**
 * Parses a case-event artifact string. Backend artifacts arrive as
 * "key: value" (e.g. "inspection_report: report-001.pdf"); this splits that
 * into a humanized kind plus the value. Strings without a colon are
 * tolerated — the whole string becomes the label/value, kind "Attachment".
 */
export function parseArtifact(raw: string): ParsedArtifact {
  const separatorIndex = raw.indexOf(":");
  if (separatorIndex === -1) {
    const whole = raw.trim();
    return { kind: "Attachment", label: whole, value: whole };
  }
  const key = raw.slice(0, separatorIndex).trim();
  const value = raw.slice(separatorIndex + 1).trim();
  return { kind: humanizeArtifactKind(key), label: value, value };
}
