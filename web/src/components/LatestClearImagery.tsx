"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { getLatestClearImagery } from "@/lib/api";
import type { ClearImageryResult, Parcel } from "@/lib/types";
import { HistoricalImageryTimeline } from "./HistoricalImageryTimeline";

export function LatestClearImagery({ parcel }: { parcel: Parcel }) {
  return <ParcelClearView key={JSON.stringify([parcel.id, parcel.geometry])} parcel={parcel} />;
}

function ParcelClearView({ parcel }: { parcel: Parcel }) {
  const [result, setResult] = useState<ClearImageryResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const [browse, setBrowse] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
      setError("Imagery search timed out. Please retry.");
      setLoading(false);
    }, 45000);
    setLoading(true);
    setResult(null);
    setError(null);
    getLatestClearImagery(parcel.id, controller.signal).then(value => {
      if (!controller.signal.aborted) setResult(value);
    }).catch(reason => {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Imagery service unavailable");
    }).finally(() => {
      clearTimeout(timer);
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => { clearTimeout(timer); controller.abort(); };
  }, [parcel.id, attempt]);

  const clear = !error && result?.status === "clear";
  const observedDate = result?.captured_at?.slice(0, 10);
  return <div className="min-w-0 space-y-3">
    <section aria-label="Latest clear view" className="min-w-0 rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
      <h2 className="text-base font-semibold text-gray-900">Latest clear view</h2>
      <p className="mt-1 text-sm text-gray-600">Search the past 90 days for imagery with no clouds or cloud shadows detected over Survey {parcel.survey_no}.</p>
      <div aria-live="polite" aria-busy={loading} className="mt-4">
        {loading && <p role="status" className="text-sm text-gray-700">Checking recent scenes over the parcel…</p>}
        {error && <p role="alert" className="text-sm text-amber-900">{error}</p>}
        {!error && result?.status === "provider_error" && <p role="alert" className="text-sm text-amber-900">Imagery service unavailable</p>}
        {!error && result?.status === "incomplete" && <p className="text-sm text-amber-900">Search incomplete: some scenes could not be checked. No clear view was verified.</p>}
        {!error && result?.status === "no_clear" && <p className="text-sm text-gray-700">No clear image found</p>}
        {clear && <>
          <p className="font-semibold text-green-900">No clouds detected over this parcel</p>
          <p className="mt-1 text-sm text-gray-700">Captured {result.captured_at?.replace("T", " ").replace(/(?:\.\d+)?(?:Z|\+00:00)$/, " UTC")}</p>
          <Image unoptimized src={`data:image/png;base64,${result.image_base64}`}
            width={result.width} height={result.height}
            alt={`No clouds detected over Survey ${parcel.survey_no} · captured ${observedDate}`}
            onError={() => setError("Preview could not be displayed")}
            className="mt-3 h-64 w-full rounded border border-gray-200 bg-gray-100 object-contain [image-rendering:pixelated] sm:h-80" />
          <p className="mt-2 text-xs text-gray-600">Only the checked parcel crop is shown. Cloud classification can miss clouds. Display enlargement adds no ground detail.</p>
          <details className="mt-3 rounded border border-gray-200 p-3 text-xs text-gray-700">
            <summary className="cursor-pointer py-1 font-semibold text-gov">Scene and cloud-check details</summary>
            <dl className="mt-3 grid gap-3 sm:grid-cols-2">
              <div className="min-w-0"><dt className="font-semibold">Scene</dt><dd className="break-all">{result.scene_id}</dd></div>
              <div><dt className="font-semibold">Source</dt><dd>{result.source}</dd></div>
              <div><dt className="font-semibold">Parcel check</dt><dd>{result.sampled_pixels} pixels at {result.mask_resolution_m} m classification resolution; all classified as vegetation, bare soil or water.</dd></div>
              <div><dt className="font-semibold">Retention</dt><dd>On-demand preview; not registered as a case scene.</dd></div>
            </dl>
            <p className="mt-3">Contains modified Copernicus Sentinel data, served through Earth Search. This check does not assess encroachment.</p>
          </details>
        </>}
        {result && <p className="mt-3 text-xs text-gray-600">Checked {result.checked_scenes} scene{result.checked_scenes === 1 ? "" : "s"} in the search window.
          {result.search_limited && " Search reached its scene or time limit; older candidates may remain."}</p>}
        {!!result?.unassessed_scenes && <p className="mt-2 text-xs text-amber-900">{result.unassessed_scenes} {clear ? "newer " : ""}candidate{result.unassessed_scenes === 1 ? "" : "s"} could not be assessed.{clear && " A newer clear view may exist."}</p>}
      </div>
      <button type="button" disabled={loading} onClick={() => setAttempt(value => value + 1)}
        className="mt-4 min-h-11 rounded border border-gray-300 px-3 text-sm font-semibold text-gov disabled:opacity-50">Search again</button>
      <p className="mt-4 rounded border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-900">Screening context only. Confirm findings with cadastral records, surveys, and field inspection.</p>
    </section>
    <details className="min-w-0" onToggle={event => setBrowse(event.currentTarget.open)}>
      <summary className="cursor-pointer py-3 text-sm font-semibold text-gov">Browse imagery without cloud checks</summary>
      {browse && <HistoricalImageryTimeline parcel={parcel} />}
    </details>
  </div>;
}
