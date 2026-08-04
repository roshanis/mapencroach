"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { CaseStateChip } from "./CaseStateChip";
import { parseFilterParam } from "@/lib/searchParams";
import {
  CASE_STATE_CHAIN,
  TERMINAL_STATES,
  PAUSED_STATES,
  type Case,
} from "@/lib/types";

export interface CasesTableProps {
  cases: Case[];
}

type Bucket = "active" | "paused" | "concluded";

const BUCKET_OPTIONS: (Bucket | "all")[] = ["all", "active", "paused", "concluded"];

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
  // absent for several cases). This ordering feeds both the table and the
  // mobile card list below — there is exactly one sort, not one per layout.
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

/** Formats days-in-stage the same way for the table cell and the card. */
function daysLabel(days: number | null): string {
  return days === null ? "—" : `${days} days`;
}

const CASE_LINK_CLASSES =
  "text-gov underline-offset-2 hover:underline focus:outline-none focus:ring-2 focus:ring-gov/30";

/** One case's `<tr>`. Every value it renders (days label, state chip,
 * progress, next steps) is also rendered by CaseCard below from the same
 * `c` — the two presentations share the data and the sub-components
 * (CaseStateChip, StageProgress, NextSteps), so there is one place that
 * knows how to render a case, not two drifting copies. */
function CaseTableRow({ c }: { c: Case }) {
  const days = daysInStage(c.state_since);
  return (
    <tr
      data-testid="case-row"
      data-case-id={c.id}
      className="border-t border-gray-100 hover:bg-gray-50"
    >
      <td className="px-4 py-2 font-medium">
        <Link href={`/cases/${c.id}`} className={CASE_LINK_CLASSES}>
          {c.id}
        </Link>
      </td>
      <td className="px-4 py-2 text-gray-700">{c.parcel_id}</td>
      <td className="px-4 py-2">
        <CaseStateChip state={c.state} />
        <StageProgress state={c.state} />
      </td>
      <td className="px-4 py-2 text-gray-500">{daysLabel(days)}</td>
      <td className="px-4 py-2">
        <NextSteps transitions={c.allowed_transitions} />
      </td>
    </tr>
  );
}

/** One case's card presentation for narrow screens (< sm). Shows the same
 * five columns as CaseTableRow — case, parcel, stage (+ progress), time in
 * stage, and next steps — just laid out as a labeled stack instead of table
 * cells, so nothing is dropped on mobile. */
function CaseCard({ c }: { c: Case }) {
  const days = daysInStage(c.state_since);
  return (
    <li
      data-testid="case-card"
      data-case-id={c.id}
      className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <dl>
            <dt className="text-xs uppercase tracking-wide text-gray-500">Case</dt>
            <dd>
              <Link href={`/cases/${c.id}`} className={`text-base font-semibold ${CASE_LINK_CLASSES}`}>
                {c.id}
              </Link>
            </dd>
          </dl>
        </div>
        <span className="shrink-0 text-xs text-gray-500">{daysLabel(days)}</span>
      </div>
      <dl className="mt-3 flex flex-col gap-3 text-sm">
        <div>
          <dt className="text-xs uppercase tracking-wide text-gray-500">Parcel</dt>
          <dd className="font-medium text-gray-900">{c.parcel_id}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-gray-500">Stage</dt>
          <dd className="mt-1">
            <CaseStateChip state={c.state} />
            <StageProgress state={c.state} />
          </dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-gray-500">
            What can happen next
          </dt>
          <dd className="mt-1">
            <NextSteps transitions={c.allowed_transitions} />
          </dd>
        </div>
      </dl>
    </li>
  );
}

export function CasesTable({ cases }: CasesTableProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [query, setQuery] = useState(searchParams.get("q") ?? "");
  const [bucketFilter, setBucketFilter] = useState<Bucket | "all">(
    parseFilterParam(searchParams.get("view"), BUCKET_OPTIONS)
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
    // See AlertsTable.persistFilters: history.replaceState avoids the
    // full server re-fetch that router.replace triggers on a force-dynamic
    // page for every keystroke in the search box.
    if (typeof window !== "undefined") {
      window.history.replaceState(null, "", `${pathname}${suffix ? `?${suffix}` : ""}`);
    }
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
              className={`inline-flex min-h-11 items-center justify-center rounded-full px-3 py-1.5 text-xs font-medium ring-1 ring-inset ${
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

          {/* Real <table> for sm and up; a stacked card list takes over
              below sm (see AlertsTable for the same pattern). Both read
              from `section.cases` — the same already-sorted array — and
              both delegate per-case rendering to CaseTableRow/CaseCard,
              so filtering, the days-in-stage sort, and every column stay
              identical between the two presentations. */}
          <div className="hidden overflow-x-auto rounded-lg border border-gray-200 bg-white sm:block">
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
                {section.cases.map((c) => (
                  <CaseTableRow key={c.id} c={c} />
                ))}
              </tbody>
            </table>
          </div>

          <ul data-testid="case-card-list" className="flex flex-col gap-3 sm:hidden">
            {section.cases.map((c) => (
              <CaseCard key={c.id} c={c} />
            ))}
          </ul>
        </div>
      ))}
      {sections.length === 0 && (
        <p className="text-sm text-gray-400">No cases to show.</p>
      )}
    </div>
  );
}
