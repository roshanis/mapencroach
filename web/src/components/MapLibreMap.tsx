"use client";

import { useEffect, useRef, useState } from "react";
import "maplibre-gl/dist/maplibre-gl.css";
import type * as MapLibreGL from "maplibre-gl";
import { LAND_CATEGORY_COLORS } from "@/lib/types";
import { BasemapToggle, type BasemapMode } from "./BasemapToggle";
import { collectParcelVertices, createAlertMarkerElement } from "./map-markers";
import type { OperationalMapProps } from "./map-types";

function buildLandCategoryMatchExpression(
  fallback: string
): MapLibreGL.DataDrivenPropertyValueSpecification<string> {
  return [
    "match",
    ["get", "land_category"],
    ...Object.entries(LAND_CATEGORY_COLORS).flat(),
    fallback,
  ] as unknown as MapLibreGL.DataDrivenPropertyValueSpecification<string>;
}

export type MapLibreMapProps = OperationalMapProps;

export default function MapLibreMap({
  parcels,
  alerts,
  center = [78.03, 29.92],
  zoom = 11,
  onReady,
  onAlertClick,
  selectedAlertId,
}: MapLibreMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<import("maplibre-gl").Map | null>(null);
  const markerElementsRef = useRef<
    Map<string, { setSelected: (selected: boolean) => void }>
  >(new Map());
  const onAlertClickRef = useRef(onAlertClick);
  const selectedAlertIdRef = useRef(selectedAlertId);
  const [mode, setMode] = useState<BasemapMode>("satellite");

  function handleBasemapChange(newMode: BasemapMode) {
    setMode(newMode);
    mapRef.current?.setLayoutProperty(
      "esri-base",
      "visibility",
      newMode === "satellite" ? "visible" : "none"
    );
    mapRef.current?.setLayoutProperty(
      "osm-base",
      "visibility",
      newMode === "satellite" ? "none" : "visible"
    );
  }

  useEffect(() => {
    onAlertClickRef.current = onAlertClick;
  }, [onAlertClick]);

  useEffect(() => {
    selectedAlertIdRef.current = selectedAlertId;
    markerElementsRef.current.forEach((marker, alertId) => {
      marker.setSelected(alertId === selectedAlertId);
    });
  }, [selectedAlertId]);

  useEffect(() => {
    let cancelled = false;
    let mapInstance: import("maplibre-gl").Map | null = null;
    const markers: import("maplibre-gl").Marker[] = [];
    const markerElements = markerElementsRef.current;

    async function init() {
      const maplibregl = (await import("maplibre-gl")).default;
      if (cancelled || !containerRef.current) return;

      const map = new maplibregl.Map({
        container: containerRef.current,
        style: {
          version: 8,
          sources: {
            osm: {
              type: "raster",
              tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
              tileSize: 256,
              attribution:
                '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
            },
            "esri-imagery": {
              type: "raster",
              tiles: [
                "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
              ],
              tileSize: 256,
              attribution:
                "Esri, Maxar, Earthstar Geographics, and the GIS User Community",
            },
          },
          layers: [
            {
              id: "osm-base",
              type: "raster",
              source: "osm",
              layout: { visibility: "none" },
            },
            {
              id: "esri-base",
              type: "raster",
              source: "esri-imagery",
              layout: { visibility: "visible" },
            },
          ],
        },
        center,
        zoom,
      });
      mapInstance = map;
      mapRef.current = map;

      map.on("load", () => {
        if (cancelled) return;

        map.addSource("parcels", {
          type: "geojson",
          data: {
            type: "FeatureCollection",
            features: parcels.map((p) => ({
              type: "Feature",
              geometry: p.geometry,
              properties: {
                id: p.id,
                boundary_grade: p.boundary_grade,
                land_category: p.land_category,
              },
            })),
          },
        });

        map.addLayer({
          id: "parcel-fill",
          type: "fill",
          source: "parcels",
          paint: {
            "fill-color": buildLandCategoryMatchExpression("#999999"),
            "fill-opacity": 0.25,
          },
        });

        map.addLayer({
          id: "parcel-outline",
          type: "line",
          source: "parcels",
          paint: {
            "line-color": buildLandCategoryMatchExpression("#999999"),
            "line-width": 2.5,
          },
        });

        for (const alert of alerts) {
          const parcel = parcels.find((p) => p.id === alert.parcel_id);
          if (!parcel) continue;

          const { wrapper, setSelected } = createAlertMarkerElement({
            alert,
            parcelLabel: parcel.survey_no,
            selected: alert.id === selectedAlertIdRef.current,
            onClick: (alertId) => onAlertClickRef.current?.(alertId),
          });
          markerElements.set(alert.id, { setSelected });

          // MapLibre only ever writes `transform: translate(...)` onto the
          // element we hand it (the wrapper) to position the marker. Our own
          // selection styling only ever touches the inner button, so the two
          // can never fight over the same CSS property, and MapLibre's
          // "Map marker" aria-label overwrite never reaches the button.
          const marker = new maplibregl.Marker({ element: wrapper })
            .setLngLat(parcel.centroid)
            .addTo(map);
          markers.push(marker);
        }

        const vertices = collectParcelVertices(parcels);
        if (vertices.length > 0) {
          const bounds = vertices.reduce(
            (acc, vertex) => acc.extend(vertex),
            new maplibregl.LngLatBounds(vertices[0], vertices[0])
          );
          map.fitBounds(bounds, {
            padding: { top: 130, right: 130, bottom: 110, left: 90 },
            maxZoom: 14,
            duration: 0,
          });
        }
        // When there are no parcels, the initial `center`/`zoom` props above
        // remain in effect as the fallback camera.

        onReady?.({
          panTo: (lngLat) => {
            map.flyTo({ center: lngLat, zoom: 15 });
          },
        });
      });
    }

    init();

    return () => {
      cancelled = true;
      markers.forEach((m) => m.remove());
      markerElements.clear();
      mapInstance?.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="relative h-full w-full">
      <div
        ref={containerRef}
        data-testid="maplibre-container"
        className="h-full w-full"
      />
      <div className="absolute left-3 top-3 z-10">
        <BasemapToggle mode={mode} onChange={handleBasemapChange} />
      </div>
    </div>
  );
}
