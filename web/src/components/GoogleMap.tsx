"use client";

import { useEffect, useRef, useState } from "react";
import { LAND_CATEGORY_COLORS } from "@/lib/types";
import { BasemapToggle, type BasemapMode } from "./BasemapToggle";
import { loadGoogleMapLibraries } from "./googleMapsLoader";
import { collectParcelVertices, createAlertMarkerElement } from "./map-markers";
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
  const markerElementsRef = useRef<
    Map<string, { setSelected: (selected: boolean) => void }>
  >(new Map());
  const onAlertClickRef = useRef(onAlertClick);
  const selectedAlertIdRef = useRef(selectedAlertId);
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
    selectedAlertIdRef.current = selectedAlertId;
    markerElementsRef.current.forEach((marker, alertId) => {
      marker.setSelected(alertId === selectedAlertId);
    });
  }, [selectedAlertId]);

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
    const markers: google.maps.marker.AdvancedMarkerElement[] = [];
    const markerElements = markerElementsRef.current;

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

        // Keep H3 screening cells isolated from the parcel overlay so
        // visibility and restyling cannot alter parcel behavior.
        const h3Layer = new google.maps.Data();
        h3LayerRef.current = h3Layer;
        h3Layer.setStyle(H3_STYLE);
        if (h3CellsRef.current) h3Layer.addGeoJson(h3CellsRef.current);
        h3Layer.setMap(h3VisibleRef.current ? map : null);

        for (const alert of alerts) {
          const parcel = parcels.find((candidate) => candidate.id === alert.parcel_id);
          if (!parcel) continue;

          const { wrapper, setSelected } = createAlertMarkerElement({
            alert,
            parcelLabel: parcel.survey_no,
            selected: alert.id === selectedAlertIdRef.current,
            onClick: (alertId) => onAlertClickRef.current?.(alertId),
          });
          markerElements.set(alert.id, { setSelected });

          // AdvancedMarkerElement wraps whatever `content` we give it in its
          // own positioning container, so it never overwrites styles on our
          // wrapper directly -- but we still hand it the wrapper (not the
          // button) to stay consistent with MapLibreMap and keep the
          // button's own aria-label/selection styling fully self-contained.
          const marker = new AdvancedMarkerElement({
            map,
            position: { lat: parcel.centroid[1], lng: parcel.centroid[0] },
            content: wrapper,
            title: `Alert ${alert.id}`,
          });
          markers.push(marker);
        }

        const vertices = collectParcelVertices(parcels);
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
      markers.forEach((marker) => {
        marker.map = null;
      });
      markerElements.clear();
      h3LayerRef.current?.setMap(null);
      h3LayerRef.current = null;
      mapRef.current = null;
    };
    // The provider owns one immutable map instance; selection and callbacks are
    // kept current through refs above. `parcels`, `alerts`, `center`, and
    // `zoom` are intentionally captured only at mount time (this effect runs
    // once, deliberately omitting them from its dependency array) -- callers
    // that need to change any of them must remount this component (e.g. by
    // changing its `key`) rather than expect a live update. H3 data and
    // visibility are the exception and stay live through the refs/effects
    // above.
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
