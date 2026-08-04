"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { TierChip } from "./TierChip";
import { ageFromNow, sortBySeverityDesc } from "@/lib/format";
import {
  ALERT_STATUS_DESCRIPTIONS,
  SEVERITY_EXPLANATION,
} from "@/lib/explanations";
import { parseFilterParam } from "@/lib/searchParams";
import type { Alert, AlertStatus, AlertTier } from "@/lib/types";

export interface AlertsTableProps {
  alerts: Alert[];
}

const TIER_OPTIONS: (AlertTier | "all")[] = ["all", "red", "amber", "green", "legacy"];
const STATUS_OPTIONS: (AlertStatus | "all")[] = [
  "all",
  "open",
  "under_review",
  "escalated",
  "closed",
];

/**
 * Every display value for one alert, computed once so the desktop `<table>`
 * row and the mobile card render identical data/formatting instead of two
 * copies that can drift apart. Only the surrounding markup differs between
 * AlertTableRow and AlertCard below — this holds the shared derivation.
 */
interface AlertRowFields {
  parcelHref: string;
  parcelId: string;
  severity: number;
  areaLabel: string;
  statusLabel: string;
  statusTitle: string;
  ageLabel: string;
}

function deriveAlertRow(alert: Alert): AlertRowFields {
  return {
    parcelHref: `/parcels/${alert.parcel_id}`,
    parcelId: alert.parcel_id,
    severity: alert.severity_score,
    areaLabel: alert.area_m2.toLocaleString(),
    statusLabel: alert.status.replace("_", " "),
    statusTitle: ALERT_STATUS_DESCRIPTIONS[alert.status],
    ageLabel: ageFromNow(alert.detected_at),
  };
}

const PARCEL_LINK_CLASSES =
  "text-gov underline-offset-2 hover:underline focus:outline-none focus:ring-2 focus:ring-gov/30";

function AlertTableRow({ alert }: { alert: Alert }) {
  const f = deriveAlertRow(alert);
  return (
    <tr
      data-testid="alert-row"
      data-alert-id={alert.id}
      className="border-t border-gray-100 hover:bg-gray-50"
    >
      <td className="px-4 py-2">
        <TierChip tier={alert.tier} />
      </td>
      <td className="px-4 py-2 font-medium">
        <Link href={f.parcelHref} className={PARCEL_LINK_CLASSES}>
          {f.parcelId}
        </Link>
      </td>
      <td className="px-4 py-2">{f.severity}</td>
      <td className="px-4 py-2">{f.areaLabel}</td>
      <td className="px-4 py-2 capitalize" title={f.statusTitle}>
        {f.statusLabel}
      </td>
      <td className="px-4 py-2 text-gray-500">{f.ageLabel}</td>
    </tr>
  );
}

/** One alert's card presentation for narrow screens (< sm). Uses the same
 * `deriveAlertRow` values as AlertTableRow so every column the table shows
 * is reachable here too — nothing is dropped on mobile, just re-laid-out as
 * a labeled list instead of table cells. */
function AlertCard({ alert }: { alert: Alert }) {
  const f = deriveAlertRow(alert);
  return (
    <li
      data-testid="alert-card"
      data-alert-id={alert.id}
      className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col items-start gap-1.5">
          <TierChip tier={alert.tier} />
          <Link href={f.parcelHref} className={`text-base font-semibold ${PARCEL_LINK_CLASSES}`}>
            {f.parcelId}
          </Link>
        </div>
        <span className="shrink-0 text-xs text-gray-500">{f.ageLabel}</span>
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
        <div>
          <dt className="text-xs uppercase tracking-wide text-gray-500" title={SEVERITY_EXPLANATION}>
            Severity
          </dt>
          <dd className="font-medium text-gray-900">{f.severity}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-gray-500">Area (m²)</dt>
          <dd className="font-medium text-gray-900">{f.areaLabel}</dd>
        </div>
        <div className="col-span-2">
          <dt className="text-xs uppercase tracking-wide text-gray-500">Status</dt>
          <dd className="capitalize font-medium text-gray-900" title={f.statusTitle}>
            {f.statusLabel}
          </dd>
        </div>
      </dl>
    </li>
  );
}

export function AlertsTable({ alerts }: AlertsTableProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [query, setQuery] = useState(searchParams.get("q") ?? "");
  const [tierFilter, setTierFilter] = useState<AlertTier | "all">(
    parseFilterParam(searchParams.get("tier"), TIER_OPTIONS)
  );
  const [statusFilter, setStatusFilter] = useState<AlertStatus | "all">(
    parseFilterParam(searchParams.get("status"), STATUS_OPTIONS)
  );

  function persistFilters(next: {
    query?: string;
    tier?: AlertTier | "all";
    status?: AlertStatus | "all";
  }) {
    const params = new URLSearchParams(searchParams.toString());
    const nextQuery = next.query ?? query;
    const nextTier = next.tier ?? tierFilter;
    const nextStatus = next.status ?? statusFilter;

    if (nextQuery.trim()) params.set("q", nextQuery.trim());
    else params.delete("q");
    if (nextTier !== "all") params.set("tier", nextTier);
    else params.delete("tier");
    if (nextStatus !== "all") params.set("status", nextStatus);
    else params.delete("status");

    const suffix = params.toString();
    // Persist filters straight into the browser URL without going through
    // next/navigation's router.replace: on a force-dynamic page that
    // triggers a full RSC re-fetch of the page on every call, so typing in
    // the search box re-fetched the whole list on every keystroke.
    // history.replaceState updates the address bar (and back/forward state)
    // with none of that — there is nothing here for the server to refetch.
    if (typeof window !== "undefined") {
      window.history.replaceState(null, "", `${pathname}${suffix ? `?${suffix}` : ""}`);
    }
  }

  const filtered = useMemo(() => {
    const byFilter = alerts.filter((a) => {
      const normalizedQuery = query.trim().toLowerCase();
      if (
        normalizedQuery &&
        ![a.id, a.parcel_id, a.tier, a.status]
          .join(" ")
          .toLowerCase()
          .includes(normalizedQuery)
      ) {
        return false;
      }
      if (tierFilter !== "all" && a.tier !== tierFilter) return false;
      if (statusFilter !== "all" && a.status !== statusFilter) return false;
      return true;
    });
    return sortBySeverityDesc(byFilter);
  }, [alerts, query, tierFilter, statusFilter]);

  const tierCounts = Object.fromEntries(
    TIER_OPTIONS.map((tier) => [
      tier,
      tier === "all" ? alerts.length : alerts.filter((a) => a.tier === tier).length,
    ])
  ) as Record<(typeof TIER_OPTIONS)[number], number>;
  const statusCounts = Object.fromEntries(
    STATUS_OPTIONS.map((status) => [
      status,
      status === "all"
        ? alerts.length
        : alerts.filter((a) => a.status === status).length,
    ])
  ) as Record<(typeof STATUS_OPTIONS)[number], number>;

  return (
    <div data-testid="alerts-table" className="flex flex-col gap-4">
      <div className="grid gap-3 rounded-lg border border-slate-200 bg-white p-4 sm:grid-cols-[minmax(14rem,1fr)_auto_auto] sm:items-end">
        <label className="flex flex-col gap-1 text-sm text-gray-700">
          Search
          <input
            type="search"
            aria-label="Search alerts"
            value={query}
            placeholder="Alert or parcel ID"
            onChange={(event) => {
              const nextQuery = event.target.value;
              setQuery(nextQuery);
              persistFilters({ query: nextQuery });
            }}
            className="rounded-md border border-gray-300 px-3 py-2 text-sm outline-none focus:border-gov focus:ring-2 focus:ring-gov/20"
          />
        </label>
        <label className="flex items-center gap-2 text-sm text-gray-700">
          Tier
          <select
            data-testid="tier-filter"
            value={tierFilter}
            onChange={(e) => {
              const nextTier = e.target.value as AlertTier | "all";
              setTierFilter(nextTier);
              persistFilters({ tier: nextTier });
            }}
            className="rounded border border-gray-300 px-2 py-2 text-sm"
          >
            {TIER_OPTIONS.map((t) => (
              <option key={t} value={t}>
                {t === "all" ? "All tiers" : `${t[0].toUpperCase()}${t.slice(1)}`} ({tierCounts[t]})
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm text-gray-700">
          Status
          <select
            data-testid="status-filter"
            value={statusFilter}
            onChange={(e) => {
              const nextStatus = e.target.value as AlertStatus | "all";
              setStatusFilter(nextStatus);
              persistFilters({ status: nextStatus });
            }}
            className="rounded border border-gray-300 px-2 py-2 text-sm"
          >
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s === "all"
                  ? "All statuses"
                  : s
                      .replace("_", " ")
                      .replace(/\b\w/g, (letter) => letter.toUpperCase())} ({statusCounts[s]})
              </option>
            ))}
          </select>
        </label>
      </div>

      <p className="text-sm text-slate-500">
        Showing {filtered.length} of {alerts.length} alerts
      </p>

      {/* Real <table> for sm and up. Below sm, dragging through ~700px of
          table to read one row is unusable, so a stacked card list (below)
          takes over — both render from the same `filtered` array and the
          same per-alert `deriveAlertRow` values, so nothing is dropped and
          nothing can drift between the two presentations. */}
      <div className="hidden overflow-x-auto rounded-lg border border-gray-200 bg-white sm:block">
        <table className="min-w-[44rem] w-full border-collapse text-sm">
          <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
            <tr>
              <th className="px-4 py-2">Tier</th>
              <th className="px-4 py-2">Parcel</th>
              <th className="px-4 py-2" title={SEVERITY_EXPLANATION}>
                Severity
              </th>
              <th className="px-4 py-2">Area (m²)</th>
              <th className="px-4 py-2">Status</th>
              <th className="px-4 py-2">Age</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((alert) => (
              <AlertTableRow key={alert.id} alert={alert} />
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-gray-400">
                  No alerts match the current filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <ul data-testid="alerts-card-list" className="flex flex-col gap-3 sm:hidden">
        {filtered.map((alert) => (
          <AlertCard key={alert.id} alert={alert} />
        ))}
        {filtered.length === 0 && (
          <li className="rounded-lg border border-gray-200 bg-white px-4 py-6 text-center text-gray-400">
            No alerts match the current filters.
          </li>
        )}
      </ul>

      <p data-testid="severity-footnote" className="text-xs text-gray-400">
        {SEVERITY_EXPLANATION}
      </p>
    </div>
  );
}
