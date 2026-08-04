"use client";

import { useEffect, useRef, useState } from "react";
// Without this, maplibre-gl never gets its own CSS: no `touch-action`
// rules on the canvas container (so its own pinch/pan gesture handling
// fights the browser's native ones on touch), and the built-in
// zoom/attribution controls render unstyled/unpositioned.
import "maplibre-gl/dist/maplibre-gl.css";
import type * as MapLibreGL from "maplibre-gl";
import { LAND_CATEGORY_COLORS } from "@/lib/types";
import { BasemapToggle, type BasemapMode } from "./BasemapToggle";
import { collectParcelVertices, createAlertMarkerElement } from "./map-markers";
import type { H3FeatureCollection, OperationalMapProps } from "./map-types";

const EMPTY_H3_CELLS: H3FeatureCollection = {
  type: "FeatureCollection",
  features: [],
};

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
  h3Cells,
  h3Visible = false,
}: MapLibreMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<import("maplibre-gl").Map | null>(null);
  const markerElementsRef = useRef<
    Map<string, { setSelected: (selected: boolean) => void }>
  >(new Map());
  const onAlertClickRef = useRef(onAlertClick);
  const selectedAlertIdRef = useRef(selectedAlertId);
  const h3CellsRef = useRef(h3Cells);
  const h3VisibleRef = useRef(h3Visible);
  const h3LayersReadyRef = useRef(false);
  const [mode, setMode] = useState<BasemapMode>("satellite");
  const modeRef = useRef(mode);

  function handleBasemapChange(newMode: BasemapMode) {
    modeRef.current = newMode;
    setMode(newMode);
    // Two windows where the map can't take the change yet: (a) the dynamic
    // `import("maplibre-gl")` hasn't resolved, so mapRef.current is still
    // null; (b) the map exists but its style hasn't finished loading, so
    // calling setLayoutProperty would throw ("Style is not done loading").
    // In both cases modeRef.current is already updated above, and either the
    // initial style construction or the "load" handler below re-applies it
    // once the map is actually ready.
    if (mapRef.current?.isStyleLoaded()) {
      mapRef.current.setLayoutProperty(
        "esri-base",
        "visibility",
        newMode === "satellite" ? "visible" : "none"
      );
      mapRef.current.setLayoutProperty(
        "osm-base",
        "visibility",
        newMode === "satellite" ? "none" : "visible"
      );
    }
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

  // CONSTRAINT: `parcels`, `alerts`, `center`, and `zoom` are read once, at
  // mount, by the effect below (empty dep array) — they are a snapshot, not
  // a live binding. A parent that re-renders this component with new
  // parcels/alerts/center/zoom after the initial mount will NOT see the map
  // update; the GeoJSON source and Markers created here are never rebuilt.
  // This is currently safe only because MapView mounts this component once
  // data is already loaded and fully remounts it (fresh key) on retry — so
  // in practice the values never change under a mounted instance today.
  // `selectedAlertId` and `onAlertClick` are the only props that ARE live,
  // via the ref pattern below.
  //
  // Before adding any feature that streams updated parcels/alerts/center/
  // zoom into an already-mounted map, this effect needs real sync, not a
  // fresh mount: parcels via
  // `(map.getSource("parcels") as GeoJSONSource).setData(...)` (cheap —
  // no need to remove/re-add the source or layers), alerts via reconciling
  // the `markerElementsRef` Map (add new marker ids, remove stale ones,
  // matching the selection-sync pattern already used for
  // `selectedAlertId` above), and center/zoom via an explicit
  // `map.jumpTo({ center, zoom })` call in their own effect. Do not
  // silently assume props are live without doing this.
  useEffect(() => {
    h3CellsRef.current = h3Cells;

    // h3LayersReadyRef is only set inside the "load" handler after the H3
    // source/layers are created, so these updates are always safe. Don't
    // also gate on isStyleLoaded(): it reports false whenever sources are
    // still fetching tiles (e.g. right after a pan), and bailing there
    // would silently drop the update.
    const map = mapRef.current;
    if (!map || !h3LayersReadyRef.current) return;

    const source = map.getSource("h3-grid");
    if (source && "setData" in source) {
      (source as MapLibreGL.GeoJSONSource).setData(
        h3Cells ?? EMPTY_H3_CELLS
      );
    }
  }, [h3Cells]);

  useEffect(() => {
    h3VisibleRef.current = h3Visible;

    const map = mapRef.current;
    if (!map || !h3LayersReadyRef.current) return;

    const visibility = h3Visible ? "visible" : "none";
    map.setLayoutProperty("h3-grid-fill", "visibility", visibility);
    map.setLayoutProperty("h3-grid-outline", "visibility", visibility);
  }, [h3Visible]);

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
              layout: {
                visibility: modeRef.current === "satellite" ? "none" : "visible",
              },
            },
            {
              id: "esri-base",
              type: "raster",
              source: "esri-imagery",
              layout: {
                visibility: modeRef.current === "satellite" ? "visible" : "none",
              },
            },
          ],
        },
        center,
        zoom,
        // This is a flat, top-down parcel map with no compass/reset
        // control, so letting a two-finger touch twist (or a desktop
        // right-drag) rotate it would leave someone stuck looking at an
        // off-north map with no way back. Pinch-to-zoom and one-finger
        // pan/drag are unaffected.
        dragRotate: false,
        touchPitch: false,
      });
      mapInstance = map;
      mapRef.current = map;
      map.touchZoomRotate.disableRotation();

      map.on("load", () => {
        if (cancelled) return;

        // Re-apply the current mode now that the style is guaranteed to be
        // loaded: a toggle click during either failure window above (the
        // import still pending, or the map constructed but not yet loaded)
        // only updated modeRef/mode, so pick that up here.
        map.setLayoutProperty(
          "esri-base",
          "visibility",
          modeRef.current === "satellite" ? "visible" : "none"
        );
        map.setLayoutProperty(
          "osm-base",
          "visibility",
          modeRef.current === "satellite" ? "none" : "visible"
        );

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

        map.addSource("h3-grid", {
          type: "geojson",
          data: h3CellsRef.current ?? EMPTY_H3_CELLS,
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

        const h3Visibility = h3VisibleRef.current ? "visible" : "none";
        map.addLayer({
          id: "h3-grid-fill",
          type: "fill",
          source: "h3-grid",
          layout: { visibility: h3Visibility },
          paint: {
            "fill-color": "#06b6d4",
            "fill-opacity": 0.14,
          },
        });

        map.addLayer({
          id: "h3-grid-outline",
          type: "line",
          source: "h3-grid",
          layout: { visibility: h3Visibility },
          paint: {
            "line-color": "#0891b2",
            "line-opacity": 0.9,
            "line-width": 1.5,
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
        h3LayersReadyRef.current = true;

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
      h3LayersReadyRef.current = false;
      mapInstance?.remove();
      mapRef.current = null;
    };
    // Intentionally mount-only — see the CONSTRAINT comment above this
    // effect. This effect runs once, deliberately omitting `parcels`,
    // `alerts`, `center`, and `zoom` from its dependency array: they are
    // intentionally captured only at mount time. Callers that need to change
    // any of them must remount this component (e.g. by changing its `key`)
    // rather than expect a live update. H3 cells, H3 visibility, selection,
    // and callbacks stay live via refs/effects above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="relative h-full w-full">
      <div
        ref={containerRef}
        data-testid="maplibre-container"
        className="h-full w-full"
      />
      <div className="absolute left-[max(0.75rem,env(safe-area-inset-left,0px))] top-[max(0.75rem,env(safe-area-inset-top,0px))] z-10">
        <BasemapToggle mode={mode} onChange={handleBasemapChange} />
      </div>
    </div>
  );
}
