import { getCasesForRequest } from "@/lib/server-api";
import { CasesTable } from "@/components/CasesTable";
import { TopBar } from "@/components/TopBar";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Case queue",
  description:
    "Every encroachment case grouped by where it stands in the eleven-stage due-process chain, including paused states such as a court stay.",
  alternates: { canonical: "/cases" },
};


export const dynamic = "force-dynamic";

export default async function CasesIndexPage() {
  const cases = await getCasesForRequest();

  return (
    <div className="flex min-h-screen flex-col">
      <TopBar />
      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-4 p-6">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Cases</h1>
          <p className="text-sm text-gray-500">
            Every case must walk the legal chain — notice, response window,
            hearing, order — before action. The engine refuses shortcuts.
          </p>
        </div>
        <CasesTable cases={cases} />
      </main>
    </div>
  );
}
