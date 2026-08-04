"use client";

import { useMemo, type ReactNode } from "react";
import Link from "next/link";
import { TierChip } from "./TierChip";
import { ageFromNow, sortBySeverityDesc } from "@/lib/format";
import { LAND_CATEGORY_LABELS, type Alert, type Case, type Parcel } from "@/lib/types";

export interface AlertSidebarProps {
  alerts: Alert[];
  parcels?: Parcel[];
  onSelect?: (alert: Alert) => void;
  selectedAlertId?: string;
  summary?: ReactNode;
  mobileOpen?: boolean;
  onMobileClose?: () => void;
  /** Lookup from alert id to its case, used to render a "Case" quick-action chip. */
  casesByAlertId?: Map<string, Case>;
}

/** "Waterbody · Grade A" style secondary line for a resolved parcel. */
function parcelSecondaryLine(parcel: Parcel): string {
  return `${LAND_CATEGORY_LABELS[parcel.land_category]} · Grade ${parcel.boundary_grade}`;
}

export function AlertSidebar({
  alerts,
  parcels = [],
  onSelect,
  selectedAlertId,
  summary,
  mobileOpen = false,
  onMobileClose,
  casesByAlertId,
}: AlertSidebarProps) {
  const parcelsById = useMemo(
    () => new Map(parcels.map((parcel) => [parcel.id, parcel])),
    [parcels]
  );
  const sorted = sortBySeverityDesc(
    alerts.filter((alert) => alert.status !== "closed")
  );

  return (
    <>
      {/* Below md, the sidebar becomes a floating overlay rather than a
          layout column (see the aside's classes) — this backdrop makes
          that legible as a modal: it dims the map underneath, and gives a
          tap-anywhere-outside way to close the panel instead of only the
          small × button. It only exists (and is only in the a11y tree)
          while the panel is actually open. */}
      {mobileOpen && (
        <div
          data-testid="alert-sidebar-backdrop"
          aria-hidden="true"
          onClick={onMobileClose}
          className="fixed inset-0 z-[25] bg-slate-900/40 md:hidden"
        />
      )}
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
              className="flex min-h-11 min-w-11 items-center justify-center rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 md:hidden"
            >
              ×
            </button>
          )}
        </div>
        <ul className="flex-1 overflow-y-auto">
          {sorted.map((alert) => {
            const parcel = parcelsById.get(alert.parcel_id);
            const caseForAlert = casesByAlertId?.get(alert.id);
            return (
              <li key={alert.id}>
                <div
                  role="button"
                  tabIndex={0}
                  data-testid="alert-list-item"
                  data-alert-id={alert.id}
                  aria-label={`${alert.parcel_id}, ${alert.tier} alert, ${alert.status.replaceAll("_", " ")}`}
                  onClick={() => onSelect?.(alert)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      onSelect?.(alert);
                    }
                  }}
                  className={`flex w-full cursor-pointer flex-col gap-1 border-b border-gray-100 px-4 py-3 text-left transition-colors hover:bg-gray-50 ${
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
                      {parcel ? parcel.survey_no : alert.parcel_id}
                    </span>
                    <span className="text-gray-500">
                      Severity {Math.round(alert.severity_score)}
                    </span>
                  </div>
                  {parcel && (
                    <span className="text-xs text-gray-500">
                      {parcelSecondaryLine(parcel)}
                    </span>
                  )}
                  <div className="mt-1 flex items-center gap-3 text-xs">
                    <Link
                      href={`/parcels/${alert.parcel_id}`}
                      onClick={(event) => event.stopPropagation()}
                      className="text-gov hover:underline focus:outline-none focus:ring-2 focus:ring-gov/30"
                    >
                      Parcel &rarr;
                    </Link>
                    {caseForAlert && (
                      <Link
                        href={`/cases/${caseForAlert.id}`}
                        onClick={(event) => event.stopPropagation()}
                        className="rounded-full bg-gov/10 px-2 py-0.5 font-medium text-gov hover:bg-gov/20 focus:outline-none focus:ring-2 focus:ring-gov/30"
                      >
                        Case
                      </Link>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
          {sorted.length === 0 && (
            <li className="px-4 py-8 text-center text-sm text-slate-500">
              No unresolved alerts in this jurisdiction.
            </li>
          )}
        </ul>
      </aside>
    </>
  );
}
