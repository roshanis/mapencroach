"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { TierChip } from "./TierChip";
import { ageFromNow, sortBySeverityDesc } from "@/lib/format";
import {
  ALERT_STATUS_DESCRIPTIONS,
  SEVERITY_EXPLANATION,
} from "@/lib/explanations";
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

export function AlertsTable({ alerts }: AlertsTableProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [query, setQuery] = useState(searchParams.get("q") ?? "");
  const [tierFilter, setTierFilter] = useState<AlertTier | "all">(
    (searchParams.get("tier") as AlertTier | null) ?? "all"
  );
  const [statusFilter, setStatusFilter] = useState<AlertStatus | "all">(
    (searchParams.get("status") as AlertStatus | null) ?? "all"
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
    router.replace(`${pathname}${suffix ? `?${suffix}` : ""}`, {
      scroll: false,
    });
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

      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
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
            <tr
              key={alert.id}
              data-testid="alert-row"
              data-alert-id={alert.id}
              className="border-t border-gray-100 hover:bg-gray-50"
            >
              <td className="px-4 py-2">
                <TierChip tier={alert.tier} />
              </td>
              <td className="px-4 py-2 font-medium">
                <Link
                  href={`/parcels/${alert.parcel_id}`}
                  className="text-gov underline-offset-2 hover:underline focus:outline-none focus:ring-2 focus:ring-gov/30"
                >
                  {alert.parcel_id}
                </Link>
              </td>
              <td className="px-4 py-2">{alert.severity_score}</td>
              <td className="px-4 py-2">{alert.area_m2.toLocaleString()}</td>
              <td
                className="px-4 py-2 capitalize"
                title={ALERT_STATUS_DESCRIPTIONS[alert.status]}
              >
                {alert.status.replace("_", " ")}
              </td>
              <td className="px-4 py-2 text-gray-500">
                {ageFromNow(alert.detected_at)}
              </td>
            </tr>
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
      <p data-testid="severity-footnote" className="text-xs text-gray-400">
        {SEVERITY_EXPLANATION}
      </p>
    </div>
  );
}
