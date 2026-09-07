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
import { getAlerts, getCases, getParcel, getParcelPage } from "@/lib/api";
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
  const [parcelCoverage, setParcelCoverage] = useState<{
    shown: number;
    total?: number;
    truncated: boolean;
  }>({ shown: 0, truncated: false });
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [cases, setCases] = useState<Case[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [role, setRole] = useState("case_officer");
  const [mobileQueueOpen, setMobileQueueOpen] = useState(false);
  const queueTriggerRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const desktop = window.matchMedia("(min-width: 768px)");
    const releaseMobileDialog = (event: { matches: boolean }) => {
      if (event.matches) setMobileQueueOpen(false);
    };
    releaseMobileDialog(desktop);
    desktop.addEventListener("change", releaseMobileDialog);
    return () => desktop.removeEventListener("change", releaseMobileDialog);
  }, []);
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
      const [parcelPage, nextAlerts, nextCases] = await Promise.all([
        getParcelPage(),
        getAlerts(),
        getCases(),
      ]);
      setParcels(parcelPage.parcels);
      // Kept so the map can state what it is NOT drawing. /parcels is
      // paginated; rendering one page as though it were the whole estate
      // would show an officer a clean map over land the page never
      // covered, which is worse than showing nothing.
      setParcelCoverage({
        shown: parcelPage.parcels.length,
        total: parcelPage.total,
        truncated: parcelPage.truncated,
      });
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
  const loadedParcel = selectedAlert
    ? parcels.find((parcel) => parcel.id === selectedAlert.parcel_id)
    : undefined;
  const [extraParcel, setExtraParcel] = useState<Parcel>();
  const [contextError, setContextError] = useState(false);
  const [contextRetry, setContextRetry] = useState(0);
  const missingParcelId = selectedAlert && !loadedParcel ? selectedAlert.parcel_id : undefined;
  useEffect(() => {
    let cancelled = false;
    setExtraParcel(undefined);
    setContextError(false);
    if (missingParcelId) {
      void getParcel(missingParcelId).then(parcel => {
        if (cancelled) return;
        if (parcel) setExtraParcel(parcel);
        else setContextError(true);
      }).catch(() => { if (!cancelled) setContextError(true); });
    }
    return () => { cancelled = true; };
  }, [missingParcelId, contextRetry]);
  const selectedParcel = loadedParcel ?? (extraParcel?.id === missingParcelId ? extraParcel : undefined);

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
      <div
        data-testid="console-topbar-background"
        inert={mobileQueueOpen || undefined}
      >
        <TopBar jurisdiction="Haridwar–Roorkee Development Authority" />
        {parcelCoverage.truncated && (
          // Never silently show a subset of the estate as though it were all
          // of it: an officer reading a clean map cannot tell the difference
          // between "no encroachment here" and "this land was never drawn".
          <p
            role="alert"
            data-testid="parcel-coverage-warning"
            className="border-b border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900"
          >
            <strong className="font-semibold">Map is incomplete.</strong>{" "}
            Showing {parcelCoverage.shown.toLocaleString()} of{" "}
            {parcelCoverage.total?.toLocaleString()} parcels in your
            jurisdiction. The rest are not drawn, and any alert on them is not
            shown here — do not read this map as full coverage.
          </p>
        )}
      </div>
      <div className="relative flex flex-1 overflow-hidden">
        <AlertSidebar
          returnFocusRef={queueTriggerRef}
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
        <div
          data-testid="console-background"
          inert={mobileQueueOpen || undefined}
          className="flex flex-1 flex-col overflow-hidden"
        >
          <details
            data-testid="kpi-strip-compact-wrapper"
            className="border-b border-slate-200 bg-slate-50 px-3 py-2 lg:hidden"
          >
            <summary className="cursor-pointer text-xs font-medium text-slate-700">Workspace summary</summary>
            <KpiStrip
              parcels={parcels}
              alerts={alerts}
              cases={cases}
              variant="compact"
            />
          </details>
          <main className="flex min-h-0 flex-1 flex-col">
            <div data-testid="map-toolbar" className={`${selectedAlert ? "hidden" : "flex"} max-h-[30vh] shrink-0 flex-wrap items-start justify-between gap-2 overflow-y-auto border-b bg-white p-2`}>
              <H3GridControl
                visible={canShowH3}
                resolution={h3Resolution}
                cellCount={h3Grid.featureCollection.features.length}
                warning={h3Grid.ok ? undefined : h3Grid.error.message}
                onVisibleChange={setH3Visible}
                onResolutionChange={setH3Resolution}
              />
              <MapIntroPanel />
            </div>
            <div data-testid="kpi-strip-floating-wrapper" className="hidden shrink-0 border-b bg-slate-50 p-2 lg:block">
              <KpiStrip parcels={parcels} alerts={alerts} cases={cases} variant="compact" />
            </div>
            <div data-testid="map-canvas-region" className="relative min-h-0 flex-1">
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
            </div>
            <div data-testid="map-footer" className="flex max-h-[25vh] shrink-0 items-start justify-between gap-2 overflow-y-auto border-t bg-white p-2">
              <MapLegend categories={parcels.map(parcel => parcel.land_category)} h3Visible={canShowH3} />
              <button type="button" ref={queueTriggerRef}
                aria-hidden={mobileQueueOpen || undefined}
                tabIndex={mobileQueueOpen ? -1 : undefined}
                onClick={() => setMobileQueueOpen(true)}
                className={`min-h-11 shrink-0 items-center rounded-full bg-gov px-3 py-2 text-sm font-semibold text-white md:hidden ${mobileQueueOpen ? "invisible pointer-events-none" : "flex"}`}
              >Open work queue</button>
            </div>
            {selectedAlert && !selectedParcel && (
              <aside role="status" className="shrink-0 rounded-lg border bg-white p-4 shadow">
                <p>{contextError ? "Selected parcel details could not be loaded." : "Loading selected parcel details…"}</p>
                {contextError && <button type="button" onClick={() => setContextRetry(n => n + 1)} className="mt-2 rounded border px-3 py-2">Retry parcel details</button>}
                <button type="button" onClick={deselectAlert} className="ml-2 rounded border px-3 py-2">Close selection</button>
              </aside>
            )}
            {selectedAlert && selectedParcel && (
              <SelectedAlertCard
                contextNotice={!loadedParcel ? "This parcel is outside the loaded map page. Its record is available below; its boundary is not drawn here." : undefined}
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
