import { PAUSED_STATES, TERMINAL_STATES } from "@/lib/types";
import type { Alert, Case, Parcel } from "@/lib/types";

export interface WorkbenchSummaryProps {
  role?: string;
  parcels: Parcel[];
  alerts: Alert[];
  cases: Case[];
}

interface SummaryMetric {
  label: string;
  value: number;
}

function roleSummary(
  role: string,
  parcels: Parcel[],
  alerts: Alert[],
  cases: Case[]
): { title: string; description: string; metrics: SummaryMetric[] } {
  const unresolved = alerts.filter((alert) => alert.status !== "closed");
  const urgent = unresolved.filter((alert) => alert.tier === "red").length;
  const activeCases = cases.filter((item) => !TERMINAL_STATES.has(item.state));

  if (role === "survey_officer") {
    return {
      title: "Survey workbench",
      description: "Boundary confidence and paused surveys in your jurisdiction.",
      metrics: [
        {
          label: "Grade C boundaries",
          value: parcels.filter((parcel) => parcel.boundary_grade === "C").length,
        },
        {
          label: "Survey-paused cases",
          value: cases.filter((item) => item.state === "SURVEY_REQUESTED").length,
        },
      ],
    };
  }

  if (role === "viewer" || role === "state_viewer") {
    return {
      title: "Executive overview",
      description: "Risk and due-process movement across your visible estate.",
      metrics: [
        { label: "Monitored parcels", value: parcels.length },
        { label: "Urgent alerts", value: urgent },
      ],
    };
  }

  if (role === "data_admin") {
    return {
      title: "Data quality workbench",
      description: "Records that need stronger cadastral confidence.",
      metrics: [
        {
          label: "Grade C boundaries",
          value: parcels.filter((parcel) => parcel.boundary_grade === "C").length,
        },
        { label: "Monitored parcels", value: parcels.length },
      ],
    };
  }

  return {
    title: role === "enforcement_officer" ? "Enforcement workbench" : "Officer workbench",
    description: "The highest-priority work that can move today.",
    metrics: [
      { label: "Urgent alerts", value: urgent },
      { label: "Active cases", value: activeCases.length },
      {
        label: "Paused cases",
        value: activeCases.filter((item) => PAUSED_STATES.has(item.state)).length,
      },
    ],
  };
}

export function WorkbenchSummary({
  role = "case_officer",
  parcels,
  alerts,
  cases,
}: WorkbenchSummaryProps) {
  const summary = roleSummary(role, parcels, alerts, cases);

  return (
    <section className="border-b border-slate-200 bg-slate-50 px-4 py-4">
      <p className="text-sm font-semibold text-slate-950">{summary.title}</p>
      <p className="mt-1 text-xs leading-5 text-slate-600">
        {summary.description}
      </p>
      <dl className="mt-3 grid grid-cols-2 gap-2">
        {summary.metrics.map((metric) => (
          <div
            key={metric.label}
            className="rounded-md border border-slate-200 bg-white px-3 py-2"
          >
            <dt className="text-[11px] leading-4 text-slate-500">
              {metric.label}
            </dt>
            <dd className="mt-0.5 text-lg font-semibold text-slate-950">
              {metric.value}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
