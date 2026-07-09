import Link from "next/link";
import { notFound } from "next/navigation";
import { getAlerts, getCases, getParcel } from "@/lib/api";
import { ParcelAttributesCard } from "@/components/ParcelAttributesCard";
import { TierChip } from "@/components/TierChip";
import { TopBar } from "@/components/TopBar";
import ParcelMiniMap from "@/components/ParcelMiniMap";

export default async function ParcelProfilePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const parcel = await getParcel(id);

  if (!parcel) {
    notFound();
  }

  const [allAlerts, allCases] = await Promise.all([getAlerts(), getCases()]);
  const linkedAlerts = allAlerts.filter((a) => a.parcel_id === id);
  const linkedCases = allCases.filter((c) => c.parcel_id === id);

  return (
    <div className="flex min-h-screen flex-col">
      <TopBar jurisdiction={parcel.jurisdiction_id} />
      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 p-6">
        <div>
          <Link href="/" className="text-sm text-gov hover:underline">
            &larr; Back to command map
          </Link>
          <h1 className="mt-2 text-xl font-semibold text-gray-900">
            Parcel {parcel.id}
          </h1>
        </div>

        <ParcelAttributesCard parcel={parcel} />

        <section
          data-testid="parcel-mini-map-section"
          className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm"
        >
          <h2 className="mb-4 text-base font-semibold text-gray-900">
            Location
          </h2>
          <div className="h-72 w-full overflow-hidden rounded">
            <ParcelMiniMap parcel={parcel} />
          </div>
        </section>

        <section className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
          <h2 className="mb-4 text-base font-semibold text-gray-900">
            Imagery Timeline
          </h2>
          <div
            data-testid="imagery-timeline-placeholder"
            className="flex h-32 items-center justify-center rounded border border-dashed border-gray-300 text-sm text-gray-400"
          >
            Imagery timeline coming soon — satellite pass history will render
            here.
          </div>
        </section>

        <section
          data-testid="linked-alerts-cases"
          className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm"
        >
          <h2 className="mb-4 text-base font-semibold text-gray-900">
            Linked Alerts &amp; Cases
          </h2>
          {linkedAlerts.length === 0 && linkedCases.length === 0 && (
            <p className="text-sm text-gray-400">
              No alerts or cases linked to this parcel.
            </p>
          )}
          {linkedAlerts.length > 0 && (
            <div className="mb-4">
              <h3 className="mb-2 text-sm font-medium text-gray-700">
                Alerts
              </h3>
              <ul className="flex flex-col gap-2">
                {linkedAlerts.map((alert) => (
                  <li
                    key={alert.id}
                    className="flex items-center justify-between rounded border border-gray-100 px-3 py-2"
                  >
                    <div className="flex items-center gap-3">
                      <TierChip tier={alert.tier} />
                      <span className="text-sm text-gray-900">
                        {alert.id}
                      </span>
                    </div>
                    <span className="text-xs text-gray-500">
                      Severity {alert.severity_score}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {linkedCases.length > 0 && (
            <div>
              <h3 className="mb-2 text-sm font-medium text-gray-700">
                Cases
              </h3>
              <ul className="flex flex-col gap-2">
                {linkedCases.map((c) => (
                  <li key={c.id}>
                    <Link
                      href={`/cases/${c.id}`}
                      className="flex items-center justify-between rounded border border-gray-100 px-3 py-2 hover:bg-gray-50"
                    >
                      <span className="text-sm text-gray-900">{c.id}</span>
                      <span className="text-xs text-gray-500">
                        {c.state.replace(/_/g, " ")}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
