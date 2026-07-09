import Link from "next/link";
import { getAlerts } from "@/lib/api";
import { AlertsTable } from "@/components/AlertsTable";
import { TopBar } from "@/components/TopBar";

export default async function AlertsQueuePage() {
  const alerts = await getAlerts();

  return (
    <div className="flex min-h-screen flex-col">
      <TopBar />
      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-4 p-6">
        <div>
          <Link href="/" className="text-sm text-gov hover:underline">
            &larr; Back to command map
          </Link>
          <h1 className="mt-2 text-xl font-semibold text-gray-900">
            Alert Queue
          </h1>
          <p className="text-sm text-gray-500">
            Click a row to open the associated parcel profile.
          </p>
        </div>
        <AlertsTable alerts={alerts} />
      </main>
    </div>
  );
}
