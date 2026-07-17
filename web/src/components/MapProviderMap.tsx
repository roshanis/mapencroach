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
      <div
        role="status"
        className="absolute bottom-7 left-3 z-10 max-w-xs rounded border border-amber-300 bg-amber-50/95 px-3 py-2 text-xs font-medium text-amber-950 shadow"
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
