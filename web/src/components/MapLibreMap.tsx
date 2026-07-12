"use client";

import { useEffect, useRef } from "react";
import type * as MapLibreGL from "maplibre-gl";
import { LAND_CATEGORY_COLORS } from "@/lib/types";
import type { Parcel, Alert, AlertTier } from "@/lib/types";

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

const TIER_COLORS: Record<AlertTier, string> = {
  green: "#1e8f4e",
  amber: "#c98a12",
  red: "#c4321f",
  legacy: "#7b3fa0",
};

export interface MapLibreMapProps {
  parcels: Parcel[];
  alerts: Alert[];
  center?: [number, number];
  zoom?: number;
  /** Called when the map instance has been created (for imperative pan/fly-to). */
  onReady?: (api: { panTo: (lngLat: [number, number]) => void }) => void;
  /** Called when an alert marker is clicked. */
  onAlertClick?: (alertId: string) => void;
}

export default function MapLibreMap({
  parcels,
  alerts,
  center = [78.03, 29.92],
  zoom = 11,
  onReady,
  onAlertClick,
}: MapLibreMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<import("maplibre-gl").Map | null>(null);

  useEffect(() => {
    let cancelled = false;
    let mapInstance: import("maplibre-gl").Map | null = null;
    const markers: import("maplibre-gl").Marker[] = [];

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
          },
          layers: [
            {
              id: "osm-base",
              type: "raster",
              source: "osm",
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
            "line-width": 2,
          },
        });

        for (const alert of alerts) {
          const parcel = parcels.find((p) => p.id === alert.parcel_id);
          if (!parcel) continue;
          const el = document.createElement("div");
          el.style.width = "14px";
          el.style.height = "14px";
          el.style.borderRadius = "50%";
          el.style.border = "2px solid white";
          el.style.boxShadow = "0 0 0 1px rgba(0,0,0,0.25)";
          el.style.backgroundColor = TIER_COLORS[alert.tier];
          el.setAttribute("data-testid", "alert-marker");
          el.setAttribute("data-alert-id", alert.id);
          el.style.cursor = "pointer";
          if (onAlertClick) {
            el.addEventListener("click", () => onAlertClick(alert.id));
          }

          const marker = new maplibregl.Marker({ element: el })
            .setLngLat(parcel.centroid)
            .addTo(map);
          markers.push(marker);
        }

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
      mapInstance?.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      ref={containerRef}
      data-testid="maplibre-container"
      className="h-full w-full"
    />
  );
}
