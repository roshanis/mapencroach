import { EvidenceManifest } from "./EvidenceManifest";
import { EventTimeline } from "./EventTimeline";
import { CaseStateChip } from "./CaseStateChip";
import { TierChip } from "./TierChip";
import type { Alert, Case, Parcel } from "@/lib/types";

export interface EvidencePacketDocumentProps {
  caseRecord: Case;
  parcel?: Parcel;
  alert?: Alert;
}

function formatDate(iso: string | undefined): string {
  if (!iso) return "Not recorded";
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return iso;
  return parsed.toLocaleString("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export function EvidencePacketDocument({
  caseRecord,
  parcel,
  alert,
}: EvidencePacketDocumentProps) {
  const artifactCount = caseRecord.events.reduce(
    (total, event) => total + event.artifacts.length,
    0
  );
  const openedAt = caseRecord.events[0]?.occurred_at;
  const updatedAt = caseRecord.events[caseRecord.events.length - 1]?.occurred_at;

  return (
    <article
      data-print-document="true"
      className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm print:border-0 print:p-0 print:shadow-none"
    >
      <header className="border-b border-gray-200 pb-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-gov">
              Mapencroach case record
            </p>
            <h1 className="mt-2 text-2xl font-semibold text-gray-950">
              Evidence packet
            </h1>
            <p className="mt-1 text-sm font-medium text-gray-700">
              Case {caseRecord.id}
            </p>
          </div>
          <span className="rounded-full border border-amber-300 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-900">
            Draft packet
          </span>
        </div>
        <p className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm leading-6 text-amber-950">
          Compiled from the current case record. This packet is not digitally signed or legally certified. A legal officer must review the source records and complete the applicable certificate workflow before reliance.
        </p>
      </header>

      <section className="py-5">
        <h2 className="text-base font-semibold text-gray-900">Record summary</h2>
        <dl className="mt-4 grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <dt className="text-xs uppercase tracking-wide text-gray-500">Case stage</dt>
            <dd className="mt-1"><CaseStateChip state={caseRecord.state} /></dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-gray-500">Parcel</dt>
            <dd className="mt-1 font-medium text-gray-900">{parcel?.id ?? caseRecord.parcel_id}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-gray-500">Survey number</dt>
            <dd className="mt-1 font-medium text-gray-900">{parcel?.survey_no ?? "Not available"}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-gray-500">
              {parcel?.parcel_id_scheme ?? "ULPIN"}
            </dt>
            <dd className="mt-1 font-medium text-gray-900">{parcel?.ulpin ?? "Not available"}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-gray-500">Alert</dt>
            <dd className="mt-1 flex items-center gap-2 font-medium text-gray-900">
              {alert ? <><TierChip tier={alert.tier} /> {Math.round(alert.severity_score)}</> : caseRecord.alert_id}
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-gray-500">Opened</dt>
            <dd className="mt-1 font-medium text-gray-900">{formatDate(openedAt)}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-gray-500">Last event</dt>
            <dd className="mt-1 font-medium text-gray-900">{formatDate(updatedAt)}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-gray-500">Artifact references</dt>
            <dd className="mt-1 font-medium text-gray-900">{artifactCount}</dd>
          </div>
        </dl>
      </section>

      <section className="border-t border-gray-200 py-5">
        <h2 className="mb-4 text-base font-semibold text-gray-900">Evidence manifest</h2>
        <EvidenceManifest events={caseRecord.events} />
      </section>

      <section className="border-t border-gray-200 py-5">
        <h2 className="mb-4 text-base font-semibold text-gray-900">Case chronology</h2>
        <EventTimeline events={caseRecord.events} />
      </section>

      <section className="border-t border-gray-200 pt-5">
        <h2 className="text-base font-semibold text-gray-900">Certificate readiness</h2>
        <ul className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
          <li className="flex gap-2 rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-emerald-900">
            <span aria-hidden>✓</span><span>Manifest compiled from case events</span>
          </li>
          <li className="flex gap-2 rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-emerald-900">
            <span aria-hidden>✓</span><span>{artifactCount} artifact reference{artifactCount === 1 ? "" : "s"} listed</span>
          </li>
          <li className="flex gap-2 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-amber-900">
            <span aria-hidden>○</span><span>Legal officer review pending</span>
          </li>
          <li className="flex gap-2 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-amber-900">
            <span aria-hidden>○</span><span>Digital signature pending</span>
          </li>
        </ul>
      </section>
    </article>
  );
}
