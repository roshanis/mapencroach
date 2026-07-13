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
