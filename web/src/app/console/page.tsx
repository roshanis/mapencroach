"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import MapView from "@/components/MapView";
import { AlertSidebar } from "@/components/AlertSidebar";
import { KpiStrip } from "@/components/KpiStrip";
import { MapIntroPanel } from "@/components/MapIntroPanel";
import { MapLegend } from "@/components/MapLegend";
import { SelectedAlertCard } from "@/components/SelectedAlertCard";
import { TopBar } from "@/components/TopBar";
import { WorkbenchSummary } from "@/components/WorkbenchSummary";
import { getAlerts, getCases, getParcels } from "@/lib/api";
import { PERSONA_META_COOKIE, readCookie } from "@/lib/cookies";
import type { Alert, Case, Parcel } from "@/lib/types";

type LoadState = "loading" | "ready" | "error";

function readCurrentRole(): string {
  const raw = readCookie(PERSONA_META_COOKIE);
  if (!raw) return "case_officer";
  try {
    const parsed = JSON.parse(raw) as { role?: unknown };
    return typeof parsed.role === "string" ? parsed.role : "case_officer";
  } catch {
    return "case_officer";
  }
}

export default function CommandMapPage() {
  const [parcels, setParcels] = useState<Parcel[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [cases, setCases] = useState<Case[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [role, setRole] = useState("case_officer");
  const [mobileQueueOpen, setMobileQueueOpen] = useState(false);
  const [selectedAlertId, setSelectedAlertId] = useState<string | undefined>();
  const mapApiRef = useRef<{ panTo: (lngLat: [number, number]) => void } | null>(
    null
  );

  const loadData = useCallback(async () => {
    setLoadState("loading");
    try {
      const [nextParcels, nextAlerts, nextCases] = await Promise.all([
        getParcels(),
        getAlerts(),
        getCases(),
      ]);
      setParcels(nextParcels);
      setAlerts(nextAlerts);
      setCases(nextCases);
      setLoadState("ready");
    } catch {
      setLoadState("error");
    }
  }, []);

  useEffect(() => {
    setRole(readCurrentRole());
    void loadData();
  }, [loadData]);

  const panToAlert = useCallback(
    (alert: Alert) => {
      setSelectedAlertId(alert.id);
      const parcel = parcels.find((item) => item.id === alert.parcel_id);
      if (parcel && mapApiRef.current) {
        mapApiRef.current.panTo(parcel.centroid);
      }
    },
    [parcels]
  );

  const handleAlertMarkerClick = useCallback(
    (alertId: string) => {
      const alert = alerts.find((item) => item.id === alertId);
      if (alert) {
        panToAlert(alert);
      }
    },
    [alerts, panToAlert]
  );

  const selectedAlert = alerts.find((alert) => alert.id === selectedAlertId);
  const selectedParcel = selectedAlert
    ? parcels.find((parcel) => parcel.id === selectedAlert.parcel_id)
    : undefined;

  if (loadState !== "ready") {
    return (
      <div className="flex min-h-screen flex-col bg-slate-50">
        <TopBar jurisdiction="Haridwar–Roorkee Development Authority" />
        <main className="flex flex-1 items-center justify-center p-6">
          <div className="max-w-md rounded-lg border border-slate-200 bg-white p-6 text-center shadow-sm">
            {loadState === "loading" ? (
              <>
                <div className="mx-auto h-8 w-8 animate-pulse rounded-full bg-gov/20" />
                <p className="mt-4 text-sm font-medium text-slate-700">
                  Loading jurisdiction data…
                </p>
              </>
            ) : (
              <>
                <h1 className="text-base font-semibold text-slate-950">
                  Jurisdiction data could not be loaded
                </h1>
                <p className="mt-2 text-sm text-slate-600">
                  The map has not been shown because its operational data is unavailable.
                </p>
                <button
                  type="button"
                  onClick={() => void loadData()}
                  className="mt-4 rounded-md bg-gov px-4 py-2 text-sm font-semibold text-white hover:bg-gov-dark"
                >
                  Try again
                </button>
              </>
            )}
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col">
      <TopBar jurisdiction="Haridwar–Roorkee Development Authority" />
      <div className="flex flex-1 overflow-hidden">
        <AlertSidebar
          alerts={alerts}
          selectedAlertId={selectedAlertId}
          onSelect={panToAlert}
          mobileOpen={mobileQueueOpen}
          onMobileClose={() => setMobileQueueOpen(false)}
          summary={
            <WorkbenchSummary
              role={role}
              parcels={parcels}
              alerts={alerts}
              cases={cases}
            />
          }
        />
        <main className="relative flex-1">
          <MapView
            parcels={parcels}
            alerts={alerts}
            onReady={(api) => {
              mapApiRef.current = api;
            }}
            onAlertClick={handleAlertMarkerClick}
            selectedAlertId={selectedAlertId}
          />
          <button
            type="button"
            onClick={() => setMobileQueueOpen(true)}
            className="absolute bottom-4 left-1/2 z-20 -translate-x-1/2 rounded-full bg-gov px-4 py-2 text-sm font-semibold text-white shadow-lg md:hidden"
          >
            Open work queue
          </button>
          <MapIntroPanel />
          <div className="pointer-events-none absolute left-1/2 top-3 hidden -translate-x-1/2 lg:block">
            <KpiStrip parcels={parcels} alerts={alerts} cases={cases} />
          </div>
          <div className="absolute bottom-3 left-3">
            <MapLegend categories={parcels.map((parcel) => parcel.land_category)} />
          </div>
          {selectedAlert && selectedParcel && (
            <SelectedAlertCard
              alert={selectedAlert}
              parcel={selectedParcel}
              onClose={() => setSelectedAlertId(undefined)}
            />
          )}
        </main>
      </div>
    </div>
  );
}
