import { parseArtifact } from "@/lib/format";
import { STATE_LABELS, type CaseEvent } from "@/lib/types";

export interface EvidenceManifestProps {
  events: CaseEvent[];
}

interface ManifestRow {
  key: string;
  kind: string;
  value: string;
  step: string;
  date: string;
  actor: string;
}

function formatDate(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return iso;
  return parsed.toLocaleDateString("en-IN", { dateStyle: "medium" });
}

function stepLabel(event: CaseEvent): string {
  return STATE_LABELS[event.to_state] ?? event.to_state;
}

/** One manifest row per artifact, across all events, in chain order. */
function buildManifest(events: CaseEvent[]): ManifestRow[] {
  const rows: ManifestRow[] = [];
  events.forEach((event, eventIndex) => {
    event.artifacts.forEach((raw, artifactIndex) => {
      const { kind, value } = parseArtifact(raw);
      rows.push({
        key: `${eventIndex}-${artifactIndex}`,
        kind,
        value,
        step: stepLabel(event),
        date: formatDate(event.occurred_at),
        actor: event.actor,
      });
    });
  });
  return rows;
}

function DocumentGlyph() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 20 20"
      fill="none"
      className="h-4 w-4 text-gray-400"
    >
      <path
        d="M5 2.5h6.5L15 6v11a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V3.5a1 1 0 0 1 1-1Z"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
      <path
        d="M11.5 2.5V6H15"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
      <path
        d="M6.5 10h6M6.5 12.5h6M6.5 15h3.5"
        stroke="currentColor"
        strokeWidth="1"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function EvidenceManifest({ events }: EvidenceManifestProps) {
  const rows = buildManifest(events);

  if (rows.length === 0) {
    return (
      <div
        data-testid="evidence-manifest"
        className="flex h-28 items-center justify-center rounded border border-dashed border-gray-300 text-sm text-gray-400"
      >
        No artifacts recorded yet.
      </div>
    );
  }

  return (
    <div data-testid="evidence-manifest" className="flex flex-col gap-3">
      <div className="overflow-x-auto rounded-lg border border-gray-200">
        <table className="w-full min-w-[36rem] border-collapse text-sm">
          <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
            <tr>
              <th className="w-8 px-3 py-2" aria-hidden />
              <th className="px-3 py-2">Kind</th>
              <th className="px-3 py-2">Reference</th>
              <th className="px-3 py-2">Recorded at</th>
              <th className="px-3 py-2">Date</th>
              <th className="px-3 py-2">Actor</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.key}
                data-testid="evidence-manifest-row"
                className="border-t border-gray-100"
              >
                <td className="px-3 py-2">
                  <DocumentGlyph />
                </td>
                <td className="px-3 py-2 font-medium text-gray-900">
                  {row.kind}
                </td>
                <td className="px-3 py-2 text-gray-700">{row.value}</td>
                <td className="px-3 py-2 text-gray-500">{row.step}</td>
                <td className="px-3 py-2 text-gray-500">{row.date}</td>
                <td className="px-3 py-2 text-gray-500">{row.actor}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-gray-400">
        Compiled from the case record. References remain subject to source-record review and legal certification.
      </p>
    </div>
  );
}
