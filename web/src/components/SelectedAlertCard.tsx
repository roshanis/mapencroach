import Link from "next/link";
import { BoundaryGradeBadge } from "./BoundaryGradeBadge";
import { TierChip } from "./TierChip";
import type { Alert, Parcel } from "@/lib/types";

export interface SelectedAlertCardProps {
  alert: Alert;
  parcel: Parcel;
  onClose: () => void;
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
}: SelectedAlertCardProps) {
  return (
    <aside
      aria-label={`Selected alert ${alert.id}`}
      className="absolute bottom-20 left-3 right-3 z-20 rounded-lg border border-slate-200 bg-white p-4 shadow-xl sm:left-auto sm:right-3 sm:w-80"
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
          <p className="mt-0.5 text-xs text-slate-500">{parcel.id}</p>
        </div>
        <button
          type="button"
          aria-label="Close selected alert"
          onClick={onClose}
          className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
        >
          ×
        </button>
      </div>
      <p className="mt-3 text-sm text-slate-700">{parcel.owning_department}</p>
      <div className="mt-3 flex items-center justify-between gap-3">
        <BoundaryGradeBadge grade={parcel.boundary_grade} showExplanation={false} />
        <span className="text-xs text-slate-500">
          Severity {alert.severity_score}
        </span>
      </div>
      <Link
        href={`/parcels/${parcel.id}`}
        className="mt-4 inline-flex w-full items-center justify-center rounded-md bg-gov px-3 py-2 text-sm font-semibold text-white hover:bg-gov-dark focus:outline-none focus:ring-2 focus:ring-gov focus:ring-offset-2"
      >
        Open parcel record
      </Link>
    </aside>
  );
}
