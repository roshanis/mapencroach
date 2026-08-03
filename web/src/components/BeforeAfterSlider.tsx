"use client";

import { useEffect, useState } from "react";
import { authHeaders, getApiBase } from "@/lib/api";
import type { Scene } from "@/lib/types";

export interface BeforeAfterSliderProps {
  beforeScene?: Scene;
  afterScene?: Scene;
  /** Overrides the API base normally read from NEXT_PUBLIC_API_URL. */
  apiBase?: string;
  /** Overrides the bearer token normally read from the auth cookie/env. */
  token?: string;
  /**
   * Slippy-map zoom for the single preview tile fetched per scene. This is a
   * lightweight before/after preview, not a pannable tile pyramid, so one
   * tile centered on the scene footprint is enough.
   */
  zoom?: number;
}

const DEFAULT_ZOOM = 15;

function sceneCentroid(scene: Scene): [number, number] {
  const [west, south, east, north] = scene.stac_item.bbox;
  return [(west + east) / 2, (south + north) / 2];
}

/** Standard slippy-map lon/lat -> tile x/y conversion (Web Mercator). */
function lonLatToTile(lon: number, lat: number, zoom: number): { x: number; y: number } {
  const latRad = (lat * Math.PI) / 180;
  const n = 2 ** zoom;
  const x = Math.floor(((lon + 180) / 360) * n);
  const y = Math.floor(
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n
  );
  const clamp = (value: number) => Math.min(Math.max(value, 0), n - 1);
  return { x: clamp(x), y: clamp(y) };
}

function tileUrl(base: string, scene: Scene, zoom: number): string {
  const [lon, lat] = sceneCentroid(scene);
  const { x, y } = lonLatToTile(lon, lat, zoom);
  return `${base}/tiles/${scene.scene_id}/${zoom}/${x}/${y}.png`;
}

type TileStatus = "loading" | "ready" | "error";

/**
 * Fetches one tile as a blob (not a bare <img src>) because /tiles requires
 * a Bearer Authorization header that an <img> tag cannot attach itself.
 */
function useSceneTile(
  scene: Scene | undefined,
  base: string | undefined,
  token: string | undefined,
  zoom: number
) {
  const [status, setStatus] = useState<TileStatus>("loading");
  const [objectUrl, setObjectUrl] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (!scene || !base) {
      setStatus("error");
      return;
    }
    let cancelled = false;
    let createdUrl: string | undefined;
    setStatus("loading");
    setObjectUrl(undefined);

    fetch(tileUrl(base, scene, zoom), { headers: authHeaders(token) })
      .then((res) => {
        if (!res.ok) throw new Error(`tile request failed: ${res.status}`);
        return res.blob();
      })
      .then((blob) => {
        if (cancelled) return;
        createdUrl = URL.createObjectURL(blob);
        setObjectUrl(createdUrl);
        setStatus("ready");
      })
      .catch(() => {
        if (!cancelled) setStatus("error");
      });

    return () => {
      cancelled = true;
      if (createdUrl) URL.revokeObjectURL(createdUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene?.scene_id, base, token, zoom]);

  return { status, objectUrl };
}

function sceneCaption(scene: Scene): string {
  return `${scene.captured_at.slice(0, 10)} · ${scene.sensor}`;
}

export function BeforeAfterSlider({
  beforeScene,
  afterScene,
  apiBase,
  token,
  zoom = DEFAULT_ZOOM,
}: BeforeAfterSliderProps) {
  const base = apiBase ?? getApiBase();
  const [position, setPosition] = useState(50);
  const before = useSceneTile(beforeScene, base, token, zoom);
  const after = useSceneTile(afterScene, base, token, zoom);

  if (!beforeScene || !afterScene || !base) {
    return (
      <div
        role="status"
        data-testid="before-after-placeholder"
        className="flex aspect-video items-center justify-center rounded-lg border border-gray-200 bg-gray-100 px-6 text-center"
      >
        <p className="max-w-sm text-sm text-gray-500">
          Before/after comparison needs at least two registered scenes from a
          configured imagery backend.
        </p>
      </div>
    );
  }

  return (
    <section aria-label="Before/after imagery comparison" data-testid="before-after-slider">
      <div className="relative aspect-video overflow-hidden rounded-lg border border-gray-200 bg-gray-100">
        {before.status === "ready" && before.objectUrl ? (
          <img
            src={before.objectUrl}
            alt={`Before: ${sceneCaption(beforeScene)}`}
            className="absolute inset-0 h-full w-full object-cover"
          />
        ) : (
          <div className="absolute inset-0 grid place-items-center text-sm text-gray-500">
            {before.status === "error" ? "Before tile unavailable" : "Loading before tile…"}
          </div>
        )}

        <div
          className="absolute inset-0 h-full w-full overflow-hidden"
          style={{ clipPath: `inset(0 ${100 - position}% 0 0)` }}
        >
          {after.status === "ready" && after.objectUrl ? (
            <img
              src={after.objectUrl}
              alt={`After: ${sceneCaption(afterScene)}`}
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="grid h-full w-full place-items-center text-sm text-gray-500">
              {after.status === "error" ? "After tile unavailable" : "Loading after tile…"}
            </div>
          )}
        </div>

        <div
          aria-hidden
          className="absolute inset-y-0 w-0.5 -translate-x-1/2 bg-white shadow-[0_0_0_1px_rgba(0,0,0,0.15)]"
          style={{ left: `${position}%` }}
        />
      </div>

      <input
        type="range"
        aria-label="Before/after comparison position"
        min={0}
        max={100}
        value={position}
        onChange={(event) => setPosition(Number(event.target.value))}
        className="mt-3 w-full accent-gov"
      />

      <div className="mt-2 flex justify-between text-xs text-gray-500">
        <span>Before · {sceneCaption(beforeScene)}</span>
        <span>After · {sceneCaption(afterScene)}</span>
      </div>
    </section>
  );
}
