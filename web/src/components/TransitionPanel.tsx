"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { transitionCase, type TransitionResult } from "@/lib/api";
import { CASE_STATE_CHAIN } from "@/lib/types";

const NON_CHAIN_STATES = [
  "DISMISSED_FALSE_POSITIVE",
  "LEGACY_REFERRED",
  "SURVEY_REQUESTED",
  "STAYED_BY_COURT",
];

const ALL_STATES: string[] = [...CASE_STATE_CHAIN, ...NON_CHAIN_STATES];

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
  const [selected, setSelected] = useState<string>(
    allowedTransitions.length > 0 ? allowedTransitions[0] : ALL_STATES[0]
  );
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<TransitionResult | null>(null);

  const isAllowed = allowedTransitions.includes(selected);
  const artifactNames = useMemo(
    () => requiredArtifacts[selected] ?? [],
    [requiredArtifacts, selected]
  );

  const [artifactValues, setArtifactValues] = useState<Record<string, string>>(
    () =>
      Object.fromEntries(
        artifactNames.map((name) => [name, `${name}-demo.pdf`])
      )
  );

  function handleSelectChange(next: string) {
    setSelected(next);
    const nextArtifactNames = requiredArtifacts[next] ?? [];
    setArtifactValues(
      Object.fromEntries(
        nextArtifactNames.map((name) => [name, `${name}-demo.pdf`])
      )
    );
    setResult(null);
  }

  async function handleSubmit() {
    setSubmitting(true);
    try {
      const artifacts: Record<string, string> =
        artifactNames.length > 0
          ? Object.fromEntries(
              artifactNames.map((name) => [
                name,
                artifactValues[name] ?? `${name}-demo.pdf`,
              ])
            )
          : {};
      const outcome = await transitionCase(caseId, selected, artifacts, "");
      setResult(outcome);
      if (outcome.ok) {
        router.refresh();
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      data-testid="transition-panel"
      className="flex flex-col gap-3 text-sm"
    >
      <select
        data-testid="transition-select"
        value={selected}
        onChange={(e) => handleSelectChange(e.target.value)}
        className="rounded border border-gray-300 px-2 py-1 text-sm"
      >
        {ALL_STATES.map((state) => {
          const label = state.replace(/_/g, " ");
          const suffix = allowedTransitions.includes(state)
            ? " — allowed"
            : " — will be refused";
          return (
            <option key={state} value={state}>
              {label}
              {suffix}
            </option>
          );
        })}
      </select>

      {isAllowed && artifactNames.length > 0 && (
        <div className="flex flex-col gap-2">
          {artifactNames.map((name) => (
            <label key={name} className="flex flex-col gap-1 text-xs text-gray-600">
              {name.replace(/_/g, " ")}
              <input
                type="text"
                data-testid={`artifact-input-${name}`}
                value={artifactValues[name] ?? `${name}-demo.pdf`}
                onChange={(e) =>
                  setArtifactValues((prev) => ({
                    ...prev,
                    [name]: e.target.value,
                  }))
                }
                className="rounded border border-gray-300 px-2 py-1 text-sm"
              />
            </label>
          ))}
        </div>
      )}

      {isAllowed && artifactNames.length === 0 && (
        <p className="text-xs text-gray-400">
          No evidence required for this step.
        </p>
      )}

      {!isAllowed && (
        <p className="text-xs text-gray-400">
          Not legal from the current state — submit to see the engine refuse.
        </p>
      )}

      <button
        type="button"
        data-testid="transition-submit"
        onClick={handleSubmit}
        disabled={submitting}
        className="self-start rounded bg-gov px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
      >
        Attempt transition
      </button>

      {result && result.ok && (
        <div
          data-testid="transition-result"
          data-outcome="success"
          className="rounded border border-green-300 bg-green-50 px-3 py-2 text-xs text-green-800"
        >
          Transition recorded — the case advanced.
        </div>
      )}

      {result && !result.ok && (
        <div
          data-testid="transition-result"
          data-outcome="refused"
          className="rounded border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-800"
        >
          {`Refused (HTTP ${result.status}): ${result.detail}`}
        </div>
      )}
    </div>
  );
}
