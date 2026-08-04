import Link from "next/link";
import { BoundaryGradeBadge } from "./BoundaryGradeBadge";
import { TierChip } from "./TierChip";
import { WatchToggle } from "./WatchToggle";
import { LAND_CATEGORY_LABELS, type Alert, type Case, type Parcel } from "@/lib/types";

export interface SelectedAlertCardProps {
  alert: Alert;
  parcel: Parcel;
  onClose: () => void;
  /** Case linked to this alert, if one has been opened. Shows an "Open case" CTA when present. */
  caseForAlert?: Case;
}

function statusLabel(status: Alert["status"]): string {
  return status
    .split("_")
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(" ");
}

export function SelectedAlertCard({
  alert,
  parcel,
  onClose,
  caseForAlert,
}: SelectedAlertCardProps) {
  return (
    <aside
      aria-label={`Selected alert ${alert.id}`}
      className="absolute bottom-20 left-[max(0.75rem,env(safe-area-inset-left,0px))] right-[max(0.75rem,env(safe-area-inset-right,0px))] z-20 rounded-lg border border-slate-200 bg-white p-4 shadow-xl sm:left-auto sm:right-[max(0.75rem,env(safe-area-inset-right,0px))] sm:w-80"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <TierChip tier={alert.tier} />
            <span className="text-xs font-medium text-slate-500">
              {statusLabel(alert.status)}
            </span>
          </div>
          <p className="mt-2 text-base font-semibold text-slate-950">
            Survey {parcel.survey_no}
          </p>
          <p className="mt-0.5 text-xs text-slate-500">
            {LAND_CATEGORY_LABELS[parcel.land_category]} · Grade{" "}
            {parcel.boundary_grade}
          </p>
        </div>
        <button
          type="button"
          aria-label="Close selected alert"
          onClick={onClose}
          className="flex min-h-11 min-w-11 items-center justify-center rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
        >
          ×
        </button>
      </div>
      <p className="mt-3 text-sm text-slate-700">{parcel.owning_department}</p>
      <div className="mt-3 flex items-center justify-between gap-3">
        <BoundaryGradeBadge grade={parcel.boundary_grade} showExplanation={false} />
        <span className="text-xs text-slate-500">
          Severity {Math.round(alert.severity_score)}
        </span>
      </div>
      <div className="mt-3">
        <WatchToggle alert={alert} />
      </div>
      <div className="mt-4 flex flex-col gap-2">
        <Link
          href={`/parcels/${parcel.id}`}
          className="inline-flex w-full items-center justify-center rounded-md bg-gov px-3 py-2 text-sm font-semibold text-white hover:bg-gov-dark focus:outline-none focus:ring-2 focus:ring-gov focus:ring-offset-2"
        >
          Open parcel record
        </Link>
        {caseForAlert && (
          <Link
            href={`/cases/${caseForAlert.id}`}
            className="inline-flex w-full items-center justify-center rounded-md border border-gov px-3 py-2 text-sm font-semibold text-gov hover:bg-gov/5 focus:outline-none focus:ring-2 focus:ring-gov focus:ring-offset-2"
          >
            Open case &rarr;
          </Link>
        )}
      </div>
    </aside>
  );
}
