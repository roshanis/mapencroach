"use client";

import { useEffect, useRef, useState } from "react";
import { LAND_CATEGORY_COLORS } from "@/lib/types";
import type { AlertTier } from "@/lib/types";
import { BasemapToggle, type BasemapMode } from "./BasemapToggle";
import { loadGoogleMapLibraries } from "./googleMapsLoader";
import type { OperationalMapProps } from "./map-types";

const TIER_COLORS: Record<AlertTier, string> = {
  green: "#1e8f4e",
  amber: "#c98a12",
  red: "#c4321f",
  legacy: "#7b3fa0",
};

function styleAlertMarker(element: HTMLButtonElement, selected: boolean) {
  element.dataset.selected = String(selected);
  element.style.transform = selected ? "scale(1.45)" : "scale(1)";
  element.style.boxShadow = selected
    ? "0 0 0 4px rgba(255,255,255,0.9), 0 0 0 7px rgba(28,79,140,0.65)"
    : "0 0 0 1px rgba(0,0,0,0.25)";
}

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

  useEffect(() => {
    let cancelled = false;
    const markers: google.maps.marker.AdvancedMarkerElement[] = [];
    const markerClickCleanups: Array<() => void> = [];
    const markerElements = markerElementsRef.current;

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

          const element = document.createElement("button");
          element.type = "button";
          element.style.width = "14px";
          element.style.height = "14px";
          element.style.borderRadius = "50%";
          element.style.border = "2px solid white";
          element.style.backgroundColor = TIER_COLORS[alert.tier];
          element.style.cursor = "pointer";
          element.style.padding = "0";
          element.style.transition = "transform 150ms ease, box-shadow 150ms ease";
          element.setAttribute("data-testid", "alert-marker");
          element.setAttribute("data-alert-id", alert.id);
          element.setAttribute("aria-label", `Select alert ${alert.id}`);
          styleAlertMarker(element, alert.id === selectedAlertIdRef.current);
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
      markerClickCleanups.forEach((cleanup) => cleanup());
      markers.forEach((marker) => {
        marker.map = null;
      });
      markerElements.clear();
      mapRef.current = null;
    };
    // The provider owns one immutable map instance; selection and callbacks are
    // kept current through refs above.
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
      <div className="absolute left-3 top-3 z-10">
        <BasemapToggle mode={mode} onChange={handleBasemapChange} />
      </div>
    </div>
  );
}
