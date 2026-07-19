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
  getParcels,
  TOKEN_COOKIE,
} from "./api";
import type {
  Alert,
  AlertFilters,
  BBox,
  Case,
  Parcel,
  ParcelContext,
} from "./types";

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

export async function getAlertsForRequest(
  filters?: AlertFilters
): Promise<Alert[]> {
  const token = await serverToken();
  return getAlerts(filters, token);
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
