import type { Alert, Case, Parcel } from "@/lib/types";

export interface KpiStripProps {
  parcels: Parcel[];
  alerts: Alert[];
  cases: Case[];
}

// Case states that mean the case is no longer actively moving through the
// due-process pipeline. Everything else (including states not yet present
// in the CaseState union, e.g. legacy/backend-only states) counts as "in
// due process".
const NOT_IN_DUE_PROCESS = new Set([
  "CLOSED",
  "DISMISSED_FALSE_POSITIVE",
  "LEGACY_REFERRED",
]);

interface KpiTile {
  testId: string;
  label: string;
  value: number;
}

export function KpiStrip({ parcels, alerts, cases }: KpiStripProps) {
  const openAlerts = alerts.filter((a) => a.status === "open").length;
  const redAlerts = alerts.filter((a) => a.tier === "red").length;
  const casesInDueProcess = cases.filter(
    (c) => !NOT_IN_DUE_PROCESS.has(c.state)
  ).length;

  const tiles: KpiTile[] = [
    {
      testId: "kpi-parcels-monitored",
      label: "Parcels monitored",
      value: parcels.length,
    },
    {
      testId: "kpi-open-alerts",
      label: "Open alerts",
      value: openAlerts,
    },
    {
      testId: "kpi-red-alerts",
      label: "Red alerts",
      value: redAlerts,
    },
    {
      testId: "kpi-cases-in-due-process",
      label: "Cases in due process",
      value: casesInDueProcess,
    },
  ];

  return (
    <div
      data-testid="kpi-strip"
      className="flex flex-row gap-3 rounded bg-white/90 px-3 py-2 shadow"
    >
      {tiles.map((tile) => (
        <div
          key={tile.testId}
          data-testid={tile.testId}
          className="flex flex-col items-center px-2 text-center"
        >
          <span className="text-xs text-gray-600">{tile.label}</span>
          <span className="text-lg font-semibold text-gray-900">
            {tile.value}
          </span>
        </div>
      ))}
    </div>
  );
}
