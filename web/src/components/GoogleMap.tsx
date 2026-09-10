"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { LAND_CATEGORY_COLORS, type Parcel } from "@/lib/types";
import { BasemapToggle, type BasemapMode } from "./BasemapToggle";
import { loadGoogleMapLibraries, onGoogleMapsAuthFailure } from "./googleMapsLoader";
import { collectParcelVertices } from "./map-markers";
import GoogleLocationSearch from "./GoogleLocationSearch";
import { createGoogleAlertClusters } from "./googleAlertClusters";
import type { OperationalMapProps } from "./map-types";

export interface GoogleMapProps extends OperationalMapProps {
  apiKey: string;
  mapId: string;
  onProviderError: () => void;
}

const H3_STYLE: google.maps.Data.StyleOptions = {
  clickable: false,
  fillColor: "#06b6d4",
  fillOpacity: 0.14,
  strokeColor: "#0891b2",
  strokeOpacity: 0.9,
  strokeWeight: 1.5,
  zIndex: 1,
};

function replaceParcelData(map: google.maps.Map, parcels: Parcel[]) {
  const previous: google.maps.Data.Feature[] = [];
  map.data.forEach((feature) => previous.push(feature));
  previous.forEach((feature) => map.data.remove(feature));
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
}

export default function GoogleMap({
  apiKey,
  mapId,
  parcels,
  alerts,
  h3Cells,
  h3Visible = false,
  center = [78.03, 29.92],
  zoom = 11,
  onReady,
  onAlertClick,
  selectedAlertId,
  onProviderError,
}: GoogleMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const h3LayerRef = useRef<google.maps.Data | null>(null);
  const h3CellsRef = useRef(h3Cells);
  const h3VisibleRef = useRef(h3Visible);
  const clustersRef = useRef<ReturnType<typeof createGoogleAlertClusters> | null>(null);
  const dataRef = useRef({ parcels, alerts, selectedAlertId });
  const onAlertClickRef = useRef(onAlertClick);
  const onReadyRef = useRef(onReady);
  const onProviderErrorRef = useRef(onProviderError);
  const [mode, setMode] = useState<BasemapMode>("satellite");
  const [loading, setLoading] = useState(true);
  const modeRef = useRef(mode);

  function handleBasemapChange(newMode: BasemapMode) {
    modeRef.current = newMode;
    setMode(newMode);
    // While `loading` is true the Map hasn't been constructed yet, so
    // mapRef.current is null and this is a silent no-op on the map itself.
    // modeRef.current is already updated above, and the Map constructor
    // below reads it to pick the correct initial mapTypeId once it runs.
    mapRef.current?.setMapTypeId(newMode === "satellite" ? "hybrid" : "roadmap");
  }

  useEffect(() => {
    onAlertClickRef.current = onAlertClick;
  }, [onAlertClick]);

  useEffect(() => {
    onProviderErrorRef.current = onProviderError;
  }, [onProviderError]);

  useEffect(() => {
    onReadyRef.current = onReady;
  }, [onReady]);

  // Both the loader's eventual initialization and later updates use the
  // latest committed props. Updating data must not reset the user's camera.
  useEffect(() => {
    dataRef.current = { parcels, alerts, selectedAlertId };
    clustersRef.current?.update(parcels, alerts, selectedAlertId);
  }, [parcels, alerts, selectedAlertId]);

  useEffect(() => {
    if (mapRef.current) replaceParcelData(mapRef.current, parcels);
  }, [parcels]);

  const handleLocationSelect = useCallback((location: { lat: number; lng: number }) => {
    mapRef.current?.panTo(location);
    mapRef.current?.setZoom(15);
  }, []);

  useEffect(() => {
    h3CellsRef.current = h3Cells;
    const layer = h3LayerRef.current;
    if (!layer) return;

    const previousFeatures: google.maps.Data.Feature[] = [];
    layer.forEach((feature) => previousFeatures.push(feature));
    previousFeatures.forEach((feature) => layer.remove(feature));
    if (h3Cells) layer.addGeoJson(h3Cells);
  }, [h3Cells]);

  useEffect(() => {
    h3VisibleRef.current = h3Visible;
    const layer = h3LayerRef.current;
    if (layer) layer.setMap(h3Visible ? mapRef.current : null);
  }, [h3Visible]);

  useEffect(() => {
    let cancelled = false;


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
          mapTypeId: modeRef.current === "satellite" ? "hybrid" : "roadmap",
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

        replaceParcelData(map, dataRef.current.parcels);
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

        // Keep H3 screening cells isolated from the parcel overlay so
        // visibility and restyling cannot alter parcel behavior.
        const h3Layer = new google.maps.Data();
        h3LayerRef.current = h3Layer;
        h3Layer.setStyle(H3_STYLE);
        if (h3CellsRef.current) h3Layer.addGeoJson(h3CellsRef.current);
        h3Layer.setMap(h3VisibleRef.current ? map : null);

        const clusters = createGoogleAlertClusters({
          map,
          AdvancedMarkerElement,
          onAlertClick: (alertId) => onAlertClickRef.current?.(alertId),
        });
        clustersRef.current = clusters;
        const latest = dataRef.current;
        clusters.update(latest.parcels, latest.alerts, latest.selectedAlertId);

        const vertices = collectParcelVertices(latest.parcels);
        if (vertices.length > 0) {
          const bounds = new google.maps.LatLngBounds();
          for (const [lng, lat] of vertices) {
            bounds.extend({ lat, lng });
          }
          map.fitBounds(bounds, {
            top: 130,
            right: 130,
            bottom: 110,
            left: 90,
          } as google.maps.Padding);
        }
        // When there are no parcels, the initial `center`/`zoom` props above
        // remain in effect as the fallback camera.

        onReadyRef.current?.({
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
      clustersRef.current?.destroy();
      clustersRef.current = null;
      h3LayerRef.current?.setMap(null);
      h3LayerRef.current = null;
      mapRef.current = null;
    };
    // The SDK instance and initial camera belong to this mount. Live parcel,
    // alert, selection and callback changes are synchronized above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex h-full min-h-0 w-full flex-col">
      {!loading ? (
        <div data-testid="google-search-row" className="shrink-0 border-b bg-white px-2 py-1">
          <GoogleLocationSearch apiKey={apiKey} onLocationSelect={handleLocationSelect} />
        </div>
      ) : null}
      <div className="relative min-h-0 flex-1">
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
    </div>
  );
}
