"use client";

import { useEffect, useRef, useState } from "react";
import { LAND_CATEGORY_COLORS } from "@/lib/types";
import { createAlertMarkerElement, styleAlertMarker } from "./alertMarker";
import { BasemapToggle, type BasemapMode } from "./BasemapToggle";
import { loadGoogleMapLibraries, onGoogleMapsAuthFailure } from "./googleMapsLoader";
import type { OperationalMapProps } from "./map-types";

export interface GoogleMapProps extends OperationalMapProps {
  apiKey: string;
  mapId: string;
  onProviderError: () => void;
}

export default function GoogleMap({
  apiKey,
  mapId,
  parcels,
  alerts,
  center = [78.03, 29.92],
  zoom = 11,
  onReady,
  onAlertClick,
  selectedAlertId,
  onProviderError,
}: GoogleMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const markerElementsRef = useRef<Map<string, HTMLButtonElement>>(new Map());
  const onAlertClickRef = useRef(onAlertClick);
  const selectedAlertIdRef = useRef(selectedAlertId);
  const onProviderErrorRef = useRef(onProviderError);
  const [mode, setMode] = useState<BasemapMode>("satellite");
  const [loading, setLoading] = useState(true);

  function handleBasemapChange(newMode: BasemapMode) {
    setMode(newMode);
    mapRef.current?.setMapTypeId(newMode === "satellite" ? "hybrid" : "roadmap");
  }

  useEffect(() => {
    onAlertClickRef.current = onAlertClick;
  }, [onAlertClick]);

  useEffect(() => {
    onProviderErrorRef.current = onProviderError;
  }, [onProviderError]);

  useEffect(() => {
    selectedAlertIdRef.current = selectedAlertId;
    markerElementsRef.current.forEach((element, alertId) => {
      styleAlertMarker(element, alertId === selectedAlertId);
    });
  }, [selectedAlertId]);

  // CONSTRAINT: `parcels`, `alerts`, `center`, and `zoom` are read once, at
  // mount, by the effect below (empty dep array) — they are a snapshot, not
  // a live binding. A parent that re-renders this component with new
  // parcels/alerts/center/zoom after the initial mount will NOT see the map
  // update; the Google Data layer and AdvancedMarkerElements created here
  // are never rebuilt. This is currently safe only because MapView mounts
  // this component once data is already loaded and fully remounts it (fresh
  // key) on retry — so in practice the values never change under a mounted
  // instance today. `selectedAlertId`, `onAlertClick`, and `onProviderError`
  // are the only props that ARE live, via the ref pattern below.
  //
  // Before adding any feature that streams updated parcels/alerts/center/
  // zoom into an already-mounted map, this effect needs real sync, not a
  // fresh mount: parcels via clearing + re-adding map.data (or diffing
  // features), alerts via reconciling AdvancedMarkerElements (add new,
  // remove stale, matching MapLibreMap's marker Map<id, element> pattern),
  // and center/zoom via explicit map.panTo/map.setZoom calls in their own
  // effect. Do not silently assume props are live without doing this.
  useEffect(() => {
    let cancelled = false;
    const markers: google.maps.marker.AdvancedMarkerElement[] = [];
    const markerClickCleanups: Array<() => void> = [];
    const markerElements = markerElementsRef.current;

    // An invalid key, referrer restriction, or disabled billing all resolve
    // importLibrary() successfully — the catch block below never fires.
    // Google instead reports these through the gm_authFailure global; wire
    // it to the same fallback path so a permanently gray map still recovers.
    const unsubscribeAuthFailure = onGoogleMapsAuthFailure(() => {
      if (!cancelled) onProviderErrorRef.current();
    });

    async function init() {
      try {
        const { Map, AdvancedMarkerElement } = await loadGoogleMapLibraries(apiKey);
        if (cancelled || !containerRef.current) return;

        const map = new Map(containerRef.current, {
          center: { lat: center[1], lng: center[0] },
          zoom,
          mapId,
          mapTypeId: "hybrid",
          clickableIcons: false,
          fullscreenControl: true,
          mapTypeControl: false,
          streetViewControl: false,
          zoomControl: true,
          // "auto" (the default) sometimes decides a map that doesn't
          // dominate the viewport — e.g. next to the alert sidebar on an
          // iPad — needs two fingers to pan, to avoid stealing page
          // scroll. This map's page never scrolls around it, so a single
          // finger should always drag the map; "greedy" makes that
          // unconditional instead of heuristic.
          gestureHandling: "greedy",
        });
        mapRef.current = map;

        map.data.addGeoJson({
          type: "FeatureCollection",
          features: parcels.map((parcel) => ({
            type: "Feature",
            geometry: parcel.geometry,
            properties: {
              id: parcel.id,
              boundary_grade: parcel.boundary_grade,
              land_category: parcel.land_category,
            },
          })),
        });
        map.data.setStyle((feature) => {
          const category = feature.getProperty("land_category");
          const color =
            typeof category === "string" && category in LAND_CATEGORY_COLORS
              ? LAND_CATEGORY_COLORS[
                  category as keyof typeof LAND_CATEGORY_COLORS
                ]
              : "#999999";
          return {
            fillColor: color,
            fillOpacity: 0.25,
            strokeColor: color,
            strokeOpacity: 1,
            strokeWeight: 2.5,
          };
        });

        for (const alert of alerts) {
          const parcel = parcels.find((candidate) => candidate.id === alert.parcel_id);
          if (!parcel) continue;

          const element = createAlertMarkerElement(
            alert,
            alert.id === selectedAlertIdRef.current
          );
          markerElements.set(alert.id, element);

          const clickHandler = () => onAlertClickRef.current?.(alert.id);
          element.addEventListener("click", clickHandler);
          markerClickCleanups.push(() =>
            element.removeEventListener("click", clickHandler)
          );

          const marker = new AdvancedMarkerElement({
            map,
            position: { lat: parcel.centroid[1], lng: parcel.centroid[0] },
            content: element,
            title: `Alert ${alert.id}`,
          });
          markers.push(marker);
        }

        onReady?.({
          panTo: (lngLat) => {
            map.panTo({ lat: lngLat[1], lng: lngLat[0] });
            map.setZoom(15);
          },
        });
        setLoading(false);
      } catch {
        if (!cancelled) onProviderErrorRef.current();
      }
    }

    void init();

    return () => {
      cancelled = true;
      unsubscribeAuthFailure();
      markerClickCleanups.forEach((cleanup) => cleanup());
      markers.forEach((marker) => {
        marker.map = null;
      });
      markerElements.clear();
      mapRef.current = null;
    };
    // Intentionally mount-only — see the CONSTRAINT comment above this
    // effect. Selection and callbacks are kept current through refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="relative h-full w-full">
      <div
        ref={containerRef}
        data-testid="google-map-container"
        aria-label="Google map with monitored parcel boundaries"
        className="h-full w-full"
      />
      {loading ? (
        <div
          role="status"
          className="pointer-events-none absolute inset-0 flex items-center justify-center bg-gray-100 text-sm text-gray-600"
        >
          Loading Google map...
        </div>
      ) : null}
      <div className="absolute left-[max(0.75rem,env(safe-area-inset-left,0px))] top-[max(0.75rem,env(safe-area-inset-top,0px))] z-10">
        <BasemapToggle mode={mode} onChange={handleBasemapChange} />
      </div>
    </div>
  );
}
