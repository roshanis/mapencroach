import type { Parcel } from "@/lib/types";
import MapView from "./MapView";

export interface ParcelMiniMapProps {
  parcel: Parcel;
}

export default function ParcelMiniMap({ parcel }: ParcelMiniMapProps) {
  return (
    <MapView
      parcels={[parcel]}
      alerts={[]}
      center={parcel.centroid}
      zoom={16}
    />
  );
}
