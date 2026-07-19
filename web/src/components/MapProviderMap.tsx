"use client";

import { useState } from "react";
import GoogleMap from "./GoogleMap";
import MapLibreMap from "./MapLibreMap";
import type { OperationalMapProps } from "./map-types";

function FallbackMap({
  reason,
  ...props
}: OperationalMapProps & { reason: string }) {
  return (
    <div className="relative h-full w-full">
      <MapLibreMap {...props} />
      {/*
        MapLegend is rendered by the page as an independent sibling pinned to
        the bottom-left corner (see console/page.tsx), so this notice can't
        share a DOM parent with it to stack in a flex column. Anchoring it to
        the bottom-right instead -- as a slim single-line strip -- guarantees
        it can never cover a legend row, on this page or anywhere else
        MapProviderMap is embedded (e.g. ParcelMiniMap, which renders no
        legend at all and still needs this notice to be visible on its own).
      */}
      <div
        role="status"
        data-testid="map-provider-notice"
        className="absolute bottom-3 right-3 z-10 max-w-[calc(100vw-1.5rem)] whitespace-nowrap rounded border border-amber-300 bg-amber-50/95 px-3 py-1.5 text-xs font-medium text-amber-950 shadow"
      >
        {reason}
      </div>
    </div>
  );
}

export default function MapProviderMap(props: OperationalMapProps) {
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  const mapId = process.env.NEXT_PUBLIC_GOOGLE_MAP_ID;
  const [googleUnavailable, setGoogleUnavailable] = useState(false);

  if (!apiKey || !mapId) {
    return (
      <FallbackMap
        {...props}
        reason="Google Maps is not configured. Showing the fallback map."
      />
    );
  }

  if (googleUnavailable) {
    return (
      <FallbackMap
        {...props}
        reason="Google Maps could not load. Showing the fallback map."
      />
    );
  }

  return (
    <GoogleMap
      {...props}
      apiKey={apiKey}
      mapId={mapId}
      onProviderError={() => setGoogleUnavailable(true)}
    />
  );
}
