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

/**
 * Builds a `document.cookie`-assignable string. Appends `; Secure` only when
 * running in a browser (`typeof window !== "undefined"`, SSR-safe) that is
 * currently served over https — an unconditional `Secure` attribute would
 * silently drop the cookie in plain-http local dev (e.g. Safari), and
 * `mapencroach_token` carries a real bearer credential in live mode, so it
 * must not be sendable over a plaintext connection once one exists.
 *
 * `value === undefined` builds the "clear" form (empty value, `max-age=0`
 * is expected to be passed by the caller).
 */
export function buildCookieString(
  name: string,
  value: string | undefined,
  maxAge: number
): string {
  const secure =
    typeof window !== "undefined" && window.location.protocol === "https:"
      ? "; Secure"
      : "";
  const encoded = value !== undefined ? encodeURIComponent(value) : "";
  return `${name}=${encoded}; path=/; max-age=${maxAge}; SameSite=Lax${secure}`;
}

export function setCookie(name: string, value: string) {
  if (typeof document === "undefined") return;
  document.cookie = buildCookieString(name, value, COOKIE_MAX_AGE);
}

export function clearCookie(name: string) {
  if (typeof document === "undefined") return;
  document.cookie = buildCookieString(name, undefined, 0);
}
