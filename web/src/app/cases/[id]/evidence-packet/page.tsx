import Link from "next/link";
import { notFound } from "next/navigation";
import {
  getAlertForRequest,
  getCaseForRequest,
  getParcelForRequest,
} from "@/lib/server-api";
import { EvidencePacketDocument } from "@/components/EvidencePacketDocument";
import { PrintPacketButton } from "@/components/PrintPacketButton";

export const dynamic = "force-dynamic";

export default async function EvidencePacketPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const caseRecord = await getCaseForRequest(id);
  if (!caseRecord) notFound();

  const [parcel, alert] = await Promise.all([
    getParcelForRequest(caseRecord.parcel_id),
    getAlertForRequest(caseRecord.alert_id),
  ]);

  return (
    <main className="min-h-screen bg-slate-100 p-4 sm:p-8 print:bg-white print:p-0">
      <div className="mx-auto max-w-5xl">
        <div
          data-print-hidden="true"
          className="mb-4 flex flex-wrap items-center justify-between gap-3"
        >
          <Link href={`/cases/${caseRecord.id}`} className="text-sm font-medium text-gov hover:underline">
            ← Back to case
          </Link>
          <PrintPacketButton />
        </div>
        <EvidencePacketDocument caseRecord={caseRecord} parcel={parcel} alert={alert} />
      </div>
    </main>
  );
}
