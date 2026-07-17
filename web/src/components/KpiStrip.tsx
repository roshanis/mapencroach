import { TERMINAL_STATES, type Alert, type Case, type Parcel } from "@/lib/types";

export interface KpiStripProps {
  parcels: Parcel[];
  alerts: Alert[];
  cases: Case[];
}

interface KpiTile {
  testId: string;
  label: string;
  value: number;
}

export function KpiStrip({ parcels, alerts, cases }: KpiStripProps) {
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
      className="grid grid-cols-2 gap-x-3 gap-y-2 rounded bg-white/90 px-3 py-2 shadow sm:flex sm:flex-row"
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
