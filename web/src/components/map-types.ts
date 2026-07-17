import type { Alert, Parcel } from "@/lib/types";

export interface OperationalMapProps {
  parcels: Parcel[];
  alerts: Alert[];
  center?: [number, number];
  zoom?: number;
  /** Called when the map is ready for imperative camera movement. */
  onReady?: (api: { panTo: (lngLat: [number, number]) => void }) => void;
  /** Called when an alert marker is clicked. */
  onAlertClick?: (alertId: string) => void;
  selectedAlertId?: string;
}
