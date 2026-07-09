"use client";

import dynamic from "next/dynamic";
import type { Parcel } from "@/lib/types";

const MapLibreMap = dynamic(() => import("./MapLibreMap"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full items-center justify-center bg-gray-100 text-sm text-gray-500">
      Loading map...
    </div>
  ),
});

export interface ParcelMiniMapProps {
  parcel: Parcel;
}

export default function ParcelMiniMap({ parcel }: ParcelMiniMapProps) {
  return (
    <MapLibreMap
      parcels={[parcel]}
      alerts={[]}
      center={parcel.centroid}
      zoom={16}
    />
  );
}
