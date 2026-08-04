"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { transferCase, type TransitionResult } from "@/lib/api";
import type { Jurisdiction } from "@/lib/types";

export interface TransferPanelProps {
  caseId: string;
  currentJurisdictionId: string;
  jurisdictions: Jurisdiction[];
}

export function TransferPanel({
  caseId,
  currentJurisdictionId,
  jurisdictions,
}: TransferPanelProps) {
  const targets = useMemo(
    () => jurisdictions.filter((j) => j.id !== currentJurisdictionId),
    [jurisdictions, currentJurisdictionId]
  );
  const [target, setTarget] = useState(targets[0]?.id ?? "");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<TransitionResult | null>(null);

  const targetName =
    jurisdictions.find((j) => j.id === target)?.name ?? target;
  const reasonIsBlank = reason.trim().length === 0;

  async function submit() {
    setSubmitting(true);
    setResult(null);
    try {
      const outcome = await transferCase(caseId, target, reason.trim());
      setResult(outcome);
      // Deliberately no router.refresh() on success: a cross-scope handover
      // can move the case outside the caller's own jurisdiction scope, and
      // refreshing this server component would immediately 404 the very
      // page the user is currently reading. The confirmation below sends
      // them back to /cases instead.
    } catch {
      setResult({
        ok: false,
        status: 0,
        detail: "Transfer service could not be reached. Try again.",
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <details
      data-testid="transfer-panel"
      className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm"
    >
      <summary className="cursor-pointer text-base font-semibold text-gray-900">
        Transfer case
      </summary>

      <div className="mt-4 flex flex-col gap-4 text-sm">
        <p className="text-sm text-slate-600">
          Hand this case to another jurisdiction. The receiving officer takes
          over the case; you may lose visibility on it if the target lies
          outside your own scope.
        </p>

        <label className="flex flex-col gap-1 text-xs text-slate-600">
          New jurisdiction
          <select
            data-testid="transfer-target-select"
            value={target}
            onChange={(event) => {
              setTarget(event.target.value);
              setResult(null);
            }}
            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-gov focus:ring-2 focus:ring-gov/20"
          >
            {targets.map((j) => (
              <option key={j.id} value={j.id}>
                {j.name}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-xs text-slate-600">
          Reason for transfer
          <textarea
            data-testid="transfer-reason-input"
            required
            value={reason}
            onChange={(event) => {
              setReason(event.target.value);
              setResult(null);
            }}
            placeholder="Why is this case being handed over?"
            rows={3}
            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-gov focus:ring-2 focus:ring-gov/20"
          />
        </label>

        <button
          type="button"
          data-testid="transfer-submit"
          disabled={submitting || reasonIsBlank || !target}
          onClick={() => void submit()}
          className="self-start rounded-md bg-gov px-4 py-2 text-sm font-semibold text-white hover:bg-gov-dark disabled:cursor-not-allowed disabled:opacity-50"
        >
          Record transfer
        </button>

        {result?.ok && (
          <div
            role="status"
            data-testid="transfer-result"
            data-outcome="success"
            className="rounded border border-green-300 bg-green-50 px-3 py-2 text-xs text-green-800"
          >
            This case now belongs to {targetName} and may no longer appear in
            your view.{" "}
            <Link href="/cases" className="font-semibold underline">
              Return to cases
            </Link>
          </div>
        )}
        {result && !result.ok && (
          <div
            role="alert"
            data-testid="transfer-result"
            data-outcome="refused"
            className="rounded border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-800"
          >
            {result.status === 0
              ? result.detail
              : `Refused (HTTP ${result.status}): ${result.detail}`}
          </div>
        )}
      </div>
    </details>
  );
}
