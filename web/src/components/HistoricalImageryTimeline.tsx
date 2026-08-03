"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { getScenes } from "@/lib/api";
import type { Parcel, Scene } from "@/lib/types";
import { BeforeAfterSlider } from "./BeforeAfterSlider";

interface ImageryScene {
  id: string;
  year: string;
  date: string;
  label: string;
  source: string;
  resolution: string;
  endpoint?: string;
  layer?: string;
  unavailableMessage?: string;
}

const IMAGERY_SCENES: ImageryScene[] = [
  {
    id: "1985",
    year: "1985",
    date: "1985 annual mosaic",
    label: "Landsat WELD",
    source: "NASA GIBS · Landsat WELD",
    resolution: "30 m annual composite",
    unavailableMessage:
      "No usable 1985 Landsat coverage is available for this parcel area from the NASA GIBS annual mosaic.",
  },
  {
    id: "1990",
    year: "1990",
    date: "1990-12-01 annual mosaic",
    label: "Landsat WELD",
    source: "NASA GIBS · Landsat WELD",
    resolution: "30 m annual composite",
    endpoint: "https://gibs.earthdata.nasa.gov/wms/epsg4326/all/wms.cgi",
    layer: "Landsat_WELD_CorrectedReflectance_TrueColor_Global_Annual",
  },
  {
    id: "2000",
    year: "2000",
    date: "2000-12-01 annual mosaic",
    label: "Landsat WELD",
    source: "NASA GIBS · Landsat WELD",
    resolution: "30 m annual composite",
    endpoint: "https://gibs.earthdata.nasa.gov/wms/epsg4326/all/wms.cgi",
    layer: "Landsat_WELD_CorrectedReflectance_TrueColor_Global_Annual",
  },
  {
    id: "2010",
    year: "2010",
    date: "2010-10-15 observation",
    label: "MODIS Terra",
    source: "NASA GIBS · MODIS Terra",
    resolution: "250 m daily observation",
    endpoint: "https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi",
    layer: "MODIS_Terra_CorrectedReflectance_TrueColor",
  },
];

function buildWmsImageUrl(scene: ImageryScene, parcel: Parcel) {
  if (!scene.endpoint || !scene.layer) return null;

  const [longitude, latitude] = parcel.centroid;
  const boundingBox = [
    longitude - 0.08,
    latitude - 0.045,
    longitude + 0.08,
    latitude + 0.045,
  ]
    .map((coordinate) => coordinate.toFixed(6))
    .join(",");
  const time = scene.date.slice(0, 10);

  return `${scene.endpoint}?SERVICE=WMS&REQUEST=GetMap&VERSION=1.1.1&LAYERS=${scene.layer}&STYLES=&FORMAT=image/jpeg&TRANSPARENT=FALSE&SRS=EPSG:4326&BBOX=${boundingBox}&WIDTH=960&HEIGHT=540&TIME=${time}`;
}

export function HistoricalImageryTimeline({ parcel }: { parcel: Parcel }) {
  const [selectedId, setSelectedId] = useState("2010");
  const [failedSceneIds, setFailedSceneIds] = useState<string[]>([]);
  const [loadedSceneIds, setLoadedSceneIds] = useState<string[]>([]);
  const [registeredScenes, setRegisteredScenes] = useState<Scene[]>([]);
  const selectedScene =
    IMAGERY_SCENES.find((scene) => scene.id === selectedId) ??
    IMAGERY_SCENES[IMAGERY_SCENES.length - 1];
  const imageUrl = buildWmsImageUrl(selectedScene, parcel);
  const imageFailed = failedSceneIds.includes(selectedScene.id);

  useEffect(() => {
    let cancelled = false;
    // getScenes never throws — most personas get [] on a 403, which is the
    // expected outcome, not an error, so there is no error state to show
    // here beyond simply not rendering the "registered scene captures"
    // section below.
    getScenes().then((scenes) => {
      if (!cancelled) setRegisteredScenes(scenes);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const scenesByCaptureDate = [...registeredScenes].sort(
    (a, b) => Date.parse(a.captured_at) - Date.parse(b.captured_at)
  );

  return (
    <section className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-base font-semibold text-gray-900">
            Imagery Timeline
          </h2>
          <p className="mt-1 text-sm text-gray-500">
            Historical true-color context around Survey {parcel.survey_no}
          </p>
        </div>
        <div
          aria-label="Historical imagery year"
          className="grid grid-cols-4 gap-1 rounded-lg bg-gray-100 p-1"
        >
          {IMAGERY_SCENES.map((scene) => {
            const selected = scene.id === selectedScene.id;
            return (
              <button
                key={scene.id}
                type="button"
                aria-pressed={selected}
                onClick={() => setSelectedId(scene.id)}
                className={`rounded-md px-3 py-2 text-xs font-semibold transition focus:outline-none focus:ring-2 focus:ring-gov focus:ring-offset-1 ${
                  selected
                    ? "bg-gov text-white shadow-sm"
                    : "text-gray-600 hover:bg-white hover:text-gray-900"
                }`}
              >
                {scene.year}
              </button>
            );
          })}
        </div>
      </div>

      <div className="mt-4 overflow-hidden rounded-lg border border-gray-200 bg-gray-100">
        {selectedScene.unavailableMessage ? (
          <div className="flex aspect-video items-center justify-center px-6 text-center">
            <div>
              <p className="text-sm font-semibold text-gray-700">
                Coverage gap
              </p>
              <p className="mt-2 max-w-lg text-sm leading-6 text-gray-500">
                {selectedScene.unavailableMessage}
              </p>
            </div>
          </div>
        ) : imageFailed ? (
          <div className="flex aspect-video items-center justify-center px-6 text-center">
            <div>
              <p className="text-sm font-semibold text-gray-700">
                Historical image unavailable
              </p>
              <p className="mt-2 text-sm text-gray-500">
                NASA GIBS could not load this scene. Choose another year or try
                again later.
              </p>
            </div>
          </div>
        ) : imageUrl ? (
          <div className="relative aspect-video">
            <Image
              key={selectedScene.id}
              src={imageUrl}
              alt={`${selectedScene.year} ${selectedScene.label} true-color historical context`}
              fill
              sizes="(max-width: 1024px) 100vw, 960px"
              className="object-cover"
              onLoad={() =>
                setLoadedSceneIds((current) =>
                  current.includes(selectedScene.id)
                    ? current
                    : [...current, selectedScene.id]
                )
              }
              onError={() =>
                setFailedSceneIds((current) =>
                  current.includes(selectedScene.id)
                    ? current
                    : [...current, selectedScene.id]
                )
              }
            />
            {!loadedSceneIds.includes(selectedScene.id) && (
              <div
                role="status"
                className="absolute inset-0 grid place-items-center bg-gray-100 text-sm font-medium text-gray-500"
              >
                Loading historical image…
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
        ) : null}
      </div>

      <div className="mt-4 grid gap-3 text-sm sm:grid-cols-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-gray-400">
            Capture
          </p>
          <p className="mt-1 font-medium text-gray-700">{selectedScene.date}</p>
        </div>
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-gray-400">
            Source
          </p>
          <p className="mt-1 font-medium text-gray-700">
            {selectedScene.source}
          </p>
        </div>
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-gray-400">
            Resolution
          </p>
          <p className="mt-1 font-medium text-gray-700">
            {selectedScene.resolution}
          </p>
        </div>
      </div>

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

      {scenesByCaptureDate.length > 0 && (
        <div className="mt-6 border-t border-gray-200 pt-5">
          <h3 className="text-sm font-semibold text-gray-900">
            Registered scene captures
          </h3>
          <p className="mt-1 text-xs text-gray-500">
            Higher-resolution satellite scenes ingested for this area of
            interest, listed chronologically.
          </p>
          <ul className="mt-3 flex flex-col gap-2 text-sm">
            {scenesByCaptureDate.map((scene) => (
              <li
                key={scene.scene_id}
                className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded border border-gray-100 px-3 py-2"
              >
                <span className="font-medium text-gray-900">
                  {scene.captured_at.slice(0, 10)}
                </span>
                <span className="text-gray-500">{scene.sensor}</span>
                <span className="text-gray-500">
                  {scene.resolution_m} m resolution
                </span>
                <span className="text-gray-500">
                  {scene.cloud_pct}% cloud
                </span>
              </li>
            ))}
          </ul>

          {scenesByCaptureDate.length >= 2 && (
            <div className="mt-5">
              <h3 className="mb-3 text-sm font-semibold text-gray-900">
                Before / after comparison
              </h3>
              <BeforeAfterSlider
                beforeScene={scenesByCaptureDate[0]}
                afterScene={scenesByCaptureDate[scenesByCaptureDate.length - 1]}
              />
            </div>
          )}
        </div>
      )}
    </section>
  );
}
