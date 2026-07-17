"use client";

// Client-only dynamic wrapper around the configured provider so browser map
// SDKs are never pulled into the server bundle or Vitest/jsdom environment.

import dynamic from "next/dynamic";
import type { OperationalMapProps } from "./map-types";

const MapProviderMap = dynamic(() => import("./MapProviderMap"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full items-center justify-center bg-gray-100 text-sm text-gray-500">
      Loading map...
    </div>
  ),
});

export default function MapView(props: OperationalMapProps) {
  return <MapProviderMap {...props} />;
}
