"use client";

// Client-only dynamic wrapper around MapLibreMap so that maplibre-gl (which
// requires a browser/WebGL context) is never pulled into the server bundle
// or into the Vitest/jsdom test environment.

import dynamic from "next/dynamic";
import type { MapLibreMapProps } from "./MapLibreMap";

const MapLibreMap = dynamic(() => import("./MapLibreMap"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full items-center justify-center bg-gray-100 text-sm text-gray-500">
      Loading map...
    </div>
  ),
});

export default function MapView(props: MapLibreMapProps) {
  return <MapLibreMap {...props} />;
}
