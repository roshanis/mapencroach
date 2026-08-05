"use client";

import Image from "next/image";
import { useMemo, useState } from "react";
import {
  LATEST_IMAGERY_LAYER,
  type SceneWindow,
  isoDayBefore,
  monthlyScenes,
  sampleImageBlankness,
} from "@/lib/latest-imagery";
import type { Parcel } from "@/lib/types";

// Every scene is the same sensor at the same resolution, which is what makes
// month-to-month comparison honest.
const SCENE_SOURCE = "NASA GIBS · Harmonized Landsat Sentinel-2 (HLS S30)";
const SCENE_RESOLUTION = "30 m, most recent clear pass of the period";
const WMS_ENDPOINT = "https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi";

type ImageryView = "single" | "compare";
type SceneStatus = "loaded" | "failed";

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

export function HistoricalImageryTimeline({ parcel }: { parcel: Parcel }) {
  const scenes = useMemo(() => monthlyScenes(), []);
  const year = scenes[0].startDate.slice(0, 4);
  const [view, setView] = useState<ImageryView>("single");
  const [selectedId, setSelectedId] = useState("latest");
  const [afterReveal, setAfterReveal] = useState(50);
  // Per-scene search state: the date currently being tried (defaults to the
  // scene window's end) and the outcome once the search settles.
  const [attemptDates, setAttemptDates] = useState<Record<string, string>>({});
  const [statuses, setStatuses] = useState<Record<string, SceneStatus>>({});

  const selectedScene =
    scenes.find((scene) => scene.id === selectedId) ?? scenes[scenes.length - 1];

  const attemptDateFor = (scene: SceneWindow) =>
    attemptDates[scene.id] ?? scene.endDate;

  const advanceSearch = (scene: SceneWindow) => {
    const previous = isoDayBefore(attemptDateFor(scene));
    if (previous < scene.startDate) {
      setStatuses((current) => ({ ...current, [scene.id]: "failed" }));
    } else {
      setAttemptDates((current) => ({ ...current, [scene.id]: previous }));
    }
  };

  const handleImageLoad = (scene: SceneWindow, image: HTMLImageElement) => {
    if (statuses[scene.id]) return;
    // A date with no pass still loads as a valid, blank image; only a
    // verifiably non-blank load ends the search. Unverifiable pixels
    // (no canvas / CORS taint) are accepted rather than discarded.
    if (sampleImageBlankness(image) === true) {
      advanceSearch(scene);
      return;
    }
    setStatuses((current) => ({ ...current, [scene.id]: "loaded" }));
  };

  const handleImageError = (scene: SceneWindow) => {
    if (statuses[scene.id]) return;
    advanceSearch(scene);
  };

  const sceneImage = (scene: SceneWindow, alt: string) => (
    <Image
      key={`${scene.id}-${attemptDateFor(scene)}`}
      src={buildWmsImageUrl(parcel, attemptDateFor(scene))}
      alt={alt}
      fill
      sizes="(max-width: 1024px) 100vw, 960px"
      className="object-cover"
      crossOrigin="anonymous"
      onLoad={(event) => handleImageLoad(scene, event.currentTarget)}
      onError={() => handleImageError(scene)}
    />
  );

  const selectedStatus = statuses[selectedScene.id];
  const comparisonBefore = scenes[0];
  const comparisonAfter = scenes[scenes.length - 1];
  const comparisonAvailable = scenes.length > 1;

  const captureText = (scene: SceneWindow) => {
    const status = statuses[scene.id];
    if (status === "loaded") return `${attemptDateFor(scene)} observation`;
    if (status === "failed") return `no clear pass ${scene.label} ${year}`;
    return `searching back from ${attemptDateFor(scene)}…`;
  };

  return (
    <section className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-base font-semibold text-gray-900">
            Imagery Timeline
          </h2>
          <p className="mt-1 text-sm text-gray-500">
            Monthly {year} true-color snapshots around Survey {parcel.survey_no}
          </p>
        </div>
        <div className="flex flex-col items-stretch gap-2 sm:items-end">
          {comparisonAvailable && (
            <div
              role="group"
              aria-label="Imagery view"
              className="grid grid-cols-2 gap-1 rounded-lg bg-gray-100 p-1"
            >
              {(["single", "compare"] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  aria-pressed={view === option}
                  onClick={() => setView(option)}
                  className={`min-h-11 rounded-md px-3 py-2 text-xs font-semibold transition focus:outline-none focus:ring-2 focus:ring-gov focus:ring-offset-1 ${
                    view === option
                      ? "bg-white text-gov shadow-sm"
                      : "text-gray-600 hover:text-gray-900"
                  }`}
                >
                  {option === "single" ? "Single month" : "Compare months"}
                </button>
              ))}
            </div>
          )}
          {view === "single" && (
            <div
              role="group"
              aria-label="Imagery month"
              className="flex flex-wrap justify-end gap-1 rounded-lg bg-gray-100 p-1"
            >
              {scenes.map((scene) => {
                const selected = scene.id === selectedScene.id;
                return (
                  <button
                    key={scene.id}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => setSelectedId(scene.id)}
                    className={`min-h-11 rounded-md px-3 py-2 text-xs font-semibold transition focus:outline-none focus:ring-2 focus:ring-gov focus:ring-offset-1 ${
                      selected
                        ? "bg-gov text-white shadow-sm"
                        : "text-gray-600 hover:bg-white hover:text-gray-900"
                    }`}
                  >
                    {scene.label}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {view === "compare" && comparisonAvailable ? (
        <div className="mt-4" data-testid="imagery-comparison">
          <div className="relative aspect-video overflow-hidden rounded-lg border border-gray-200 bg-gray-100">
            {sceneImage(
              comparisonBefore,
              `${comparisonBefore.label} ${year} before image from HLS Sentinel-2`
            )}
            <div
              data-testid="after-image-layer"
              className="absolute inset-0"
              style={{ clipPath: `inset(0 0 0 ${100 - afterReveal}%)` }}
            >
              {sceneImage(
                comparisonAfter,
                `${comparisonAfter.label} after image from HLS Sentinel-2`
              )}
            </div>
            <div
              aria-hidden
              className="pointer-events-none absolute inset-y-0 w-0.5 bg-white shadow"
              style={{ left: `${100 - afterReveal}%` }}
            />
            <ParcelBoundaryOverlay parcel={parcel} />
            <span className="absolute left-3 top-3 rounded bg-gray-950/75 px-2 py-1 text-xs font-semibold text-white">
              Before · {comparisonBefore.label} {year}
            </span>
            <span className="absolute right-3 top-3 rounded bg-gray-950/75 px-2 py-1 text-xs font-semibold text-white">
              After · {comparisonAfter.label}
            </span>
          </div>
          <label className="mt-3 flex flex-col gap-2 text-xs font-medium text-gray-700">
            Reveal {comparisonAfter.label} imagery
            <input
              type="range"
              aria-label={`Reveal ${comparisonAfter.label} imagery`}
              min="0"
              max="100"
              value={afterReveal}
              onChange={(event) => setAfterReveal(Number(event.target.value))}
              className="w-full accent-gov"
            />
          </label>
          <div className="mt-3 grid gap-2 text-xs text-gray-600 sm:grid-cols-2">
            <p>
              <b className="text-gray-800">Before:</b>{" "}
              {captureText(comparisonBefore)}
            </p>
            <p>
              <b className="text-gray-800">After:</b>{" "}
              {captureText(comparisonAfter)}
            </p>
          </div>
          <p className="mt-3 rounded-md bg-blue-50 px-3 py-2 text-xs leading-5 text-gov-dark">
            Comparable pair: same HLS Sentinel-2 source, 30 m resolution, and map
            extent. The outlined shape is the parcel boundary.
          </p>
        </div>
      ) : (
        <div className="mt-4 overflow-hidden rounded-lg border border-gray-200 bg-gray-100">
          {selectedStatus === "failed" ? (
            <div className="flex aspect-video items-center justify-center px-6 text-center">
              <div>
                <p className="text-sm font-semibold text-gray-700">
                  No clear pass
                </p>
                <p className="mt-2 max-w-lg text-sm leading-6 text-gray-500">
                  No usable Harmonized Landsat Sentinel-2 pass over this parcel
                  between {selectedScene.startDate} and {selectedScene.endDate} —
                  likely persistent cloud cover. Choose another month or try
                  again later.
                </p>
              </div>
            </div>
          ) : (
            <div className="relative aspect-video">
              {sceneImage(
                selectedScene,
                `${selectedScene.label} ${year} HLS Sentinel-2 true-color snapshot`
              )}
              {selectedStatus !== "loaded" && (
                <div
                  role="status"
                  className="absolute inset-0 grid place-items-center bg-gray-100 text-sm font-medium text-gray-500"
                >
                  Searching satellite passes…
                </div>
              )}
              <div
                aria-hidden
                className="absolute left-1/2 top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-[3px] border-white bg-tier-red shadow-[0_0_0_5px_rgba(196,50,31,0.24)]"
              />
              <span className="absolute left-1/2 top-[calc(50%+1rem)] -translate-x-1/2 rounded bg-gray-950/75 px-2 py-1 text-[10px] font-medium text-white">
                Parcel center
              </span>
            </div>
          )}
        </div>
      )}

      {view === "single" && (
        <div className="mt-4 grid gap-3 text-sm sm:grid-cols-3">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-gray-400">
              Capture
            </p>
            <p className="mt-1 font-medium text-gray-700">
              {captureText(selectedScene)}
            </p>
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-gray-400">
              Source
            </p>
            <p className="mt-1 font-medium text-gray-700">{SCENE_SOURCE}</p>
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-gray-400">
              Resolution
            </p>
            <p className="mt-1 font-medium text-gray-700">{SCENE_RESOLUTION}</p>
          </div>
        </div>
      )}

      <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs leading-5 text-amber-900">
        Planning context only — this imagery is not enforcement evidence. Confirm
        findings with authoritative cadastral records, surveys, and field
        inspection.
      </div>
      <p className="mt-3 text-xs text-gray-500">
        Imagery served by{" "}
        <a
          href="https://nasa-gibs.github.io/gibs-api-docs/"
          target="_blank"
          rel="noreferrer"
          className="font-medium text-gov hover:underline"
        >
          NASA GIBS
        </a>
        . Availability and cloud cover vary by date.
      </p>
    </section>
  );
}
