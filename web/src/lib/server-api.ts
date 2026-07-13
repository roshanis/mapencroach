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
  TOKEN_COOKIE,
} from "./api";
import type { Alert, AlertFilters, Case, Parcel } from "./types";

export async function serverToken(): Promise<string | undefined> {
  try {
    return (await cookies()).get(TOKEN_COOKIE)?.value;
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

export async function getAlertsForRequest(
  filters?: AlertFilters
): Promise<Alert[]> {
  const token = await serverToken();
  return getAlerts(filters, token);
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
