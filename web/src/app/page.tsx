"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import MapView from "@/components/MapView";
import { AlertSidebar } from "@/components/AlertSidebar";
import { MapLegend } from "@/components/MapLegend";
import { TopBar } from "@/components/TopBar";
import { getAlerts, getParcels } from "@/lib/api";
import type { Alert, Parcel } from "@/lib/types";

export default function CommandMapPage() {
  const router = useRouter();
  const [parcels, setParcels] = useState<Parcel[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [selectedAlertId, setSelectedAlertId] = useState<string | undefined>();
  const mapApiRef = useRef<{ panTo: (lngLat: [number, number]) => void } | null>(
    null
  );

  useEffect(() => {
    getParcels().then(setParcels);
    getAlerts().then(setAlerts);
  }, []);

  const panToAlert = useCallback(
    (alert: Alert) => {
      setSelectedAlertId(alert.id);
      const parcel = parcels.find((p) => p.id === alert.parcel_id);
      if (parcel && mapApiRef.current) {
        mapApiRef.current.panTo(parcel.centroid);
      }
    },
    [parcels]
  );

  const handleAlertMarkerClick = useCallback(
    (alertId: string) => {
      const alert = alerts.find((a) => a.id === alertId);
      if (alert) {
        router.push(`/parcels/${alert.parcel_id}`);
      }
    },
    [alerts, router]
  );

  return (
    <div className="flex h-screen flex-col">
      <TopBar jurisdiction="Bhopal Division (placeholder)" />
      <div className="flex flex-1 overflow-hidden">
        <AlertSidebar
          alerts={alerts}
          selectedAlertId={selectedAlertId}
          onSelect={panToAlert}
        />
        <main className="relative flex-1">
          <MapView
            parcels={parcels}
            alerts={alerts}
            onReady={(api) => {
              mapApiRef.current = api;
            }}
            onAlertClick={handleAlertMarkerClick}
          />
          <div className="pointer-events-none absolute right-3 top-3 rounded bg-white/90 px-3 py-2 text-xs text-gray-600 shadow">
            Click an alert to pan the map, or click a marker to open its
            parcel.
          </div>
          <div className="absolute bottom-3 left-3">
            <MapLegend categories={parcels.map((p) => p.land_category)} />
          </div>
        </main>
      </div>
    </div>
  );
}
