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
    <div className="flex h-full w-full flex-col">
      {/* Provider status has its own row and never covers map controls. */}
      <div
        role="status"
        data-testid="map-provider-notice"
        className="flex shrink-0 items-center justify-center border-b border-amber-300 bg-amber-50 px-3 py-2 text-center text-xs font-medium text-amber-950"
      >
        {reason}
      </div>
      <div className="relative min-h-0 flex-1">
        <MapLibreMap {...props} />
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
