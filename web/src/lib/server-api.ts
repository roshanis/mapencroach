// Server-only data-access wrappers.
//
// `next/headers` can only run in a server context (React Server Components,
// route handlers, etc). This module is the single place that is allowed to
// import it — never import this module from a "use client" file.

import { cookies } from "next/headers";
import {
  getAlerts,
  getCase,
  getCaseImagery,
  getCases,
  getParcel,
  getParcelContext,
  getParcels,
  getWatchEntry,
  getWatchlist,
  TOKEN_COOKIE,
} from "./api";
import { PERSONA_META_COOKIE } from "./cookies";
import type {
  Alert,
  BBox,
  Case,
  CaseImagery,
  Parcel,
  ParcelContext,
  WatchEntry,
} from "./types";

// Server-only fallback credential. Unlike NEXT_PUBLIC_API_TOKEN this is never
// inlined into client JavaScript — only read here, in a module that must
// never be imported from a "use client" file. Used when a request has no
// session cookie (e.g. server-rendered pages hit before persona login).
function serverOnlyToken(): string | undefined {
  const token = process.env.MAPENCROACH_API_TOKEN;
  return token && token.length > 0 ? token : undefined;
}

export async function serverToken(): Promise<string | undefined> {
  try {
    const cookieToken = (await cookies()).get(TOKEN_COOKIE)?.value;
    if (cookieToken) return cookieToken;
  } catch {
    // No request context (e.g. static generation) — fall through to the
    // server-only token below.
  }
  return serverOnlyToken();
}

/**
 * Reads the active demo persona's role from PERSONA_META_COOKIE, server-side
 * (mirrors the client-side parsing done by ViewingAsBanner/TopBar via
 * `readCookie`). Returns undefined when the cookie is absent, malformed, or
 * carries a non-string role — callers must treat undefined as the demo's
 * default case-officer session, not as "no access".
 */
export async function getPersonaRoleForRequest(): Promise<string | undefined> {
  try {
    const raw = (await cookies()).get(PERSONA_META_COOKIE)?.value;
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as { role?: unknown };
    return typeof parsed?.role === "string" ? parsed.role : undefined;
  } catch {
    return undefined;
  }
}

export async function getParcelForRequest(
  id: string
): Promise<Parcel | undefined> {
  const token = await serverToken();
  return getParcel(id, token);
}

export async function getParcelsForRequest(bbox?: BBox): Promise<Parcel[]> {
  const token = await serverToken();
  return getParcels(bbox, token);
}

export async function getParcelContextForRequest(
  id: string
): Promise<ParcelContext | undefined> {
  const token = await serverToken();
  return getParcelContext(id, token);
}

export async function getAlertsForRequest(): Promise<Alert[]> {
  const token = await serverToken();
  return getAlerts(token);
}

/**
 * Fetches a single alert by id for the case-summary card. There is no
 * per-id alert endpoint wired up yet, so this loads the request-scoped
 * alert list and finds the match; returns undefined if not found.
 */
export async function getAlertForRequest(
  id: string
): Promise<Alert | undefined> {
  const alerts = await getAlertsForRequest();
  return alerts.find((alert) => alert.id === id);
}

export async function getCaseForRequest(
  id: string
): Promise<Case | undefined> {
  const token = await serverToken();
  return getCase(id, token);
}

export async function getCasesForRequest(): Promise<Case[]> {
  const token = await serverToken();
  return getCases(token);
}

export async function getWatchlistForRequest(): Promise<WatchEntry[]> {
  const token = await serverToken();
  return getWatchlist(token);
}

export async function getWatchEntryForRequest(
  alertId: string
): Promise<WatchEntry | undefined> {
  const token = await serverToken();
  return getWatchEntry(alertId, token);
}

export async function getCaseImageryForRequest(
  caseId: string
): Promise<CaseImagery | undefined> {
  const token = await serverToken();
  return getCaseImagery(caseId, token);
}
