"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { CaseStateChip } from "./CaseStateChip";
import {
  CASE_STATE_CHAIN,
  TERMINAL_STATES,
  PAUSED_STATES,
  type Case,
} from "@/lib/types";

export interface CasesTableProps {
  cases: Case[];
}

function daysInStage(stateSince: string | null | undefined): number | null {
  if (!stateSince) return null;
  const then = new Date(stateSince).getTime();
  if (Number.isNaN(then)) return null;
  const diffMs = Date.now() - then;
  return Math.max(0, Math.floor(diffMs / (24 * 60 * 60 * 1000)));
}

function isChainState(state: Case["state"]): state is (typeof CASE_STATE_CHAIN)[number] {
  return (CASE_STATE_CHAIN as string[]).includes(state);
}

type Bucket = "active" | "paused" | "concluded";

/**
 * Classifies a case into exactly one of the three table sections. Checked in
 * priority order (paused/concluded special states first) so every case maps
 * to a single bucket — no case can appear in two sections at once.
 */
function classifyCase(c: Case): Bucket {
  if (PAUSED_STATES.has(c.state)) return "paused";
  if (c.state === "CLOSED" || TERMINAL_STATES.has(c.state)) return "concluded";
  if (isChainState(c.state)) return "active";
  return "concluded";
}

interface Section {
  title: string;
  cases: Case[];
}

function buildSections(cases: Case[]): Section[] {
  const active: Case[] = [];
  const paused: Case[] = [];
  const concluded: Case[] = [];

  for (const c of cases) {
    const bucket = classifyCase(c);
    if (bucket === "active") active.push(c);
    else if (bucket === "paused") paused.push(c);
    else concluded.push(c);
  }

  // In due process: sort by days-in-stage descending; break ties on case id
  // for deterministic, repeatable ordering (matters when state_since is
  // absent for several cases).
  const sortedActive = [...active].sort((a, b) => {
    const diff =
      (daysInStage(b.state_since) ?? -1) - (daysInStage(a.state_since) ?? -1);
    return diff !== 0 ? diff : a.id.localeCompare(b.id);
  });

  const sections: Section[] = [];
  if (sortedActive.length > 0) {
    sections.push({ title: "In due process", cases: sortedActive });
  }
  if (paused.length > 0) {
    sections.push({ title: "Paused", cases: paused });
  }
  if (concluded.length > 0) {
    sections.push({ title: "Concluded", cases: concluded });
  }
  return sections;
}

function NextSteps({ transitions }: { transitions?: string[] }) {
  if (!transitions || transitions.length === 0) {
    return <span className="text-gray-400">—</span>;
  }
  const shown = transitions.slice(0, 2);
  const remaining = transitions.length - shown.length;
  return (
    <div className="flex flex-wrap gap-1.5">
      {shown.map((t) => (
        <span
          key={t}
          className="rounded px-2 py-0.5 text-xs text-gov ring-1 ring-inset ring-gov/30"
        >
          {t.replace(/_/g, " ")}
        </span>
      ))}
      {remaining > 0 && (
        <span className="rounded px-2 py-0.5 text-xs text-gray-500">
          +{remaining} more
        </span>
      )}
    </div>
  );
}

function StageProgress({ state }: { state: Case["state"] }) {
  if (!isChainState(state)) return null;
  const index = CASE_STATE_CHAIN.indexOf(state);
  const pct = ((index + 1) / CASE_STATE_CHAIN.length) * 100;
  return (
    <div className="mt-1 flex flex-col gap-0.5">
      <div className="h-1 w-20 rounded bg-gray-200">
        <div className="h-1 rounded bg-gov" style={{ width: `${pct}%` }} />
      </div>
      <span className="text-[10px] text-gray-400">
        Step {index + 1} of {CASE_STATE_CHAIN.length}
      </span>
    </div>
  );
}

export function CasesTable({ cases }: CasesTableProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [query, setQuery] = useState(searchParams.get("q") ?? "");
  const [bucketFilter, setBucketFilter] = useState<Bucket | "all">(
    (searchParams.get("view") as Bucket | null) ?? "all"
  );

  const bucketCounts = useMemo(() => {
    const counts: Record<Bucket | "all", number> = {
      all: cases.length,
      active: 0,
      paused: 0,
      concluded: 0,
    };
    cases.forEach((item) => {
      counts[classifyCase(item)] += 1;
    });
    return counts;
  }, [cases]);

  function persistFilters(next: { query?: string; bucket?: Bucket | "all" }) {
    const params = new URLSearchParams(searchParams.toString());
    const nextQuery = next.query ?? query;
    const nextBucket = next.bucket ?? bucketFilter;
    if (nextQuery.trim()) params.set("q", nextQuery.trim());
    else params.delete("q");
    if (nextBucket !== "all") params.set("view", nextBucket);
    else params.delete("view");
    const suffix = params.toString();
    router.replace(`${pathname}${suffix ? `?${suffix}` : ""}`, {
      scroll: false,
    });
  }

  const filteredCases = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return cases.filter((item) => {
      if (bucketFilter !== "all" && classifyCase(item) !== bucketFilter) {
        return false;
      }
      if (!normalizedQuery) return true;
      return [item.id, item.parcel_id, item.alert_id, item.state]
        .join(" ")
        .toLowerCase()
        .includes(normalizedQuery);
    });
  }, [cases, query, bucketFilter]);

  const sections = useMemo(() => buildSections(filteredCases), [filteredCases]);

  const bucketLabels: Array<{ key: Bucket | "all"; label: string }> = [
    { key: "all", label: "All" },
    { key: "active", label: "In due process" },
    { key: "paused", label: "Paused" },
    { key: "concluded", label: "Concluded" },
  ];

  return (
    <div data-testid="cases-table" className="flex flex-col gap-5">
      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <label className="flex max-w-md flex-col gap-1 text-sm text-slate-700">
          Search
          <input
            type="search"
            aria-label="Search cases"
            value={query}
            placeholder="Case, parcel, alert, or stage"
            onChange={(event) => {
              const nextQuery = event.target.value;
              setQuery(nextQuery);
              persistFilters({ query: nextQuery });
            }}
            className="rounded-md border border-slate-300 px-3 py-2 outline-none focus:border-gov focus:ring-2 focus:ring-gov/20"
          />
        </label>
        <div className="mt-3 flex flex-wrap gap-2" aria-label="Case workflow filters">
          {bucketLabels.map((bucket) => (
            <button
              key={bucket.key}
              type="button"
              aria-pressed={bucketFilter === bucket.key}
              onClick={() => {
                setBucketFilter(bucket.key);
                persistFilters({ bucket: bucket.key });
              }}
              className={`rounded-full px-3 py-1.5 text-xs font-medium ring-1 ring-inset ${
                bucketFilter === bucket.key
                  ? "bg-gov text-white ring-gov"
                  : "bg-white text-slate-600 ring-slate-300 hover:bg-slate-50"
              }`}
            >
              {bucket.label} ({bucketCounts[bucket.key]})
            </button>
          ))}
        </div>
      </div>

      <p className="text-sm text-slate-500">
        Showing {filteredCases.length} of {cases.length} cases
      </p>

      {sections.map((section) => (
        <div key={section.title} className="flex flex-col gap-2">
          <h3 className="text-xs uppercase tracking-wide text-gray-500">
            {section.title}
          </h3>
          <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
          <table className="min-w-[48rem] w-full border-collapse text-sm">
            <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-4 py-2">Case</th>
                <th className="px-4 py-2">Parcel</th>
                <th className="px-4 py-2">Stage</th>
                <th className="px-4 py-2">Time in stage</th>
                <th className="px-4 py-2">What can happen next</th>
              </tr>
            </thead>
            <tbody>
              {section.cases.map((c) => {
                const days = daysInStage(c.state_since);
                return (
                  <tr
                    key={c.id}
                    data-testid="case-row"
                    data-case-id={c.id}
                    className="border-t border-gray-100 hover:bg-gray-50"
                  >
                    <td className="px-4 py-2 font-medium">
                      <Link
                        href={`/cases/${c.id}`}
                        className="text-gov underline-offset-2 hover:underline focus:outline-none focus:ring-2 focus:ring-gov/30"
                      >
                        {c.id}
                      </Link>
                    </td>
                    <td className="px-4 py-2 text-gray-700">{c.parcel_id}</td>
                    <td className="px-4 py-2">
                      <CaseStateChip state={c.state} />
                      <StageProgress state={c.state} />
                    </td>
                    <td className="px-4 py-2 text-gray-500">
                      {days === null ? "—" : `${days} days`}
                    </td>
                    <td className="px-4 py-2">
                      <NextSteps transitions={c.allowed_transitions} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>
        </div>
      ))}
      {sections.length === 0 && (
        <p className="text-sm text-gray-400">No cases to show.</p>
      )}
    </div>
  );
}
