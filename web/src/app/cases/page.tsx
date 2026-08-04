import { getCaseForRequest, getCasesForRequest } from "@/lib/server-api";
import { CasesTable } from "@/components/CasesTable";
import { TopBar } from "@/components/TopBar";
import type { Case } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * GET /cases returns only {id, alert_id, parcel_id, state, state_since} —
 * allowed_transitions is only present on GET /cases/{id}. Fetch each case's
 * detail in parallel to bring allowed_transitions into the list view so the
 * "What can happen next" chips render. Any single detail fetch failing (or
 * returning nothing) falls back to the bare list row rather than crashing
 * the page.
 */
async function withAllowedTransitions(cases: Case[]): Promise<Case[]> {
  return Promise.all(
    cases.map(async (c) => {
      try {
        const detail = await getCaseForRequest(c.id);
        if (!detail) return c;
        return { ...c, allowed_transitions: detail.allowed_transitions };
      } catch {
        return c;
      }
    })
  );
}

export default async function CasesIndexPage() {
  const cases = await withAllowedTransitions(await getCasesForRequest());

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
