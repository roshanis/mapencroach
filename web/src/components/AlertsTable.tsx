"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { TierChip } from "./TierChip";
import { ageFromNow, sortBySeverityDesc } from "@/lib/format";
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
  const [tierFilter, setTierFilter] = useState<AlertTier | "all">("all");
  const [statusFilter, setStatusFilter] = useState<AlertStatus | "all">("all");

  const filtered = useMemo(() => {
    const byFilter = alerts.filter((a) => {
      if (tierFilter !== "all" && a.tier !== tierFilter) return false;
      if (statusFilter !== "all" && a.status !== statusFilter) return false;
      return true;
    });
    return sortBySeverityDesc(byFilter);
  }, [alerts, tierFilter, statusFilter]);

  return (
    <div data-testid="alerts-table" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-2 text-sm text-gray-700">
          Tier
          <select
            data-testid="tier-filter"
            value={tierFilter}
            onChange={(e) => setTierFilter(e.target.value as AlertTier | "all")}
            className="rounded border border-gray-300 px-2 py-1 text-sm"
          >
            {TIER_OPTIONS.map((t) => (
              <option key={t} value={t}>
                {t === "all" ? "All tiers" : t}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm text-gray-700">
          Status
          <select
            data-testid="status-filter"
            value={statusFilter}
            onChange={(e) =>
              setStatusFilter(e.target.value as AlertStatus | "all")
            }
            className="rounded border border-gray-300 px-2 py-1 text-sm"
          >
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s === "all" ? "All statuses" : s.replace("_", " ")}
              </option>
            ))}
          </select>
        </label>
      </div>

      <table className="w-full border-collapse overflow-hidden rounded-lg border border-gray-200 text-sm">
        <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
          <tr>
            <th className="px-4 py-2">Tier</th>
            <th className="px-4 py-2">Parcel</th>
            <th className="px-4 py-2">Severity</th>
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
              onClick={() => router.push(`/parcels/${alert.parcel_id}`)}
              className="cursor-pointer border-t border-gray-100 hover:bg-gray-50"
            >
              <td className="px-4 py-2">
                <TierChip tier={alert.tier} />
              </td>
              <td className="px-4 py-2 font-medium text-gray-900">
                {alert.parcel_id}
              </td>
              <td className="px-4 py-2">{alert.severity_score}</td>
              <td className="px-4 py-2">{alert.area_m2.toLocaleString()}</td>
              <td className="px-4 py-2 capitalize">
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
  );
}
