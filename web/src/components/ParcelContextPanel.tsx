import type {
  ParcelContext,
  ParcelContextObservation,
  ParcelLineageEdge,
} from "@/lib/types";

interface ParcelContextPanelProps {
  context: ParcelContext | undefined;
}

function confidenceLabel(confidence: number): string {
  return `${Math.round(confidence * 100)}% match confidence`;
}

function observationValue(observation: ParcelContextObservation): string {
  if (typeof observation.value === "boolean") {
    return observation.value ? "Yes" : "No";
  }
  return String(observation.value);
}

function lineageLabel(edge: ParcelLineageEdge): string {
  return edge.relation.replaceAll("_", " ");
}

export function ParcelContextPanel({ context }: ParcelContextPanelProps) {
  return (
    <div className="flex flex-col gap-6">
      <aside className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
        <p className="font-semibold">
          Contextual signals are not enforcement evidence
        </p>
        <p className="mt-1">
          Use these aggregates to prioritize review. Confirm ownership,
          boundaries, and any suspected encroachment using authoritative parcel
          records, surveys, and field evidence.
        </p>
      </aside>

      {!context ? (
        <section className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
          <h2 className="text-base font-semibold text-gray-900">Context unavailable</h2>
          <p className="mt-2 text-sm text-slate-500">
            Context could not be loaded. The parcel overview remains available;
            try this section again later.
          </p>
        </section>
      ) : (
        <>
          <section className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-gray-900">
                  Parcel identity &amp; lineage
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  Canonical parcel ID: {context.canonical_id}
                </p>
              </div>
              <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600">
                Context only
              </span>
            </div>

            <div className="mt-5 grid gap-5 md:grid-cols-2">
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Known identifiers
                </h3>
                {context.aliases.length === 0 ? (
                  <p className="mt-2 text-sm text-slate-500">
                    No alternate identifiers are registered.
                  </p>
                ) : (
                  <dl className="mt-2 divide-y divide-slate-100 rounded border border-slate-200">
                    {context.aliases.map((alias) => (
                      <div
                        key={`${alias.scheme}:${alias.value}`}
                        className="flex items-start justify-between gap-4 px-3 py-2.5"
                      >
                        <dt className="text-xs font-medium uppercase text-slate-500">
                          {alias.scheme}
                        </dt>
                        <dd className="text-right text-sm font-medium text-slate-900">
                          {alias.value}
                          <span className="block text-xs font-normal text-slate-500">
                            {alias.source}
                          </span>
                        </dd>
                      </div>
                    ))}
                  </dl>
                )}
              </div>

              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Split, merge &amp; renumber history
                </h3>
                {context.lineage.length === 0 ? (
                  <p className="mt-2 rounded border border-dashed border-slate-200 p-3 text-sm text-slate-500">
                    No lineage events are registered for this parcel.
                  </p>
                ) : (
                  <ul className="mt-2 flex flex-col gap-2">
                    {context.lineage.map((edge) => (
                      <li
                        key={`${edge.relation}:${edge.related_parcel_id}`}
                        className="rounded border border-slate-200 p-3 text-sm"
                      >
                        <span className="font-medium capitalize text-slate-900">
                          {lineageLabel(edge)} {edge.related_parcel_id}
                        </span>
                        <span className="mt-1 block text-xs text-slate-500">
                          {edge.effective_on ?? "Date not recorded"} · {edge.source}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </section>

          {context.geographic_links.length === 0 ? (
            <section className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
              <h2 className="text-base font-semibold text-gray-900">Planning context</h2>
              <p className="mt-2 text-sm text-slate-500">
                No context dataset is linked to this parcel. No values have been
                inferred or filled in.
              </p>
            </section>
          ) : (
            <>
              <section className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="text-base font-semibold text-gray-900">
                      Linked geographic context
                    </h2>
                    <p className="mt-1 text-sm text-slate-500">
                      Parcel-to-unit matches carry their own method and confidence.
                    </p>
                  </div>
                  {context.sources.some((source) => source.is_demo) && (
                    <span className="rounded-full bg-violet-100 px-2.5 py-1 text-xs font-semibold text-violet-800">
                      Illustrative demo
                    </span>
                  )}
                </div>
                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  {context.geographic_links.map((link) => (
                    <div
                      key={`${link.scheme}:${link.geographic_unit_id}`}
                      className="rounded border border-slate-200 p-4"
                    >
                      <p className="text-sm font-semibold text-slate-900">{link.name}</p>
                      <p className="mt-1 text-xs text-slate-500">
                        {link.scheme}: {link.geographic_unit_id}
                      </p>
                      <p className="mt-2 text-xs text-slate-600">
                        {confidenceLabel(link.confidence)} · {link.match_method.replaceAll("_", " ")}
                      </p>
                    </div>
                  ))}
                </div>
              </section>

              <section className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
                <h2 className="text-base font-semibold text-gray-900">Planning signals</h2>
                <p className="mt-1 text-sm text-slate-500">
                  Aggregate indicators for inspection planning, not parcel findings.
                </p>
                {context.observations.length === 0 ? (
                  <p className="mt-4 text-sm text-slate-500">
                    The geographic unit is linked, but no observations are available.
                  </p>
                ) : (
                  <dl className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {context.observations.map((observation) => (
                      <div
                        key={`${observation.key}:${observation.period}`}
                        className="rounded border border-slate-200 bg-slate-50 p-4"
                      >
                        <dt className="text-xs font-medium text-slate-500">
                          {observation.label}
                        </dt>
                        <dd className="mt-1 text-lg font-semibold text-slate-900">
                          {observationValue(observation)}
                        </dd>
                        <p className="mt-1 text-xs text-slate-500">
                          {observation.unit} · {observation.period}
                          {observation.trend ? ` · ${observation.trend}` : ""}
                        </p>
                      </div>
                    ))}
                  </dl>
                )}
              </section>
            </>
          )}

          {context.sources.length > 0 && (
            <section className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
              <h2 className="text-base font-semibold text-gray-900">
                Sources &amp; limitations
              </h2>
              <div className="mt-4 flex flex-col gap-4">
                {context.sources.map((source) => (
                  <article key={source.id} className="rounded border border-slate-200 p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <h3 className="text-sm font-semibold text-slate-900">
                          {source.dataset}
                        </h3>
                        <p className="text-sm text-slate-600">{source.provider}</p>
                      </div>
                      <a
                        href={source.source_url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs font-medium text-gov hover:underline"
                      >
                        Source documentation
                      </a>
                    </div>
                    <dl className="mt-3 grid gap-2 text-xs text-slate-600 sm:grid-cols-3">
                      <div>
                        <dt className="font-medium text-slate-500">Version / vintage</dt>
                        <dd>{source.version} · {source.vintage}</dd>
                      </div>
                      <div>
                        <dt className="font-medium text-slate-500">Resolution</dt>
                        <dd>{source.resolution}</dd>
                      </div>
                      <div>
                        <dt className="font-medium text-slate-500">License note</dt>
                        <dd>{source.license}</dd>
                      </div>
                    </dl>
                    <ul className="mt-3 list-disc space-y-1 pl-5 text-xs text-slate-600">
                      {source.limitations.map((limitation) => (
                        <li key={limitation}>{limitation}</li>
                      ))}
                    </ul>
                  </article>
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
