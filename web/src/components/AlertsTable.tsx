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
import {
  LAND_CATEGORY_LABELS,
  type Alert,
  type AlertStatus,
  type AlertTier,
  type Case,
  type Parcel,
} from "@/lib/types";

export interface AlertsTableProps {
  alerts: Alert[];
  parcels?: Parcel[];
  /** Lookup from alert id to its case, used to render a "Case" action link. */
  casesByAlertId?: Map<string, Case>;
}

const TIER_OPTIONS: (AlertTier | "all")[] = ["all", "red", "amber", "green", "legacy"];
const STATUS_OPTIONS: (AlertStatus | "all")[] = [
  "all",
  "open",
  "under_review",
  "escalated",
  "closed",
];

const TIER_BAR_CLASSES: Record<AlertTier, string> = {
  green: "bg-tier-green",
  amber: "bg-tier-amber",
  red: "bg-tier-red",
  legacy: "bg-tier-legacy",
};

/** "Waterbody · Grade A" style secondary line for a resolved parcel. */
function parcelSecondaryLine(parcel: Parcel): string {
  return `${LAND_CATEGORY_LABELS[parcel.land_category]} · Grade ${parcel.boundary_grade}`;
}

/**
 * Every display value for one alert, computed once so the desktop `<table>`
 * row and the mobile card render identical data/formatting instead of two
 * copies that can drift apart. Only the surrounding markup differs between
 * AlertTableRow and AlertCard below — this holds the shared derivation.
 */
interface AlertRowFields {
  parcelHref: string;
  /** Resolved parcel's survey number when a parcel lookup is available and
   * matches; falls back to the raw parcel id otherwise. */
  parcelLabel: string;
  /** "Waterbody · Grade A" style line, only when the parcel resolved. */
  parcelSecondary?: string;
  severity: number;
  severityBarWidth: number;
  tierBarClass: string;
  areaLabel: string;
  statusLabel: string;
  statusTitle: string;
  ageLabel: string;
  mapHref: string;
  /** Present only when a case exists for this alert. */
  caseHref?: string;
}

function deriveAlertRow(
  alert: Alert,
  parcelsById: Map<string, Parcel>,
  casesByAlertId?: Map<string, Case>
): AlertRowFields {
  const parcel = parcelsById.get(alert.parcel_id);
  const caseForAlert = casesByAlertId?.get(alert.id);
  return {
    parcelHref: `/parcels/${alert.parcel_id}`,
    parcelLabel: parcel ? parcel.survey_no : alert.parcel_id,
    parcelSecondary: parcel ? parcelSecondaryLine(parcel) : undefined,
    severity: Math.round(alert.severity_score),
    severityBarWidth: Math.min(100, Math.max(0, alert.severity_score)),
    tierBarClass: TIER_BAR_CLASSES[alert.tier],
    areaLabel: alert.area_m2.toLocaleString(),
    statusLabel: alert.status.replace("_", " "),
    statusTitle: ALERT_STATUS_DESCRIPTIONS[alert.status],
    ageLabel: ageFromNow(alert.detected_at),
    mapHref: `/console?alert=${alert.id}`,
    caseHref: caseForAlert ? `/cases/${caseForAlert.id}` : undefined,
  };
}

const PARCEL_LINK_CLASSES =
  "text-gov underline-offset-2 hover:underline focus:outline-none focus:ring-2 focus:ring-gov/30";
const ACTION_LINK_CLASSES =
  "text-gov hover:underline focus:outline-none focus:ring-2 focus:ring-gov/30";

/** Decorative severity bar tinted by tier; the numeric score next to it is
 * the accessible value, so the bar itself is aria-hidden. Shared by the
 * table row and the card so both presentations agree on the visualization. */
function SeverityBar({ tier, tierBarClass, width }: { tier: AlertTier; tierBarClass: string; width: number }) {
  return (
    <span className="flex items-center gap-2">
      <span
        aria-hidden="true"
        data-testid="severity-bar"
        data-tier={tier}
        className="inline-block h-1.5 w-16 overflow-hidden rounded-full bg-gray-100"
      >
        <span
          className={`block h-full rounded-full ${tierBarClass}`}
          style={{ width: `${width}%` }}
        />
      </span>
    </span>
  );
}

/** Parcel-record / view-on-map / case action links, shared by the table row
 * and the card so neither presentation is missing an action the other has. */
function AlertActions({ f }: { f: AlertRowFields }) {
  return (
    <div className="flex flex-wrap items-center gap-3 text-xs">
      <Link href={f.parcelHref} className={ACTION_LINK_CLASSES}>
        Parcel record
      </Link>
      <Link href={f.mapHref} className={ACTION_LINK_CLASSES}>
        View on map
      </Link>
      {f.caseHref && (
        <Link
          href={f.caseHref}
          className="rounded-full bg-gov/10 px-2 py-0.5 font-medium text-gov hover:bg-gov/20 focus:outline-none focus:ring-2 focus:ring-gov/30"
        >
          Case
        </Link>
      )}
    </div>
  );
}

function AlertTableRow({
  alert,
  parcelsById,
  casesByAlertId,
}: {
  alert: Alert;
  parcelsById: Map<string, Parcel>;
  casesByAlertId?: Map<string, Case>;
}) {
  const f = deriveAlertRow(alert, parcelsById, casesByAlertId);
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
          {f.parcelLabel}
        </Link>
        {f.parcelSecondary && (
          <div className="mt-0.5 text-xs font-normal text-gray-500">
            {f.parcelSecondary}
          </div>
        )}
      </td>
      <td className="px-4 py-2">
        <div className="flex items-center gap-2">
          <span>{f.severity}</span>
          <SeverityBar tier={alert.tier} tierBarClass={f.tierBarClass} width={f.severityBarWidth} />
        </div>
      </td>
      <td className="px-4 py-2">{f.areaLabel}</td>
      <td className="px-4 py-2 capitalize" title={f.statusTitle}>
        {f.statusLabel}
      </td>
      <td className="px-4 py-2 text-gray-500">{f.ageLabel}</td>
      <td className="px-4 py-2">
        <AlertActions f={f} />
      </td>
    </tr>
  );
}

/** One alert's card presentation for narrow screens (< sm). Uses the same
 * `deriveAlertRow` values as AlertTableRow so every column the table shows
 * — including the parcel's resolved survey/grade line, the severity bar,
 * and the action links — is reachable here too; nothing is dropped on
 * mobile, just re-laid-out as a labeled list instead of table cells. */
function AlertCard({
  alert,
  parcelsById,
  casesByAlertId,
}: {
  alert: Alert;
  parcelsById: Map<string, Parcel>;
  casesByAlertId?: Map<string, Case>;
}) {
  const f = deriveAlertRow(alert, parcelsById, casesByAlertId);
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
            {f.parcelLabel}
          </Link>
          {f.parcelSecondary && (
            <span className="text-xs text-gray-500">{f.parcelSecondary}</span>
          )}
        </div>
        <span className="shrink-0 text-xs text-gray-500">{f.ageLabel}</span>
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
        <div>
          <dt className="text-xs uppercase tracking-wide text-gray-500" title={SEVERITY_EXPLANATION}>
            Severity
          </dt>
          <dd className="flex items-center gap-2 font-medium text-gray-900">
            <span>{f.severity}</span>
            <SeverityBar tier={alert.tier} tierBarClass={f.tierBarClass} width={f.severityBarWidth} />
          </dd>
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
        <div className="col-span-2">
          <dt className="text-xs uppercase tracking-wide text-gray-500">Actions</dt>
          <dd className="mt-1">
            <AlertActions f={f} />
          </dd>
        </div>
      </dl>
    </li>
  );
}

export function AlertsTable({
  alerts,
  parcels = [],
  casesByAlertId,
}: AlertsTableProps) {
  const parcelsById = useMemo(
    () => new Map(parcels.map((parcel) => [parcel.id, parcel])),
    [parcels]
  );
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
              <th className="px-4 py-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((alert) => (
              <AlertTableRow
                key={alert.id}
                alert={alert}
                parcelsById={parcelsById}
                casesByAlertId={casesByAlertId}
              />
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-center text-gray-400">
                  No alerts match the current filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <ul data-testid="alerts-card-list" className="flex flex-col gap-3 sm:hidden">
        {filtered.map((alert) => (
          <AlertCard
            key={alert.id}
            alert={alert}
            parcelsById={parcelsById}
            casesByAlertId={casesByAlertId}
          />
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
