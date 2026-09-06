"use client";

import { useMemo, useState } from "react";
import { STATE_LABELS, SPECIAL_STATE_LABELS } from "@/lib/types";
import type { Alert, Case, Parcel } from "@/lib/types";

export interface NoticeDraftWorkspaceProps {
  caseRecord: Case;
  parcel: Parcel;
  alert?: Alert;
}

function dateLabel(iso: string | undefined): string {
  if (!iso) return "date not recorded";
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return iso;
  return parsed.toLocaleDateString("en-IN", { dateStyle: "medium" });
}

function caseStateLabel(state: Case["state"]): string {
  if (state in SPECIAL_STATE_LABELS) {
    return SPECIAL_STATE_LABELS[state as keyof typeof SPECIAL_STATE_LABELS];
  }
  return STATE_LABELS[state as keyof typeof STATE_LABELS];
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function NoticeDraftWorkspace({
  caseRecord,
  parcel,
  alert,
}: NoticeDraftWorkspaceProps) {
  const initialFacts = useMemo(
    () =>
      `Screening alert ${alert?.id ?? caseRecord.alert_id} was recorded on ${dateLabel(
        alert?.detected_at
      )} for Survey ${parcel.survey_no} (${parcel.id}). The signal requires verification against authoritative cadastral records, survey material, and field inspection.`,
    [alert, caseRecord.alert_id, parcel.id, parcel.survey_no]
  );
  const [addressee, setAddressee] = useState("");
  const [serviceAddress, setServiceAddress] = useState("");
  const [legalAuthority, setLegalAuthority] = useState("");
  const [responseDeadline, setResponseDeadline] = useState("");
  const [observedFacts, setObservedFacts] = useState(initialFacts);
  const [draft, setDraft] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const boundaryBlocked = parcel.boundary_grade === "C";
  const fieldsComplete =
    addressee.trim().length > 0 &&
    serviceAddress.trim().length > 0 &&
    legalAuthority.trim().length > 0 &&
    responseDeadline.length > 0 &&
    observedFacts.trim().length > 0;
  const canGenerate = !boundaryBlocked && fieldsComplete;

  function invalidateDraft() {
    setDraft(null);
    setStatus(null);
  }

  function generateDraft() {
    if (!canGenerate) return;
    setDraft(
      [
        "DRAFT — NOT FOR SERVICE",
        "",
        `Case: ${caseRecord.id}`,
        `Current stage: ${caseStateLabel(caseRecord.state)}`,
        `Parcel: ${parcel.id}`,
        `Survey number: ${parcel.survey_no}`,
        `${parcel.parcel_id_scheme ?? "ULPIN"}: ${parcel.ulpin}`,
        `Owning department: ${parcel.owning_department}`,
        `Boundary grade: ${parcel.boundary_grade}`,
        "",
        `To: ${addressee.trim()}`,
        `Service address: ${serviceAddress.trim()}`,
        `Response deadline: ${responseDeadline}`,
        `Approved legal authority or provision: ${legalAuthority.trim()}`,
        "",
        "Observed facts requiring review:",
        observedFacts.trim(),
        "",
        "IMPORTANT: This training draft uses no legally approved template, does not establish encroachment, and must not be issued or served. Legal review, authoritative evidence, an approved form, and authorized signature are still required.",
      ].join("\n")
    );
    setStatus(null);
  }

  async function copyDraft() {
    if (!draft) return;
    try {
      await navigator.clipboard.writeText(draft);
      setStatus("Training draft copied. It remains not for service.");
    } catch {
      setStatus("Copy failed. Select the draft text manually.");
    }
  }

  function printDraft() {
    if (!draft) return;
    const popup = window.open("", "_blank");
    if (!popup) {
      setStatus("Print window was blocked. Allow pop-ups and try again.");
      return;
    }
    popup.opener = null;
    popup.document.write(
      `<!doctype html><html><head><title>Training notice draft ${escapeHtml(
        caseRecord.id
      )}</title><style>body{font:14px/1.6 system-ui,sans-serif;max-width:800px;margin:40px auto;padding:0 24px}pre{white-space:pre-wrap;font:inherit}.warning{border:2px solid #b45309;background:#fffbeb;padding:12px;font-weight:700}@media print{body{margin:0}.warning{break-inside:avoid}}</style></head><body><div class="warning">DRAFT — NOT FOR SERVICE</div><pre>${escapeHtml(
        draft
      )}</pre><script>window.onload=()=>window.print()</script></body></html>`
    );
    popup.document.close();
  }

  return (
    <section className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-gov">
            Notice preparation
          </p>
          <h2 className="mt-1 text-base font-semibold text-gray-900">
            Prepare notice draft
          </h2>
        </div>
        <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-900">
          Training only
        </span>
      </div>
      <p className="mt-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm leading-6 text-amber-950">
        Training draft only — no approved legal template is configured. Do not issue, sign, dispatch, or serve output from this workspace.
      </p>

      {boundaryBlocked && (
        <p role="alert" className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-900">
          Grade C boundary blocks notice drafting. Record an authoritative survey and upgrade the boundary grade first.
        </p>
      )}

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-xs font-medium text-gray-700">
          Addressee or occupant
          <input
            type="text"
            value={addressee}
            onChange={(event) => { setAddressee(event.target.value); invalidateDraft(); }}
            className="rounded-md border border-gray-300 px-3 py-2 text-sm outline-none focus:border-gov focus:ring-2 focus:ring-gov/20"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-gray-700">
          Service address
          <input
            type="text"
            value={serviceAddress}
            onChange={(event) => { setServiceAddress(event.target.value); invalidateDraft(); }}
            className="rounded-md border border-gray-300 px-3 py-2 text-sm outline-none focus:border-gov focus:ring-2 focus:ring-gov/20"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-gray-700 sm:col-span-2">
          Approved legal authority or provision
          <input
            type="text"
            value={legalAuthority}
            onChange={(event) => { setLegalAuthority(event.target.value); invalidateDraft(); }}
            placeholder="Must be supplied or approved by the legal cell"
            className="rounded-md border border-gray-300 px-3 py-2 text-sm outline-none focus:border-gov focus:ring-2 focus:ring-gov/20"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-gray-700">
          Response deadline
          <input
            type="date"
            value={responseDeadline}
            onChange={(event) => { setResponseDeadline(event.target.value); invalidateDraft(); }}
            className="rounded-md border border-gray-300 px-3 py-2 text-sm outline-none focus:border-gov focus:ring-2 focus:ring-gov/20"
          />
        </label>
        <div className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-xs leading-5 text-gray-600">
          Parcel {parcel.id} · Survey {parcel.survey_no} · Grade {parcel.boundary_grade}
        </div>
        <label className="flex flex-col gap-1 text-xs font-medium text-gray-700 sm:col-span-2">
          Observed facts
          <textarea
            rows={5}
            value={observedFacts}
            onChange={(event) => { setObservedFacts(event.target.value); invalidateDraft(); }}
            className="rounded-md border border-gray-300 px-3 py-2 text-sm leading-6 outline-none focus:border-gov focus:ring-2 focus:ring-gov/20"
          />
        </label>
      </div>

      <button
        type="button"
        onClick={generateDraft}
        disabled={!canGenerate}
        className="mt-4 rounded-md bg-gov px-4 py-2 text-sm font-semibold text-white hover:bg-gov-dark disabled:cursor-not-allowed disabled:opacity-50"
      >
        Generate training draft
      </button>

      {draft && (
        <div className="mt-5 border-t border-gray-200 pt-5">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <h3 className="text-sm font-semibold text-gray-900">Draft preview</h3>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void copyDraft()}
                className="rounded-md border border-gray-300 bg-white px-3 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50"
              >
                Copy training draft
              </button>
              <button
                type="button"
                onClick={printDraft}
                className="rounded-md border border-gov/30 bg-white px-3 py-2 text-xs font-semibold text-gov hover:bg-gov/5"
              >
                Print training draft
              </button>
            </div>
          </div>
          <pre
            data-testid="notice-draft-preview"
            className="max-h-[32rem] overflow-auto whitespace-pre-wrap rounded-lg border-2 border-amber-300 bg-amber-50 p-4 font-sans text-sm leading-6 text-gray-900"
          >
            {draft}
          </pre>
        </div>
      )}

      {status && <p role="status" className="mt-3 text-sm text-gray-700">{status}</p>}
    </section>
  );
}
