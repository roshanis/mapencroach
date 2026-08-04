"use client";

// The old PersonaSwitcher <select> UI has been superseded by DemoMenu (see
// TopBar), which consolidates "switch persona" and "exit persona" into a
// single header control instead of scattering a label + <select> + a
// separate "Demo roles" link across the header. This module now exists
// purely as the shared persona-session helper: DemoMenu (and
// ViewingAsBanner, for the exit flow) import `switchPersona` / `exitPersona`
// / `getPersonas` from here instead of duplicating the fetch + cookie
// read/write logic.

import {
  getPersonas,
  loginPersona,
  PERSONA_COOKIE,
  TOKEN_COOKIE,
  type Persona,
} from "@/lib/api";
import { PERSONA_META_COOKIE, clearCookie, setCookie } from "@/lib/cookies";

export { getPersonas };
export type { Persona };

/**
 * Logs in as a demo persona: calls the backend /demo/login flow, stores the
 * resulting token/persona/meta cookies, and reloads the page so server
 * components pick up the new session. Returns true on success, false on
 * failure (caller decides how to surface the error).
 */
export async function switchPersona(personaId: string): Promise<boolean> {
  const result = await loginPersona(personaId);
  if (!result) return false;
  setCookie(TOKEN_COOKIE, result.token);
  setCookie(PERSONA_COOKIE, result.persona.name);
  setCookie(
    PERSONA_META_COOKIE,
    JSON.stringify({
      name: result.persona.name,
      role: result.persona.role,
      jurisdiction_id: result.persona.jurisdiction_id,
      jurisdiction_name: result.persona.jurisdiction_name,
    })
  );
  window.location.reload();
  return true;
}

/**
 * Clears all persona/token cookies and reloads back to the default officer
 * view. Shared by DemoMenu's "Exit persona" item and ViewingAsBanner's
 * "Exit persona" button so both use the exact same exit flow.
 */
export function exitPersona() {
  clearCookie(TOKEN_COOKIE);
  clearCookie(PERSONA_COOKIE);
  clearCookie(PERSONA_META_COOKIE);
  window.location.reload();
}
