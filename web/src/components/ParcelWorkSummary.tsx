import Link from "next/link";
import { BoundaryGradeBadge } from "./BoundaryGradeBadge";
import { TierChip } from "./TierChip";
import {
  SPECIAL_STATE_LABELS,
  STATE_LABELS,
  TERMINAL_STATES,
  type Alert,
  type AnyCaseState,
  type Case,
  type Parcel,
} from "@/lib/types";

export interface ParcelWorkSummaryProps {
  parcel: Parcel;
  alerts: Alert[];
  cases: Case[];
}

const ACTION_LABELS: Record<string, string> = {
  RESPONSE_WINDOW: "Open response window",
  DISMISSED_FALSE_POSITIVE: "Dismiss false positive",
  LEGACY_REFERRED: "Refer to legacy process",
  SURVEY_REQUESTED: "Request boundary survey",
  STAYED_BY_COURT: "Record court stay",
};

function stateLabel(state: AnyCaseState): string {
  if (state in SPECIAL_STATE_LABELS) {
    return SPECIAL_STATE_LABELS[state as keyof typeof SPECIAL_STATE_LABELS];
  }
  return STATE_LABELS[state as keyof typeof STATE_LABELS];
}

function actionLabel(state: string): string {
  return (
    ACTION_LABELS[state] ??
    state
      .toLowerCase()
      .replaceAll("_", " ")
      .replace(/^\w/, (letter) => letter.toUpperCase())
  );
}

export function ParcelWorkSummary({
  parcel,
  alerts,
  cases,
}: ParcelWorkSummaryProps) {
  const activeAlert = [...alerts]
    .filter((alert) => alert.status !== "closed")
    .sort((a, b) => b.severity_score - a.severity_score)[0];
  const activeCase = cases.find((item) => !TERMINAL_STATES.has(item.state));

  if (!activeAlert && !activeCase) {
    return (
      <section className="rounded-lg border border-emerald-200 bg-emerald-50 p-5">
        <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">
          Current work
        </p>
        <h2 className="mt-1 text-base font-semibold text-emerald-950">
          No active enforcement work
        </h2>
        <p className="mt-1 text-sm text-emerald-800">
          This parcel has no unresolved alert or active due-process case.
        </p>
      </section>
    );
  }

  const nextTransition = activeCase?.allowed_transitions?.[0];
  const nextAction =
    parcel.boundary_grade === "C"
      ? "Survey boundary before legal notice"
      : nextTransition
        ? actionLabel(nextTransition)
        : activeAlert?.status === "open"
          ? "Review satellite detection"
          : activeAlert && !activeCase
            ? "Open a due-process case"
            : "Review the case record";

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-gov">
            Current work
          </p>
          <h2 className="mt-1 text-lg font-semibold text-slate-950">
            {activeAlert?.tier === "red"
              ? "Urgent alert"
              : activeAlert
                ? "Alert needs review"
                : "Active due-process case"}
          </h2>
        </div>
        <BoundaryGradeBadge grade={parcel.boundary_grade} />
      </div>

      <dl className="mt-5 grid gap-4 sm:grid-cols-3">
        <div>
          <dt className="text-xs uppercase tracking-wide text-slate-500">Risk</dt>
          <dd className="mt-1 flex items-center gap-2 text-sm font-medium text-slate-900">
            {activeAlert ? (
              <>
                <TierChip tier={activeAlert.tier} />
                Severity {activeAlert.severity_score}
              </>
            ) : (
              "No unresolved alert"
            )}
          </dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-slate-500">Case stage</dt>
          <dd className="mt-1 text-sm font-medium text-slate-900">
            {activeCase ? stateLabel(activeCase.state) : "No case opened"}
          </dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-slate-500">Next action</dt>
          <dd className="mt-1 text-sm font-semibold text-gov">{nextAction}</dd>
        </div>
      </dl>

      {activeCase && (
        <Link
          href={`/cases/${activeCase.id}`}
          className="mt-5 inline-flex rounded-md bg-gov px-4 py-2 text-sm font-semibold text-white hover:bg-gov-dark focus:outline-none focus:ring-2 focus:ring-gov focus:ring-offset-2"
        >
          Open active case
        </Link>
      )}
    </section>
  );
}
