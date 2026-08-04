import type { Alert, Parcel } from "@/lib/types";

export interface H3CellProperties {
  h3Index: string;
  resolution: number;
  parcelIds: string[];
}

export type H3FeatureCollection = GeoJSON.FeatureCollection<
  GeoJSON.Polygon,
  H3CellProperties
>;

export interface OperationalMapProps {
  parcels: Parcel[];
  alerts: Alert[];
  /** H3 analytical cells derived from the loaded parcel geometry. */
  h3Cells?: H3FeatureCollection;
  /** H3 cells are screening context, never authoritative parcel boundaries. */
  h3Visible?: boolean;
  center?: [number, number];
  zoom?: number;
  /** Called when the map is ready for imperative camera movement. */
  onReady?: (api: { panTo: (lngLat: [number, number]) => void }) => void;
  /** Called when an alert marker is clicked. */
  onAlertClick?: (alertId: string) => void;
  selectedAlertId?: string;
}
