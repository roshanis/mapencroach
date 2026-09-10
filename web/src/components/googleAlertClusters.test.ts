import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Alert, Parcel } from "@/lib/types";

const { clustererInstances, FakeClusterer } = vi.hoisted(() => {
  const instances: Array<{
    options: Record<string, unknown>;
    markers: unknown[];
    clearMarkers: ReturnType<typeof vi.fn>;
    addMarkers: ReturnType<typeof vi.fn>;
    setMap: ReturnType<typeof vi.fn>;
  }> = [];
  class Clusterer {
    options: Record<string, unknown>;
    markers: unknown[];
    clearMarkers = vi.fn((noDraw = false) => {
      if (!noDraw) this.markers.forEach(marker => { (marker as {map:unknown}).map = null; });
      this.markers = [];
    });
    addMarkers = vi.fn((markers: unknown[], noDraw = false) => {
      this.markers = markers;
      if (!noDraw) this.render();
    });
    setMap = vi.fn();
    render = vi.fn(() => {
      this.markers.forEach(marker => { (marker as {map:unknown}).map = this.options.map; });
    });
    constructor(options: Record<string, unknown>) {
      this.options = options;
      this.markers = (options.markers as unknown[]) ?? [];
      instances.push(this);
    }
  }
  return { clustererInstances: instances, FakeClusterer: Clusterer };
});

class FakeAdvancedMarker {
  private currentMap: unknown;
  get map() { return this.currentMap; }
  set map(value: unknown) {
    this.currentMap = value;
    if (!value) this.content?.remove();
    else if (this.content && !this.content.isConnected) document.body.appendChild(this.content);
  }
  position: unknown;
  content: HTMLElement | undefined;
  title: string | undefined;
  zIndex?: number;
  constructor(options: { map?: unknown; position?: unknown; content?: HTMLElement; title?: string }) {
    this.position = options.position;
    this.content = options.content;
    this.title = options.title;
    this.map = options.map;
    markerInstances.push(this);
  }
}

const markerInstances: FakeAdvancedMarker[] = [];

vi.mock("@googlemaps/markerclusterer", () => ({
  MarkerClusterer: FakeClusterer,
}));

import { createGoogleAlertClusters } from "./googleAlertClusters";

const AdvancedMarker = FakeAdvancedMarker as unknown as new (options: {
  map?: google.maps.Map | null;
  position: google.maps.LatLngLiteral | google.maps.LatLng;
  content?: HTMLElement;
  title?: string;
}) => google.maps.marker.AdvancedMarkerElement;

const map = { fitBounds: vi.fn() } as unknown as google.maps.Map & { fitBounds: ReturnType<typeof vi.fn> };
const parcels = [
  { id: "P-1", survey_no: "SN-1", centroid: [78, 29] },
  { id: "P-2", survey_no: "SN-2", centroid: [78.001, 29.001] },
] as Parcel[];
const alerts = [
  { id: "A-1", parcel_id: "P-1", tier: "red", severity_score: 90 },
  { id: "A-2", parcel_id: "P-2", tier: "amber", severity_score: 60 },
] as Alert[];

describe("createGoogleAlertClusters", () => {
  beforeEach(() => {
    clustererInstances.length = 0;
    markerInstances.length = 0;
    document.body.replaceChildren();
    map.fitBounds.mockReset();
  });

  it("clusters unselected alert markers and leaves the selected marker on the map", () => {
    const controller = createGoogleAlertClusters({
      map,
      AdvancedMarkerElement: AdvancedMarker,
      onAlertClick: vi.fn(),
    });

    controller.update(parcels, alerts, "A-1");

    expect(clustererInstances).toHaveLength(1);
    const markers = clustererInstances[0].markers as FakeAdvancedMarker[];
    expect(markers).toHaveLength(1);
    expect(markers[0].content?.dataset.alertId).toBe("A-2");
    expect(markers[0].map).toBe(map);
    const selected = markerInstances.find((marker) => marker.content?.dataset.alertId === "A-1");
    expect(selected?.map).toBe(map);
    expect(selected?.zIndex).toBeGreaterThan(markers[0].zIndex!);
  });

  it("reconciles removals, selection changes, and empty updates", () => {
    const controller = createGoogleAlertClusters({
      map,
      AdvancedMarkerElement: AdvancedMarker,
    });

    controller.update(parcels, alerts, "A-1");
    controller.update(parcels, [alerts[1]], "A-2");
    expect(clustererInstances[0].clearMarkers).toHaveBeenCalled();
    expect((clustererInstances[0].markers as FakeAdvancedMarker[])).toHaveLength(0);

    controller.update([], [], undefined);
    expect(clustererInstances[0].clearMarkers).toHaveBeenCalledTimes(2);
  });

  it("renders an accessible severity summary and fits bounds from the cluster click path", () => {
    const controller = createGoogleAlertClusters({
      map,
      AdvancedMarkerElement: AdvancedMarker,
    });
    controller.update(parcels, alerts);

    const renderer = clustererInstances[0].options.renderer as {
      render: (cluster: { count: number; position: unknown; markers: FakeAdvancedMarker[]; bounds: unknown }) => FakeAdvancedMarker;
    };
    const clusterMarker = renderer.render({
      count: 2,
      bounds: "bounds",
      position: { lat: () => 29, lng: () => 78 },
      markers: clustererInstances[0].markers as FakeAdvancedMarker[],
    });
    const button = clusterMarker.content?.querySelector("button") as HTMLButtonElement;
    expect(button.title).toContain("2 alerts");
    expect(button.getAttribute("aria-label")).toContain("1 red");
    expect(button.getAttribute("aria-label")).toContain("1 amber");

    const onClusterClick = clustererInstances[0].options.onClusterClick as (event: unknown, cluster: { bounds: unknown }) => void;
    button.click();
    expect(map.fitBounds).toHaveBeenCalledWith("bounds");
    onClusterClick({}, { bounds: "bounds" });
    expect(map.fitBounds).toHaveBeenCalledOnce();
  });

  it("preserves focused marker DOM when unchanged data is refreshed", () => {
    const controller = createGoogleAlertClusters({map, AdvancedMarkerElement: AdvancedMarker});
    controller.update(parcels, alerts);
    const button = markerInstances[0].content!.querySelector("button")!;
    button.focus();
    expect(document.activeElement).toBe(button);
    controller.update([...parcels], alerts.map(alert => ({...alert})));
    expect(markerInstances).toHaveLength(2);
    expect(document.activeElement).toBe(button);
  });

  it("cleans up marker maps and clusterer state", () => {
    const controller = createGoogleAlertClusters({
      map,
      AdvancedMarkerElement: AdvancedMarker,
    });
    controller.update(parcels, alerts);
    const markers = clustererInstances[0].markers as FakeAdvancedMarker[];

    controller.destroy();

    expect(clustererInstances[0].clearMarkers).toHaveBeenCalled();
    expect(clustererInstances[0].setMap).toHaveBeenCalledWith(null);
    expect(markers.every((marker) => marker.map === null)).toBe(true);
  });
});
