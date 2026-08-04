"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import MapView from "@/components/MapView";
import { AlertSidebar } from "@/components/AlertSidebar";
import {
  H3GridControl,
  type H3Resolution,
} from "@/components/H3GridControl";
import { KpiStrip } from "@/components/KpiStrip";
import { MapIntroPanel } from "@/components/MapIntroPanel";
import { MapLegend } from "@/components/MapLegend";
import { SelectedAlertCard } from "@/components/SelectedAlertCard";
import { TopBar } from "@/components/TopBar";
import { WorkbenchSummary } from "@/components/WorkbenchSummary";
import { getAlerts, getCases, getParcels } from "@/lib/api";
import { PERSONA_META_COOKIE, readCookie } from "@/lib/cookies";
import { buildH3Grid } from "@/lib/h3-grid";
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

function CommandMapPageContent() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [parcels, setParcels] = useState<Parcel[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [cases, setCases] = useState<Case[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [role, setRole] = useState("case_officer");
  const [mobileQueueOpen, setMobileQueueOpen] = useState(false);
  const [h3Visible, setH3Visible] = useState(false);
  const [h3Resolution, setH3Resolution] = useState<H3Resolution>(11);
  const [selectedAlertId, setSelectedAlertId] = useState<string | undefined>();
  const [mapReady, setMapReady] = useState(false);
  const mapApiRef = useRef<{ panTo: (lngLat: [number, number]) => void } | null>(
    null
  );
  const appliedUrlSelectionRef = useRef(false);

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

  const casesByAlertId = useMemo(
    () => new Map(cases.map((item) => [item.alert_id, item])),
    [cases]
  );

  const h3Grid = useMemo(
    () => buildH3Grid(parcels, h3Resolution),
    [parcels, h3Resolution]
  );
  const canShowH3 = h3Visible && h3Grid.ok;

  // On first load, honor a ?alert= deep link once data has arrived. Unknown
  // or stale ids are ignored (no selection, no crash) and this only ever
  // runs once so it never fights with later user-driven selection.
  useEffect(() => {
    if (loadState !== "ready" || appliedUrlSelectionRef.current) return;
    appliedUrlSelectionRef.current = true;
    const alertParam = searchParams.get("alert");
    if (!alertParam) return;
    const match = alerts.find((alert) => alert.id === alertParam);
    if (match) {
      setSelectedAlertId(match.id);
    }
  }, [loadState, alerts, searchParams]);

  // Pan to the selected alert's parcel whenever the selection changes or the
  // map finishes loading — covers both a live row/marker click and a
  // ?alert= deep link that resolves before the map is ready.
  useEffect(() => {
    if (!selectedAlertId || !mapReady || !mapApiRef.current) return;
    const alert = alerts.find((item) => item.id === selectedAlertId);
    const parcel = alert
      ? parcels.find((item) => item.id === alert.parcel_id)
      : undefined;
    if (parcel) {
      mapApiRef.current.panTo(parcel.centroid);
    }
  }, [selectedAlertId, mapReady, alerts, parcels]);

  const replaceAlertParam = useCallback(
    (alertId: string | undefined) => {
      const params = new URLSearchParams(searchParams.toString());
      if (alertId) params.set("alert", alertId);
      else params.delete("alert");
      const suffix = params.toString();
      router.replace(`${pathname}${suffix ? `?${suffix}` : ""}`, {
        scroll: false,
      });
    },
    [pathname, router, searchParams]
  );

  const selectAlert = useCallback(
    (alert: Alert) => {
      setSelectedAlertId(alert.id);
      replaceAlertParam(alert.id);
    },
    [replaceAlertParam]
  );

  const deselectAlert = useCallback(() => {
    setSelectedAlertId(undefined);
    replaceAlertParam(undefined);
  }, [replaceAlertParam]);

  const handleAlertMarkerClick = useCallback(
    (alertId: string) => {
      const alert = alerts.find((item) => item.id === alertId);
      if (alert) {
        selectAlert(alert);
      }
    },
    [alerts, selectAlert]
  );

  const selectedAlert = alerts.find((alert) => alert.id === selectedAlertId);
  const selectedParcel = selectedAlert
    ? parcels.find((parcel) => parcel.id === selectedAlert.parcel_id)
    : undefined;

  if (loadState !== "ready") {
    return (
      <div className="flex min-h-screen-safe flex-col bg-slate-50">
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
    <div className="flex h-screen-safe flex-col">
      <TopBar jurisdiction="Haridwar–Roorkee Development Authority" />
      <div className="flex flex-1 overflow-hidden">
        <AlertSidebar
          alerts={alerts}
          parcels={parcels}
          selectedAlertId={selectedAlertId}
          onSelect={selectAlert}
          casesByAlertId={casesByAlertId}
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
        <div className="flex flex-1 flex-col overflow-hidden">
          <div
            data-testid="kpi-strip-compact-wrapper"
            className="border-b border-slate-200 bg-slate-50 px-3 py-2 lg:hidden"
          >
            <KpiStrip
              parcels={parcels}
              alerts={alerts}
              cases={cases}
              variant="compact"
            />
          </div>
          <main className="relative flex-1">
            <MapView
              parcels={parcels}
              alerts={alerts}
              h3Cells={h3Grid.featureCollection}
              h3Visible={canShowH3}
              onReady={(api) => {
                mapApiRef.current = api;
                setMapReady(true);
              }}
              onAlertClick={handleAlertMarkerClick}
              selectedAlertId={selectedAlertId}
            />
            <div className="absolute left-[calc(0.75rem_+_env(safe-area-inset-left,0px))] top-[calc(4rem_+_env(safe-area-inset-top,0px))] z-20">
              <H3GridControl
                visible={h3Visible}
                resolution={h3Resolution}
                cellCount={h3Grid.featureCollection.features.length}
                warning={h3Grid.ok ? undefined : h3Grid.error.message}
                onVisibleChange={setH3Visible}
                onResolutionChange={setH3Resolution}
              />
            </div>
            {/* Hidden once the queue is already open: it sits behind the
                sidebar's overlay (lower z-index) at that point, so leaving it
                mounted would keep a focusable-but-invisible button in the tab
                order for no benefit — the same panel is already open. */}
            {!mobileQueueOpen && (
              <button
                type="button"
                onClick={() => setMobileQueueOpen(true)}
                className="absolute bottom-[calc(1rem_+_env(safe-area-inset-bottom,0px))] left-1/2 z-20 flex min-h-11 -translate-x-1/2 items-center rounded-full bg-gov px-4 py-2 text-sm font-semibold text-white shadow-lg md:hidden"
              >
                Open work queue
              </button>
            )}
            <MapIntroPanel />
            <div
              data-testid="kpi-strip-floating-wrapper"
              className="pointer-events-none absolute left-1/2 top-3 hidden -translate-x-1/2 lg:block"
            >
              <KpiStrip parcels={parcels} alerts={alerts} cases={cases} />
            </div>
            <div className="absolute bottom-[calc(0.75rem_+_env(safe-area-inset-bottom,0px))] left-[calc(0.75rem_+_env(safe-area-inset-left,0px))]">
              <MapLegend
                categories={parcels.map((parcel) => parcel.land_category)}
                h3Visible={canShowH3}
              />
            </div>
            {selectedAlert && selectedParcel && (
              <SelectedAlertCard
                alert={selectedAlert}
                parcel={selectedParcel}
                caseForAlert={casesByAlertId.get(selectedAlert.id)}
                onClose={deselectAlert}
              />
            )}
          </main>
        </div>
      </div>
    </div>
  );
}

export default function CommandMapPage() {
  return (
    <Suspense fallback={null}>
      <CommandMapPageContent />
    </Suspense>
  );
}
