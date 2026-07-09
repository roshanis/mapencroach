import Link from "next/link";
import { notFound } from "next/navigation";
import { getCase } from "@/lib/api";
import { StateRail } from "@/components/StateRail";
import { TopBar } from "@/components/TopBar";

function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleString("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export default async function CaseDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const caseRecord = await getCase(id);

  if (!caseRecord) {
    notFound();
  }

  return (
    <div className="flex min-h-screen flex-col">
      <TopBar />
      <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 p-6">
        <div>
          <Link
            href={`/parcels/${caseRecord.parcel_id}`}
            className="text-sm text-gov hover:underline"
          >
            &larr; Back to parcel {caseRecord.parcel_id}
          </Link>
          <h1 className="mt-2 text-xl font-semibold text-gray-900">
            Case {caseRecord.id}
          </h1>
          <p className="text-sm text-gray-500">
            Linked alert {caseRecord.alert_id} &middot; Parcel{" "}
            {caseRecord.parcel_id}
          </p>
        </div>

        <section className="overflow-x-auto rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
          <h2 className="mb-6 text-base font-semibold text-gray-900">
            Due-Process Progress
          </h2>
          <StateRail currentState={caseRecord.state} />
        </section>

        <section className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
          <h2 className="mb-4 text-base font-semibold text-gray-900">
            Event History
          </h2>
          <ol data-testid="case-event-history" className="flex flex-col gap-4">
            {caseRecord.events.map((event, idx) => (
              <li
                key={`${event.to_state}-${event.occurred_at}-${idx}`}
                className="flex flex-col gap-1 border-l-2 border-gov/30 pl-4"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-gray-900">
                    {event.from_state
                      ? `${event.from_state.replace(/_/g, " ")} → ${event.to_state.replace(/_/g, " ")}`
                      : `Opened at ${event.to_state.replace(/_/g, " ")}`}
                  </span>
                  <span className="text-xs text-gray-400">
                    {formatTimestamp(event.occurred_at)}
                  </span>
                </div>
                <div className="text-xs text-gray-500">
                  Actor: {event.actor}
                </div>
                {event.note && (
                  <p className="text-sm text-gray-700">{event.note}</p>
                )}
                {event.artifacts.length > 0 && (
                  <ul className="flex flex-wrap gap-2">
                    {event.artifacts.map((artifact) => (
                      <li
                        key={artifact}
                        className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-600"
                      >
                        {artifact}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ol>
        </section>

        <section className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
          <h2 className="mb-4 text-base font-semibold text-gray-900">
            Evidence Packet
          </h2>
          <div
            data-testid="evidence-packet-placeholder"
            className="flex h-28 items-center justify-center rounded border border-dashed border-gray-300 text-sm text-gray-400"
          >
            Evidence packet export (inspection reports, imagery, notices)
            coming soon.
          </div>
        </section>
      </main>
    </div>
  );
}
