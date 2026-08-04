import { TERMINAL_STATES, type Alert, type Case, type Parcel } from "@/lib/types";

export interface KpiStripProps {
  parcels: Parcel[];
  alerts: Alert[];
  cases: Case[];
  /**
   * "floating" (default) is the compact flex row used when the strip floats
   * over the map on lg+ viewports. "compact" is a plain 2x2 grid meant to
   * sit in normal document flow above the map on smaller viewports.
   */
  variant?: "floating" | "compact";
}

interface KpiTile {
  testId: string;
  label: string;
  value: number;
}

const FLOATING_CLASSES =
  "grid grid-cols-2 gap-x-3 gap-y-2 rounded bg-white/90 px-3 py-2 shadow sm:flex sm:flex-row";
const COMPACT_CLASSES =
  "grid grid-cols-2 gap-x-3 gap-y-2 rounded-lg border border-slate-200 bg-white px-3 py-3";

export function KpiStrip({
  parcels,
  alerts,
  cases,
  variant = "floating",
}: KpiStripProps) {
  const openAlerts = alerts.filter((a) => a.status === "open").length;
  const redAlerts = alerts.filter(
    (a) => a.tier === "red" && a.status !== "closed"
  ).length;
  const casesInDueProcess = cases.filter(
    (c) => !TERMINAL_STATES.has(c.state)
  ).length;

  const tiles: KpiTile[] = [
    {
      testId: "kpi-parcels-monitored",
      label: "Parcels monitored",
      value: parcels.length,
    },
    {
      testId: "kpi-open-alerts",
      label: "Needs triage",
      value: openAlerts,
    },
    {
      testId: "kpi-red-alerts",
      label: "Urgent alerts",
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
      className={variant === "compact" ? COMPACT_CLASSES : FLOATING_CLASSES}
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
