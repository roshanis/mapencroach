"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { transitionCase, type TransitionResult } from "@/lib/api";
import { CASE_STATE_CHAIN, NON_CHAIN_STATES } from "@/lib/types";

const ALL_STATES: string[] = [...CASE_STATE_CHAIN, ...NON_CHAIN_STATES];

const ACTION_LABELS: Record<string, string> = {
  RESPONSE_WINDOW: "Open response window",
  DISMISSED_FALSE_POSITIVE: "Dismiss false positive",
  LEGACY_REFERRED: "Refer to legacy process",
  SURVEY_REQUESTED: "Request boundary survey",
  STAYED_BY_COURT: "Record court stay",
};

const SUBMIT_LABELS: Record<string, string> = {
  RESPONSE_WINDOW: "Record response window",
  DISMISSED_FALSE_POSITIVE: "Record dismissal",
  LEGACY_REFERRED: "Record legacy referral",
  SURVEY_REQUESTED: "Record survey request",
  STAYED_BY_COURT: "Record court stay",
};

function titleCase(value: string): string {
  return value
    .toLowerCase()
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function sentenceCase(value: string): string {
  const words = value.toLowerCase().replaceAll("_", " ");
  return words.replace(/^\w/, (letter) => letter.toUpperCase());
}

function actionLabel(state: string): string {
  return ACTION_LABELS[state] ?? `Advance to ${titleCase(state)}`;
}

function submitLabel(state: string): string {
  return SUBMIT_LABELS[state] ?? `Record ${titleCase(state)}`;
}

export interface TransitionPanelProps {
  caseId: string;
  allowedTransitions: string[];
  requiredArtifacts: Record<string, string[]>;
}

export function TransitionPanel({
  caseId,
  allowedTransitions,
  requiredArtifacts,
}: TransitionPanelProps) {
  const router = useRouter();
  const [selected, setSelected] = useState(allowedTransitions[0] ?? "");
  const blockedStates = useMemo(
    () => ALL_STATES.filter((state) => !allowedTransitions.includes(state)),
    [allowedTransitions]
  );
  const [guardSelected, setGuardSelected] = useState(blockedStates[0] ?? "");
  const [artifactValues, setArtifactValues] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<TransitionResult | null>(null);

  const artifactNames = requiredArtifacts[selected] ?? [];
  const evidenceComplete = artifactNames.every(
    (name) => (artifactValues[name] ?? "").trim().length > 0
  );

  async function submit(toState: string, artifacts: Record<string, string>) {
    setSubmitting(true);
    setResult(null);
    try {
      const outcome = await transitionCase(caseId, toState, artifacts, "");
      setResult(outcome);
      if (outcome.ok) router.refresh();
    } catch {
      setResult({
        ok: false,
        status: 0,
        detail: "Transition service could not be reached. Try again.",
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div data-testid="transition-panel" className="mt-4 flex flex-col gap-4 text-sm">
      {allowedTransitions.length > 0 ? (
        <>
          <div className="flex flex-wrap gap-2" aria-label="Legal next steps">
            {allowedTransitions.map((state) => (
              <button
                key={state}
                type="button"
                aria-pressed={selected === state}
                onClick={() => {
                  setSelected(state);
                  setArtifactValues({});
                  setResult(null);
                }}
                className={`rounded-md px-3 py-2 text-sm font-medium ring-1 ring-inset ${
                  selected === state
                    ? "bg-gov text-white ring-gov"
                    : "bg-white text-gov ring-gov/30 hover:bg-gov/5"
                }`}
              >
                {actionLabel(state)}
              </button>
            ))}
          </div>

          <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
            <p className="font-semibold text-slate-950">{actionLabel(selected)}</p>
            {artifactNames.length > 0 ? (
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                {artifactNames.map((name) => (
                  <label
                    key={name}
                    className="flex flex-col gap-1 text-xs text-slate-600"
                  >
                    {sentenceCase(name)}
                    <input
                      type="text"
                      data-testid={`artifact-input-${name}`}
                      value={artifactValues[name] ?? ""}
                      placeholder="Reference or file name"
                      onChange={(event) =>
                        setArtifactValues((previous) => ({
                          ...previous,
                          [name]: event.target.value,
                        }))
                      }
                      className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-gov focus:ring-2 focus:ring-gov/20"
                    />
                  </label>
                ))}
              </div>
            ) : (
              <p className="mt-2 text-xs text-slate-500">
                No evidence reference is required for this step.
              </p>
            )}
            <button
              type="button"
              onClick={() => {
                const artifacts = Object.fromEntries(
                  artifactNames.map((name) => [name, artifactValues[name]?.trim() ?? ""])
                );
                void submit(selected, artifacts);
              }}
              disabled={submitting || !evidenceComplete}
              className="mt-4 rounded-md bg-gov px-4 py-2 text-sm font-semibold text-white hover:bg-gov-dark disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitLabel(selected)}
            </button>
          </div>
        </>
      ) : (
        <p className="rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-600">
          This case has no legal next step.
        </p>
      )}

      {blockedStates.length > 0 && (
        <details className="rounded-lg border border-dashed border-slate-300 bg-white p-4">
          <summary className="cursor-pointer text-sm font-medium text-slate-600">
            Demo: test the policy guard
          </summary>
          <p className="mt-2 text-xs leading-5 text-slate-500">
            This training control deliberately submits a prohibited step so the case engine can demonstrate its refusal.
          </p>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <select
              data-testid="guard-transition-select"
              value={guardSelected}
              onChange={(event) => setGuardSelected(event.target.value)}
              className="rounded-md border border-slate-300 px-3 py-2 text-sm"
            >
              {blockedStates.map((state) => (
                <option key={state} value={state}>
                  {titleCase(state)}
                </option>
              ))}
            </select>
            <button
              type="button"
              data-testid="guard-transition-submit"
              disabled={submitting || !guardSelected}
              onClick={() => void submit(guardSelected, {})}
              className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm font-medium text-red-800 hover:bg-red-100 disabled:opacity-50"
            >
              Submit blocked transition
            </button>
          </div>
        </details>
      )}

      {result?.ok && (
        <div
          role="status"
          data-testid="transition-result"
          data-outcome="success"
          className="rounded border border-green-300 bg-green-50 px-3 py-2 text-xs text-green-800"
        >
          Transition recorded — the case advanced.
        </div>
      )}
      {result && !result.ok && (
        <div
          role="alert"
          data-testid="transition-result"
          data-outcome="refused"
          className="rounded border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-800"
        >
          {result.status === 0
            ? result.detail
            : `Refused (HTTP ${result.status}): ${result.detail}`}
        </div>
      )}
    </div>
  );
}
