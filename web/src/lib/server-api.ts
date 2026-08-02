// Server-only data-access wrappers.
//
// `next/headers` can only run in a server context (React Server Components,
// route handlers, etc). This module is the single place that is allowed to
// import it — never import this module from a "use client" file.

import { cookies } from "next/headers";
import {
  getAlerts,
  getCase,
  getCases,
  getParcel,
  getParcelContext,
  getWatchEntry,
  getWatchlist,
  TOKEN_COOKIE,
} from "./api";
import type { Alert, Case, Parcel, ParcelContext, WatchEntry } from "./types";

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

export async function getParcelForRequest(
  id: string
): Promise<Parcel | undefined> {
  const token = await serverToken();
  return getParcel(id, token);
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
