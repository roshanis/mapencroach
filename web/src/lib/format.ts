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
