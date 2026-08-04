"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { updateBoundaryGrade } from "@/lib/api";
import { PERSONA_META_COOKIE, readCookie } from "@/lib/cookies";
import type { BoundaryGrade } from "@/lib/types";
import { BoundaryGradeBadge } from "./BoundaryGradeBadge";

const EDITOR_ROLES = new Set(["survey_officer", "data_admin"]);
const GRADES: BoundaryGrade[] = ["A", "B", "C"];

function currentRole(): string | undefined {
  const raw = readCookie(PERSONA_META_COOKIE);
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as { role?: unknown };
    return typeof parsed.role === "string" ? parsed.role : undefined;
  } catch {
    return undefined;
  }
}

export interface BoundaryGradeEditorProps {
  parcelId: string;
  initialGrade: BoundaryGrade;
}

export function BoundaryGradeEditor({
  parcelId,
  initialGrade,
}: BoundaryGradeEditorProps) {
  const router = useRouter();
  const [authorized, setAuthorized] = useState<boolean | null>(null);
  const [recordedGrade, setRecordedGrade] = useState(initialGrade);
  const [selectedGrade, setSelectedGrade] = useState(initialGrade);
  const [surveyReference, setSurveyReference] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    const role = currentRole();
    setAuthorized(Boolean(role && EDITOR_ROLES.has(role)));
  }, []);

  if (authorized !== true) return null;

  const canSubmit =
    !submitting &&
    selectedGrade !== recordedGrade &&
    surveyReference.trim().length > 0;

  async function handleSubmit() {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    setSuccess(null);
    const reference = surveyReference.trim();
    try {
      const result = await updateBoundaryGrade(parcelId, selectedGrade, reference);
      if (result.ok) {
        const grade = result.grade ?? selectedGrade;
        setRecordedGrade(grade);
        setSelectedGrade(grade);
        setSurveyReference("");
        setSuccess(
          `Boundary grade ${grade} recorded with survey reference ${reference}.`
        );
        router.refresh();
      } else {
        setError(`Refused (HTTP ${result.status}): ${result.detail}`);
      }
    } catch {
      setError("Boundary-grade service could not be reached. Try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="rounded-lg border border-blue-200 bg-blue-50/50 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-gov">
            Survey officer control
          </p>
          <h2 className="mt-1 text-base font-semibold text-gray-900">
            Record boundary verification
          </h2>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-gray-600">
            A grade change requires the authoritative survey reference. The backend records the acting officer in the audit chain.
          </p>
        </div>
        <BoundaryGradeBadge grade={recordedGrade} />
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-[10rem_minmax(14rem,1fr)_auto] sm:items-end">
        <label className="flex flex-col gap-1 text-xs font-medium text-gray-700">
          New boundary grade
          <select
            aria-label="New boundary grade"
            value={selectedGrade}
            onChange={(event) => {
              setSelectedGrade(event.target.value as BoundaryGrade);
              setError(null);
              setSuccess(null);
            }}
            disabled={submitting}
            className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm"
          >
            {GRADES.map((grade) => (
              <option key={grade} value={grade}>
                Grade {grade}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-gray-700">
          Survey reference
          <input
            type="text"
            aria-label="Survey reference"
            value={surveyReference}
            onChange={(event) => {
              setSurveyReference(event.target.value);
              setError(null);
              setSuccess(null);
            }}
            placeholder="For example, DGPS-SR-2026-104"
            disabled={submitting}
            className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm outline-none focus:border-gov focus:ring-2 focus:ring-gov/20"
          />
        </label>
        <button
          type="button"
          onClick={() => void handleSubmit()}
          disabled={!canSubmit}
          className="rounded-md bg-gov px-4 py-2 text-sm font-semibold text-white hover:bg-gov-dark disabled:cursor-not-allowed disabled:opacity-50"
        >
          {submitting ? "Recording…" : "Record boundary grade"}
        </button>
      </div>

      {success && (
        <p role="status" className="mt-3 text-sm font-medium text-emerald-700">
          {success}
        </p>
      )}
      {error && (
        <p role="alert" className="mt-3 text-sm font-medium text-red-700">
          {error}
        </p>
      )}
    </section>
  );
}
