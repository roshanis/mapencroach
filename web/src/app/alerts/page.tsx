import Link from "next/link";
import {
  getAlertsForRequest,
  getCasesForRequest,
  getParcelsForRequest,
} from "@/lib/server-api";
import { AlertsTable } from "@/components/AlertsTable";
import { TopBar } from "@/components/TopBar";
import type { Case } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function AlertsQueuePage() {
  const [alerts, parcels, cases] = await Promise.all([
    getAlertsForRequest(),
    getParcelsForRequest(),
    getCasesForRequest(),
  ]);
  const casesByAlertId = new Map<string, Case>(
    cases.map((item) => [item.alert_id, item])
  );

  return (
    <div className="flex min-h-screen flex-col">
      <TopBar />
      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-4 p-6">
        <div>
          <Link href="/console" className="text-sm text-gov hover:underline">
            &larr; Back to command map
          </Link>
          <h1 className="mt-2 text-xl font-semibold text-gray-900">
            Alert Queue
          </h1>
          <p className="text-sm text-gray-500">
            Search or filter the queue, then open a parcel link to review the record.
          </p>
        </div>
        <AlertsTable
          alerts={alerts}
          parcels={parcels}
          casesByAlertId={casesByAlertId}
        />
      </main>
    </div>
  );
}
