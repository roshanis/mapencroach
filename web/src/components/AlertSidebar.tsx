"use client";

import { TierChip } from "./TierChip";
import { ageFromNow, sortBySeverityDesc } from "@/lib/format";
import type { Alert } from "@/lib/types";

export interface AlertSidebarProps {
  alerts: Alert[];
  onSelect?: (alert: Alert) => void;
  selectedAlertId?: string;
}

export function AlertSidebar({
  alerts,
  onSelect,
  selectedAlertId,
}: AlertSidebarProps) {
  const sorted = sortBySeverityDesc(alerts);

  return (
    <aside
      data-testid="alert-sidebar"
      className="flex h-full w-80 shrink-0 flex-col border-r border-gray-200 bg-white"
    >
      <div className="border-b border-gray-200 px-4 py-3">
        <h2 className="text-sm font-semibold text-gray-900">Active Alerts</h2>
        <p className="text-xs text-gray-500">{alerts.length} total</p>
      </div>
      <ul className="flex-1 overflow-y-auto">
        {sorted.map((alert) => (
          <li key={alert.id}>
            <button
              type="button"
              data-testid="alert-list-item"
              data-alert-id={alert.id}
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
      </ul>
    </aside>
  );
}
