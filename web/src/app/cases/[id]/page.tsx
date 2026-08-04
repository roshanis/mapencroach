import Link from "next/link";
import { notFound } from "next/navigation";
import {
  getAlertForRequest,
  getCaseForRequest,
  getParcelForRequest,
  getPersonaRoleForRequest,
} from "@/lib/server-api";
import { STATE_DESCRIPTIONS } from "@/lib/explanations";
import { formatDuration } from "@/lib/format";
import { canDraftNotice } from "@/lib/notice-gate";
import { CASE_STATE_CHAIN, LAND_CATEGORY_LABELS, STATE_LABELS } from "@/lib/types";
import { EventTimeline } from "@/components/EventTimeline";
import { EvidenceManifest } from "@/components/EvidenceManifest";
import { NoticeDraftWorkspace } from "@/components/NoticeDraftWorkspace";
import { StateRail } from "@/components/StateRail";
import { TierChip } from "@/components/TierChip";
import { TopBar } from "@/components/TopBar";
import { TransitionPanel } from "@/components/TransitionPanel";

export const dynamic = "force-dynamic";

function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleString("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

/** Whole days elapsed since an ISO timestamp; null if the timestamp is absent/invalid. */
function daysSince(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return null;
  return Math.max(0, Math.floor((Date.now() - then) / (24 * 60 * 60 * 1000)));
}

export default async function CaseDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const caseRecord = await getCaseForRequest(id);

  if (!caseRecord) {
    notFound();
  }

  const [alert, parcel, personaRole] = await Promise.all([
    getAlertForRequest(caseRecord.alert_id),
    getParcelForRequest(caseRecord.parcel_id),
    getPersonaRoleForRequest(),
  ]);
  const canDraft = canDraftNotice({ role: personaRole, state: caseRecord.state });

  // The detail endpoint omits state_since (the list endpoint has it); the
  // last event's timestamp is the same instant by construction.
  const lastEvent = caseRecord.events[caseRecord.events.length - 1];
  const daysInStage = daysSince(caseRecord.state_since ?? lastEvent?.occurred_at);
  const firstEvent = caseRecord.events[0];

  return (
    <div className="flex min-h-screen flex-col">
      <TopBar />
      <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 p-6">
        <div>
          <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-2 text-sm text-slate-500">
            <Link href="/cases" className="text-gov hover:underline">Cases</Link>
            <span aria-hidden>/</span>
            <Link href={`/parcels/${caseRecord.parcel_id}`} className="text-gov hover:underline">
              {caseRecord.parcel_id}
            </Link>
            <span aria-hidden>/</span>
            <span aria-current="page">{caseRecord.id}</span>
          </nav>
          <h1 className="mt-2 text-xl font-semibold text-gray-900">
            Case {caseRecord.id}
          </h1>
          <p className="text-sm text-gray-500">
            Linked alert {caseRecord.alert_id} &middot; Parcel{" "}
            {caseRecord.parcel_id}
          </p>
        </div>

        <section
          data-testid="case-summary"
          className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm"
        >
          <h2 className="mb-4 text-base font-semibold text-gray-900">
            Case Summary
          </h2>
          <dl className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-3 lg:grid-cols-5">
            <div>
              <dt className="text-xs uppercase tracking-wide text-gray-500">
                Parcel
              </dt>
              <dd className="mt-1 font-medium text-gray-900">
                {parcel ? (
                  <Link
                    href={`/parcels/${parcel.id}`}
                    className="text-gov hover:underline"
                  >
                    {parcel.survey_no}
                  </Link>
                ) : (
                  caseRecord.parcel_id
                )}
              </dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-gray-500">
                Land category
              </dt>
              <dd className="mt-1 font-medium text-gray-900">
                {parcel ? LAND_CATEGORY_LABELS[parcel.land_category] : "—"}
              </dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-gray-500">
                Alert
              </dt>
              <dd className="mt-1 flex items-center gap-2">
                {alert ? (
                  <>
                    <TierChip tier={alert.tier} />
                    <span className="font-medium text-gray-900">
                      {Math.round(alert.severity_score)}
                    </span>
                  </>
                ) : (
                  <span className="font-medium text-gray-900">—</span>
                )}
              </dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-gray-500">
                Days in stage
              </dt>
              <dd className="mt-1 font-medium text-gray-900">
                {daysInStage === null ? "—" : formatDuration(daysInStage)}
              </dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-gray-500">
                Started
              </dt>
              <dd className="mt-1 font-medium text-gray-900">
                {firstEvent ? formatTimestamp(firstEvent.occurred_at) : "—"}
              </dd>
            </div>
          </dl>
        </section>

        <section className="overflow-x-auto rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
          <h2 className="mb-6 text-base font-semibold text-gray-900">
            Due-Process Progress
          </h2>
          <StateRail currentState={caseRecord.state} />
          <details className="mt-4 text-xs text-gray-500">
            <summary className="cursor-pointer text-gov">
              What do these steps mean?
            </summary>
            <ul className="mt-2 flex flex-col gap-2">
              {CASE_STATE_CHAIN.map((state) => (
                <li key={state}>
                  <span className="font-medium text-gray-700">
                    {STATE_LABELS[state]}:
                  </span>{" "}
                  {STATE_DESCRIPTIONS[state]}
                </li>
              ))}
            </ul>
          </details>
        </section>

        <section className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
          <h2 className="mb-4 text-base font-semibold text-gray-900">
            Take the next legal step
          </h2>
          <p className="text-sm text-slate-600">
            Only actions permitted from the current stage are available. Required evidence is shown before submission.
          </p>
          <TransitionPanel
            caseId={caseRecord.id}
            allowedTransitions={caseRecord.allowed_transitions ?? []}
            requiredArtifacts={caseRecord.required_artifacts ?? {}}
          />
        </section>

        {parcel && canDraft && (
          <NoticeDraftWorkspace
            caseRecord={caseRecord}
            parcel={parcel}
            alert={alert}
          />
        )}

        <section className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
          <h2 className="mb-4 text-base font-semibold text-gray-900">
            Event History
          </h2>
          <EventTimeline events={caseRecord.events} />
        </section>

        <section className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
          <h2 className="mb-4 text-base font-semibold text-gray-900">
            Evidence Packet
          </h2>
          <EvidenceManifest events={caseRecord.events} />
          <Link
            href={`/cases/${caseRecord.id}/evidence-packet`}
            className="mt-4 inline-flex rounded-md border border-gov/30 bg-white px-4 py-2 text-sm font-semibold text-gov hover:bg-gov/5 focus:outline-none focus:ring-2 focus:ring-gov focus:ring-offset-2"
          >
            Open print-ready packet
          </Link>
        </section>
      </main>
    </div>
  );
}
