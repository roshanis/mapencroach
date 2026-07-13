// Small client-side cookie helpers shared by PersonaSwitcher, the personas
// page, and ViewingAsBanner. Browser-only: all functions are no-ops (or
// return undefined) when `document` is unavailable (SSR).

export const COOKIE_MAX_AGE = 28800; // 8 hours, matches demo persona token lifetime.

/** JSON-encoded {name, role, jurisdiction_id, jurisdiction_name} for the active persona. */
export const PERSONA_META_COOKIE = "mapencroach_persona_meta";

export function readCookie(name: string): string | undefined {
  if (typeof document === "undefined") return undefined;
  const prefix = `${name}=`;
  const match = document.cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(prefix));
  if (!match) return undefined;
  return decodeURIComponent(match.slice(prefix.length));
}

export function setCookie(name: string, value: string) {
  if (typeof document === "undefined") return;
  document.cookie = `${name}=${encodeURIComponent(
    value
  )}; path=/; max-age=${COOKIE_MAX_AGE}; SameSite=Lax`;
}

export function clearCookie(name: string) {
  if (typeof document === "undefined") return;
  document.cookie = `${name}=; path=/; max-age=0; SameSite=Lax`;
}
