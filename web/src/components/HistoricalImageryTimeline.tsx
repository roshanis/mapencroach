"use client";

import Image from "next/image";
import { useMemo, useReducer, useState } from "react";
import { LATEST_IMAGERY_LAYER, monthlyScenes, sampleImageBlankness, type SceneWindow } from "@/lib/latest-imagery";
import { activeBrowseIds, browseViewReducer, createBrowseView, BROWSE_STATUS_LABELS } from "@/lib/imagery-view";
import type { Parcel } from "@/lib/types";
import { ImageryAvailabilityTimeline } from "./ImageryAvailabilityTimeline";
import { ImagerySourceDetails } from "./ImagerySourceDetails";

const WMS_ENDPOINT = "https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi";

function imageBounds(parcel: Parcel): [number, number, number, number] {
  const [longitude, latitude] = parcel.centroid;
  return [
    longitude - 0.08,
    latitude - 0.045,
    longitude + 0.08,
    latitude + 0.045,
  ];
}

function buildWmsImageUrl(parcel: Parcel, time: string) {
  const boundingBox = imageBounds(parcel)
    .map((coordinate) => coordinate.toFixed(6))
    .join(",");
  // PNG + transparency so a date with no satellite pass yields detectably
  // transparent pixels instead of an opaque black JPEG.
  return `${WMS_ENDPOINT}?SERVICE=WMS&REQUEST=GetMap&VERSION=1.1.1&LAYERS=${LATEST_IMAGERY_LAYER}&STYLES=&FORMAT=image/png&TRANSPARENT=TRUE&SRS=EPSG:4326&BBOX=${boundingBox}&WIDTH=960&HEIGHT=540&TIME=${time}`;
}

function ParcelBoundaryOverlay({ parcel }: { parcel: Parcel }) {
  const [west, south, east, north] = imageBounds(parcel);
  const ring = parcel.geometry.coordinates[0] ?? [];
  if (ring.length === 0) return null;

  const points = ring
    .map(([longitude, latitude]) => {
      const x = ((longitude - west) / (east - west)) * 100;
      const y = ((north - latitude) / (north - south)) * 100;
      return `${x.toFixed(3)},${y.toFixed(3)}`;
    })
    .join(" ");

  return (
    <svg
      data-testid="parcel-boundary-overlay"
      role="img"
      aria-label={`Parcel boundary for Survey ${parcel.survey_no}`}
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      className="pointer-events-none absolute inset-0 h-full w-full"
    >
      <polygon
        points={points}
        fill="rgba(28,79,140,0.14)"
        stroke="#ffffff"
        strokeWidth="1.2"
        vectorEffect="non-scaling-stroke"
      />
      <polygon
        points={points}
        fill="none"
        stroke="#1c4f8c"
        strokeWidth="0.55"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

/** A geometry change creates a fresh controller, isolating old image callbacks. */
export function HistoricalImageryTimeline({ parcel }: { parcel: Parcel }) {
  const identity = JSON.stringify([parcel.id, parcel.centroid, parcel.geometry]);
  return <ParcelImageryBrowser key={identity} parcel={parcel} />;
}

function ParcelImageryBrowser({ parcel }: { parcel: Parcel }) {
  const windows = useMemo(() => monthlyScenes(), []);
  const [state, dispatch] = useReducer(browseViewReducer, windows, createBrowseView);
  const [reveal, setReveal] = useState(50);
  const activeIds = activeBrowseIds(state);
  const active = activeIds.map(id => windows.find(window => window.id === id)!);
  const compare = state.mode === "compare";
  const sameRequest = compare && active.length === 2 && state.results[active[0].id].requestedDate === state.results[active[1].id].requestedDate;
  const ready = active.every(window => ["preview", "unverified"].includes(state.results[window.id].status));
  const failed = active.some(window => ["empty", "error"].includes(state.results[window.id].status));
  const year = windows.find(window => window.id !== "latest")?.startDate.slice(0, 4) ?? new Date().getUTCFullYear();

  function sceneImage(window: SceneWindow, alt: string, shared = false) {
    const result = state.results[window.id];
    if (["error", "empty"].includes(result.status)) return null;
    const requests = (shared ? active : [window]).map(w => ({id:w.id,...state.results[w.id]}));
    return <Image key={requests.map(r => `${r.id}:${r.requestedDate}:${r.requestId}`).join("|")}
      src={buildWmsImageUrl(parcel, result.requestedDate)} alt={alt} fill unoptimized
      sizes="(max-width: 1024px) 100vw, 960px" className="object-cover" crossOrigin="anonymous"
      onLoad={event => {
        if (!requests.some(r => r.status === "loading")) return;
        const blank = sampleImageBlankness(event.currentTarget);
        dispatch({type:"settle",requests,outcome:blank === null ? "unverified" : blank ? "blank" : "preview"});
      }} onError={() => dispatch({type:"settle",requests,outcome:"error"})} />;
  }
  function status(window: SceneWindow, side?: string) {
    const result = state.results[window.id];
    return <div className="min-w-0 rounded bg-gray-50 p-3 text-xs text-gray-700" key={window.id}>
      <p className="font-semibold">{side ? `${side} · ` : ""}{window.label}: {BROWSE_STATUS_LABELS[result.status]}</p>
      <p className="mt-1">Requested browse date: {result.requestedDate}</p>
      {result.status === "loading" && <p>Searching back within {window.startDate} to {window.endDate}…</p>}
      {result.status === "empty" && <p>No nonblank preview was found in this search window. This does not establish cloud conditions, missing coverage, or absence of change.</p>}
      {result.status === "error" && <p role="alert">Imagery could not be loaded. A service error does not establish a coverage gap.</p>}
      {["error","empty"].includes(result.status) && <button type="button" onClick={()=>dispatch({type:"retry",id:window.id})}
        className="mt-2 min-h-11 rounded border border-gray-400 px-3 font-semibold text-gov">Retry {side ? `${side} ` : ""}imagery</button>}
      <ImagerySourceDetails observation={{kind:"browse",window,result}} title={`${side ? `${side} ` : ""}Source details`} />
    </div>;
  }
  return <section className="min-w-0 rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
    <h2 className="text-base font-semibold text-gray-900">Imagery Timeline</h2>
    <p className="mt-1 text-sm text-gray-600">Monthly {year} true-color snapshots around Survey {parcel.survey_no}</p>
    <div role="group" aria-label="Imagery view" className="mt-3 flex flex-wrap gap-2">
      <button type="button" aria-pressed={!compare} onClick={()=>dispatch({type:"view",view:"single"})} className="min-h-11 rounded border border-gray-300 px-3 text-sm font-semibold text-gov">Single month</button>
      <button type="button" aria-pressed={compare} disabled={windows.length < 2} onClick={()=>dispatch({type:"view",view:"compare"})} className="min-h-11 rounded border border-gray-300 px-3 text-sm font-semibold text-gov disabled:opacity-50">Compare months</button>
    </div>
    {windows.length < 2 && <p className="mt-2 text-xs text-gray-600">Two distinct date windows are needed for comparison.</p>}
    {compare && <div className="mt-3 flex flex-wrap items-end gap-3">
      {(["a","b"] as const).map(side=><label className="flex min-w-0 flex-col gap-1 text-sm font-medium text-gray-700" key={side}>
        {side.toUpperCase()} imagery window
        <select aria-label={`${side.toUpperCase()} imagery window`} value={state[side]} onChange={event=>dispatch({type:"choose",side,id:event.target.value})}
          className="min-h-11 max-w-full rounded border border-gray-300 bg-white px-3">
          {windows.map(w=><option value={w.id} key={w.id} disabled={w.id===state[side==="a"?"b":"a"]}>{w.label} · {w.startDate} to {w.endDate}</option>)}
        </select>
      </label>)}
      <button type="button" onClick={()=>dispatch({type:"swap"})} className="min-h-11 rounded border border-gray-300 px-3 text-sm font-semibold text-gov">Swap A and B</button>
    </div>}
    {!compare && <ImageryAvailabilityTimeline label="Imagery month" items={windows.map(w=>({id:w.id,label:w.label,status:BROWSE_STATUS_LABELS[state.results[w.id].status]}))}
      selectedIds={[state.selectedId]} onSelect={id=>dispatch({type:"select",id})} />}
    {active.length > 0 && <div className="mt-4" data-testid={compare ? "imagery-comparison" : "imagery-single"}>
      <div className="relative aspect-video overflow-hidden rounded-lg border border-gray-200 bg-gray-100">
        {sceneImage(active[0],compare ? `A · ${active[0].label} ${year} image from HLS Sentinel-2` : `${active[0].label} ${year} HLS Sentinel-2 true-color snapshot`,sameRequest)}
        {compare && active[1] && !sameRequest && <div data-testid="after-image-layer" className="absolute inset-0" style={{clipPath:`inset(0 0 0 ${100-reveal}%)`}}>
          {sceneImage(active[1],`B · ${active[1].label} image from HLS Sentinel-2`)}
        </div>}
        {!ready && <div role="status" className="absolute inset-0 grid place-items-center bg-gray-100/95 px-4 text-center text-sm text-gray-700">
          {failed ? "Preview unavailable. See the date status below." : "Searching previews…"}
        </div>}
        <ParcelBoundaryOverlay parcel={parcel} />
        {compare && !sameRequest && <div aria-hidden className="pointer-events-none absolute inset-y-0 w-0.5 bg-white" style={{left:`${100-reveal}%`}} />}
        <span className="absolute left-2 top-2 rounded bg-gray-950/80 px-2 py-1 text-xs text-white">{compare ? "A · " : ""}{active[0].label}</span>
        {compare && <span className="absolute right-2 top-2 rounded bg-gray-950/80 px-2 py-1 text-xs text-white">B · {active[1]?.label}</span>}
      </div>
      {compare && active[1] && <>
        <label className="mt-3 block text-xs font-medium text-gray-700">Reveal B imagery
          <input type="range" min="0" max="100" value={reveal} disabled={!ready || sameRequest}
            aria-label={`Compare A ${active[0].label} (${state.results[active[0].id].requestedDate}) and B ${active[1].label} (${state.results[active[1].id].requestedDate})`}
            onChange={event=>setReveal(Number(event.target.value))} className="mt-2 block w-full accent-gov" />
        </label>
        {sameRequest && <p className="mt-2 text-sm text-amber-900">Both windows currently request the same browse date. Choose distinct previews to compare.</p>}
        <p className="mt-3 text-xs text-gray-700">Same HLS Sentinel-2 product, 30 m nominal resolution, and requested map extent. This visual preview comparison does not establish source-image alignment or parcel-level change.</p>
      </>}
      <div className={`mt-3 grid gap-3 ${compare ? "sm:grid-cols-2" : ""}`}>{active.map((w,i)=>status(w,compare ? (i===0?"A":"B") : undefined))}</div>
    </div>}
    <p className="mt-4 rounded border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-900">Planning context only — this imagery is not enforcement evidence. Confirm findings with authoritative cadastral records, surveys, and field inspection.</p>
    <p className="mt-3 text-xs text-gray-600">Imagery served by <a className="font-medium text-gov underline" href="https://nasa-gibs.github.io/gibs-api-docs/" target="_blank" rel="noreferrer">NASA GIBS</a>. Quality and acquisition time require source verification.</p>
  </section>;
}
