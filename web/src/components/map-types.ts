import type { Alert, HotspotCell, Parcel } from "@/lib/types";

export interface OperationalMapProps {
  parcels: Parcel[];
  alerts: Alert[];
  /** H3 alert-density hotspot cells, rendered as hexagons under the parcel layers. */
  hotspots?: HotspotCell[];
  center?: [number, number];
  zoom?: number;
  /** Called when the map is ready for imperative camera movement. */
  onReady?: (api: { panTo: (lngLat: [number, number]) => void }) => void;
  /** Called when an alert marker is clicked. */
  onAlertClick?: (alertId: string) => void;
  selectedAlertId?: string;
}

export interface HotspotFeatureProperties {
  cell: string;
  alert_count: number;
  red_alerts: number;
  parcel_count: number;
}

export interface HotspotFeature {
  type: "Feature";
  geometry: GeoJSON.Polygon;
  properties: HotspotFeatureProperties;
}

export interface HotspotFeatureCollection {
  type: "FeatureCollection";
  features: HotspotFeature[];
}

/**
 * Builds a GeoJSON FeatureCollection of hotspot hexagon boundaries, carrying
 * only the properties the map providers style on. Extracted as a pure
 * function so it's testable without a real map instance.
 */
export function hotspotsToFeatureCollection(
  hotspots: HotspotCell[]
): HotspotFeatureCollection {
  return {
    type: "FeatureCollection",
    features: hotspots.map((hotspot) => ({
      type: "Feature",
      geometry: hotspot.boundary,
      properties: {
        cell: hotspot.cell,
        alert_count: hotspot.alert_count,
        red_alerts: hotspot.red_alerts,
        parcel_count: hotspot.parcel_count,
      },
    })),
  };
}

export const HOTSPOT_RED_COLOR = "#c4321f";
export const HOTSPOT_AMBER_COLOR = "#c98a12";
export const HOTSPOT_MIN_OPACITY = 0.12;
export const HOTSPOT_MAX_OPACITY = 0.35;
const HOTSPOT_OPACITY_ALERT_FLOOR = 1;
const HOTSPOT_OPACITY_ALERT_CEIL = 5;

/** Red when the cell has any red-tier alerts, amber otherwise. */
export function hotspotFillColor(redAlerts: number): string {
  return redAlerts > 0 ? HOTSPOT_RED_COLOR : HOTSPOT_AMBER_COLOR;
}

/** Linearly scales opacity from 0.12 at 1 alert to 0.35 at 5+ alerts. */
export function hotspotFillOpacity(alertCount: number): number {
  const clamped = Math.min(
    Math.max(alertCount, HOTSPOT_OPACITY_ALERT_FLOOR),
    HOTSPOT_OPACITY_ALERT_CEIL
  );
  const t =
    (clamped - HOTSPOT_OPACITY_ALERT_FLOOR) /
    (HOTSPOT_OPACITY_ALERT_CEIL - HOTSPOT_OPACITY_ALERT_FLOOR);
  return HOTSPOT_MIN_OPACITY + t * (HOTSPOT_MAX_OPACITY - HOTSPOT_MIN_OPACITY);
}
