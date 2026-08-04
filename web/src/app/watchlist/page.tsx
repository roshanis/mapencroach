import { getWatchlistForRequest } from "@/lib/server-api";
import { TopBar } from "@/components/TopBar";
import { WatchlistEntryCard } from "@/components/WatchlistEntryCard";

export const dynamic = "force-dynamic";

export default async function WatchlistPage() {
  const entries = await getWatchlistForRequest();

  return (
    <div className="flex min-h-screen flex-col">
      <TopBar />
      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-4 p-6">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Watchlist</h1>
          <p className="text-sm text-gray-500">
            RED-tier alerts under weekly snapshot monitoring, starting from
            the week each watch began. Every week is shown explicitly —
            captured, explained as unusable, flagged as a provider error, or
            marked due — never left blank.
          </p>
        </div>

        {entries.length === 0 ? (
          <p
            data-testid="watchlist-empty"
            className="rounded-lg border border-gray-200 bg-white p-6 text-center text-sm text-gray-400"
          >
            No alerts are being watched yet. Select a RED alert on the
            command map to start watching it.
          </p>
        ) : (
          <div className="flex flex-col gap-4">
            {entries.map((entry) => (
              <WatchlistEntryCard key={entry.alert_id} initialEntry={entry} />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
