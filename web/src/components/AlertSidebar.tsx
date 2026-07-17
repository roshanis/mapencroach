"use client";

import type { ReactNode } from "react";
import { TierChip } from "./TierChip";
import { ageFromNow, sortBySeverityDesc } from "@/lib/format";
import type { Alert } from "@/lib/types";

export interface AlertSidebarProps {
  alerts: Alert[];
  onSelect?: (alert: Alert) => void;
  selectedAlertId?: string;
  summary?: ReactNode;
  mobileOpen?: boolean;
  onMobileClose?: () => void;
}

export function AlertSidebar({
  alerts,
  onSelect,
  selectedAlertId,
  summary,
  mobileOpen = false,
  onMobileClose,
}: AlertSidebarProps) {
  const sorted = sortBySeverityDesc(
    alerts.filter((alert) => alert.status !== "closed")
  );

  return (
    <aside
      data-testid="alert-sidebar"
      className={`${
        mobileOpen ? "flex" : "hidden"
      } fixed inset-x-3 bottom-3 top-20 z-30 flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-xl md:static md:z-auto md:flex md:h-full md:w-80 md:shrink-0 md:rounded-none md:border-y-0 md:border-l-0 md:shadow-none`}
    >
      {summary}
      <div className="flex items-start justify-between border-b border-gray-200 px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold text-gray-900">
            Unresolved alerts
          </h2>
          <p className="text-xs text-gray-500">
            {sorted.length} need attention
          </p>
        </div>
        {onMobileClose && (
          <button
            type="button"
            aria-label="Close work queue"
            onClick={onMobileClose}
            className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 md:hidden"
          >
            ×
          </button>
        )}
      </div>
      <ul className="flex-1 overflow-y-auto">
        {sorted.map((alert) => (
          <li key={alert.id}>
            <button
              type="button"
              data-testid="alert-list-item"
              data-alert-id={alert.id}
              aria-label={`${alert.parcel_id}, ${alert.tier} alert, ${alert.status.replaceAll("_", " ")}`}
              onClick={() => onSelect?.(alert)}
              className={`flex w-full flex-col gap-1 border-b border-gray-100 px-4 py-3 text-left transition-colors hover:bg-gray-50 ${
                selectedAlertId === alert.id ? "bg-gov/5" : ""
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <TierChip tier={alert.tier} />
                <span className="text-xs text-gray-400">
                  {ageFromNow(alert.detected_at)}
                </span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium text-gray-900">
                  {alert.parcel_id}
                </span>
                <span className="text-gray-500">
                  Severity {alert.severity_score}
                </span>
              </div>
            </button>
          </li>
        ))}
        {sorted.length === 0 && (
          <li className="px-4 py-8 text-center text-sm text-slate-500">
            No unresolved alerts in this jurisdiction.
          </li>
        )}
      </ul>
    </aside>
  );
}
