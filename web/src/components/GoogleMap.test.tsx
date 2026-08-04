import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FIXTURE_ALERTS, FIXTURE_PARCELS } from "@/lib/fixtures";
import GoogleMap from "./GoogleMap";
import type { H3FeatureCollection } from "./map-types";

const loaderMocks = vi.hoisted(() => ({
  setOptions: vi.fn(),
  importLibrary: vi.fn(),
}));

vi.mock("@googlemaps/js-api-loader", () => loaderMocks);

class FakeLatLngBounds {
  extend = vi.fn().mockReturnThis();
}

class FakeData {
  addGeoJson = vi.fn();
  setStyle = vi.fn();
  setMap = vi.fn();
  forEach = vi.fn();
  remove = vi.fn();
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("GoogleMap", () => {
  it("renders the operational GeoJSON and preserves map interactions", async () => {
    const addGeoJson = vi.fn();
    const setStyle = vi.fn();
    const mapType = vi.fn();
    const panTo = vi.fn();
    const setZoom = vi.fn();
    const fitBounds = vi.fn();
    const mapConstructor = vi.fn();
    const advancedMarkerConstructor = vi.fn();
    const markers: Array<{ map: unknown }> = [];
    const boundsInstances: FakeLatLngBounds[] = [];

    vi.stubGlobal("google", {
      maps: {
        Data: FakeData,
        LatLngBounds: class extends FakeLatLngBounds {
          constructor() {
            super();
            boundsInstances.push(this);
          }
        },
      },
    });

    class FakeMap {
      data = { addGeoJson, setStyle };
      setMapTypeId = mapType;
      panTo = panTo;
      setZoom = setZoom;
      fitBounds = fitBounds;

      constructor(container: HTMLElement, options: google.maps.MapOptions) {
        mapConstructor(container, options);
      }
    }

    class FakeAdvancedMarkerElement {
      map: unknown;

      constructor(options: google.maps.marker.AdvancedMarkerElementOptions) {
        this.map = options.map;
        advancedMarkerConstructor(options);
        markers.push(this);
      }
    }

    loaderMocks.importLibrary.mockImplementation(async (library: string) => {
      if (library === "maps") return { Map: FakeMap };
      if (library === "marker") {
        return { AdvancedMarkerElement: FakeAdvancedMarkerElement };
      }
      throw new Error(`Unexpected library: ${library}`);
    });

    const onReady = vi.fn();
    const onAlertClick = vi.fn();
    const onProviderError = vi.fn();
    const { rerender, unmount } = render(
      <GoogleMap
        apiKey="restricted-browser-key"
        mapId="map-id"
        parcels={FIXTURE_PARCELS.slice(0, 2)}
        alerts={FIXTURE_ALERTS.slice(0, 1)}
        selectedAlertId={FIXTURE_ALERTS[0].id}
        onReady={onReady}
        onAlertClick={onAlertClick}
        onProviderError={onProviderError}
      />
    );

    await waitFor(() => expect(mapConstructor).toHaveBeenCalledOnce());

    expect(loaderMocks.setOptions).toHaveBeenCalledWith({
      key: "restricted-browser-key",
      v: "weekly",
      authReferrerPolicy: "origin",
    });
    expect(mapConstructor).toHaveBeenCalledWith(
      expect.any(HTMLElement),
      expect.objectContaining({
        center: { lat: 29.92, lng: 78.03 },
        zoom: 11,
        mapId: "map-id",
        mapTypeId: "hybrid",
      })
    );
    expect(addGeoJson).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "FeatureCollection",
        features: expect.arrayContaining([
          expect.objectContaining({
            properties: expect.objectContaining({ id: FIXTURE_PARCELS[0].id }),
          }),
        ]),
      })
    );
    expect(setStyle).toHaveBeenCalledOnce();
    expect(advancedMarkerConstructor).toHaveBeenCalledOnce();

    // Camera fits to the two parcels' polygon vertices (10 total: 2 parcels x
    // 5-point closed rings), with generous padding for the sidebar/HUD chrome.
    expect(boundsInstances).toHaveLength(1);
    expect(boundsInstances[0].extend).toHaveBeenCalledTimes(10);
    expect(fitBounds).toHaveBeenCalledWith(boundsInstances[0], {
      top: 130,
      right: 130,
      bottom: 110,
      left: 90,
    });

    const markerOptions = advancedMarkerConstructor.mock.calls[0][0];
    const wrapper = markerOptions.content as HTMLElement;
    const button = wrapper.querySelector(
      '[data-testid="alert-marker"]'
    ) as HTMLButtonElement;

    expect(button).toBeTruthy();
    expect(button.getAttribute("aria-label")).toContain(FIXTURE_ALERTS[0].id);
    expect(button.getAttribute("aria-label")).toContain("Red");
    expect(button.getAttribute("aria-label")).toContain(
      String(Math.round(FIXTURE_ALERTS[0].severity_score))
    );
    expect(button).toHaveAttribute("data-selected", "true");
    expect(button.textContent).toBe(
      String(Math.round(FIXTURE_ALERTS[0].severity_score))
    );
    // The map SDK only ever positions the wrapper -- it must never carry a
    // transform of its own from our selection styling.
    expect(wrapper.style.transform).toBe("");

    button.click();
    expect(onAlertClick).toHaveBeenCalledWith(FIXTURE_ALERTS[0].id);

    expect(onReady).toHaveBeenCalledOnce();
    onReady.mock.calls[0][0].panTo([77.99, 29.91]);
    expect(panTo).toHaveBeenCalledWith({ lat: 29.91, lng: 77.99 });
    expect(setZoom).toHaveBeenCalledWith(15);

    fireEvent.click(screen.getByTestId("basemap-streets"));
    expect(mapType).toHaveBeenCalledWith("roadmap");
    fireEvent.click(screen.getByTestId("basemap-satellite"));
    expect(mapType).toHaveBeenCalledWith("hybrid");

    rerender(
      <GoogleMap
        apiKey="restricted-browser-key"
        mapId="map-id"
        parcels={FIXTURE_PARCELS.slice(0, 2)}
        alerts={FIXTURE_ALERTS.slice(0, 1)}
        selectedAlertId={undefined}
        onReady={onReady}
        onAlertClick={onAlertClick}
        onProviderError={onProviderError}
      />
    );
    expect(button).toHaveAttribute("data-selected", "false");
    expect(wrapper.style.transform).toBe("");

    unmount();
    expect(markers[0].map).toBeNull();
  });

  it("constructs the map with the basemap mode toggled before the loader resolved, not the hardcoded default", async () => {
    const mapConstructor = vi.fn();

    vi.stubGlobal("google", {
      maps: {
        Data: FakeData,
        LatLngBounds: FakeLatLngBounds,
      },
    });

    class FakeMap {
      data = { addGeoJson: vi.fn(), setStyle: vi.fn() };
      setMapTypeId = vi.fn();
      panTo = vi.fn();
      setZoom = vi.fn();
      fitBounds = vi.fn();

      constructor(container: HTMLElement, options: google.maps.MapOptions) {
        mapConstructor(container, options);
      }
    }

    class FakeAdvancedMarkerElement {
      map: unknown;

      constructor(options: google.maps.marker.AdvancedMarkerElementOptions) {
        this.map = options.map;
      }
    }

    // Keep the "maps" library import unresolved until after the toggle
    // click, simulating a click landing during the loader's async gap
    // (mapRef.current is still null at that point).
    let resolveMapsLibrary: (value: { Map: typeof FakeMap }) => void = () => {};
    const mapsLibraryPromise = new Promise<{ Map: typeof FakeMap }>((resolve) => {
      resolveMapsLibrary = resolve;
    });

    loaderMocks.importLibrary.mockImplementation(async (library: string) => {
      if (library === "maps") return mapsLibraryPromise;
      if (library === "marker") {
        return { AdvancedMarkerElement: FakeAdvancedMarkerElement };
      }
      throw new Error(`Unexpected library: ${library}`);
    });

    render(
      <GoogleMap
        apiKey="restricted-browser-key"
        mapId="map-id"
        parcels={[]}
        alerts={[]}
        onReady={vi.fn()}
        onAlertClick={vi.fn()}
        onProviderError={vi.fn()}
      />
    );

    // The loader hasn't resolved yet, so the Map hasn't been constructed --
    // mapRef.current is still null and this click is otherwise a silent
    // no-op on the map itself.
    fireEvent.click(screen.getByTestId("basemap-streets"));

    resolveMapsLibrary({ Map: FakeMap });

    await waitFor(() => expect(mapConstructor).toHaveBeenCalledOnce());

    expect(mapConstructor).toHaveBeenCalledWith(
      expect.any(HTMLElement),
      expect.objectContaining({ mapTypeId: "roadmap" })
    );
  });

  it("renders H3 cells on a separate layer and updates its data and visibility without remounting", async () => {
    const mapConstructor = vi.fn();
    const parcelAddGeoJson = vi.fn();
    const parcelSetStyle = vi.fn();
    const h3AddGeoJson = vi.fn();
    const h3SetStyle = vi.fn();
    const h3SetMap = vi.fn();
    const h3Remove = vi.fn();
    const dataConstructor = vi.fn();

    const firstCells: H3FeatureCollection = {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: {
            type: "Polygon",
            coordinates: [
              [
                [78.0, 29.9],
                [78.01, 29.9],
                [78.01, 29.91],
                [78.0, 29.91],
                [78.0, 29.9],
              ],
            ],
          },
          properties: {
            h3Index: "8b3da2192948fff",
            resolution: 11,
            parcelIds: [FIXTURE_PARCELS[0].id],
          },
        },
      ],
    };
    const replacementCells: H3FeatureCollection = {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: {
            type: "Polygon",
            coordinates: [
              [
                [78.02, 29.92],
                [78.03, 29.92],
                [78.03, 29.93],
                [78.02, 29.93],
                [78.02, 29.92],
              ],
            ],
          },
          properties: {
            h3Index: "8b3da2192949fff",
            resolution: 10,
            parcelIds: [FIXTURE_PARCELS[1].id],
          },
        },
      ],
    };

    class FakeData {
      features: unknown[] = [];

      constructor() {
        dataConstructor();
      }

      addGeoJson(collection: H3FeatureCollection) {
        h3AddGeoJson(collection);
        const added = collection.features.map((feature) => ({ feature }));
        this.features.push(...added);
        return added;
      }

      setStyle(style: google.maps.Data.StylingFunction | google.maps.Data.StyleOptions) {
        h3SetStyle(style);
      }

      setMap(map: google.maps.Map | null) {
        h3SetMap(map);
      }

      forEach(callback: (feature: unknown) => void) {
        [...this.features].forEach(callback);
      }

      remove(feature: unknown) {
        h3Remove(feature);
        this.features = this.features.filter((candidate) => candidate !== feature);
      }
    }

    vi.stubGlobal("google", {
      maps: {
        Data: FakeData,
        LatLngBounds: FakeLatLngBounds,
      },
    });

    class FakeMap {
      data = { addGeoJson: parcelAddGeoJson, setStyle: parcelSetStyle };
      setMapTypeId = vi.fn();
      panTo = vi.fn();
      setZoom = vi.fn();
      fitBounds = vi.fn();

      constructor(container: HTMLElement, options: google.maps.MapOptions) {
        mapConstructor(container, options);
      }
    }

    class FakeAdvancedMarkerElement {
      map: unknown;

      constructor(options: google.maps.marker.AdvancedMarkerElementOptions) {
        this.map = options.map;
      }
    }

    loaderMocks.importLibrary.mockImplementation(async (library: string) => {
      if (library === "maps") return { Map: FakeMap };
      if (library === "marker") {
        return { AdvancedMarkerElement: FakeAdvancedMarkerElement };
      }
      throw new Error(`Unexpected library: ${library}`);
    });

    const baseProps = {
      apiKey: "restricted-browser-key",
      mapId: "map-id",
      parcels: FIXTURE_PARCELS.slice(0, 2),
      alerts: [],
      onProviderError: vi.fn(),
    };
    const { rerender, unmount } = render(
      <GoogleMap
        {...baseProps}
        h3Cells={firstCells}
        h3Visible
      />
    );

    await waitFor(() => expect(dataConstructor).toHaveBeenCalledOnce());

    expect(mapConstructor).toHaveBeenCalledOnce();
    expect(parcelAddGeoJson).toHaveBeenCalledOnce();
    expect(h3AddGeoJson).toHaveBeenCalledWith(firstCells);
    expect(h3SetStyle).toHaveBeenCalledWith({
      clickable: false,
      fillColor: "#06b6d4",
      fillOpacity: 0.14,
      strokeColor: "#0891b2",
      strokeOpacity: 0.9,
      strokeWeight: 1.5,
      zIndex: 1,
    });
    expect(h3SetMap).toHaveBeenLastCalledWith(expect.any(FakeMap));

    rerender(
      <GoogleMap
        {...baseProps}
        h3Cells={firstCells}
        h3Visible={false}
      />
    );
    expect(h3SetMap).toHaveBeenLastCalledWith(null);
    expect(h3AddGeoJson).toHaveBeenCalledTimes(1);

    rerender(
      <GoogleMap
        {...baseProps}
        h3Cells={replacementCells}
        h3Visible={false}
      />
    );
    expect(h3Remove).toHaveBeenCalledOnce();
    expect(h3AddGeoJson).toHaveBeenLastCalledWith(replacementCells);
    expect(dataConstructor).toHaveBeenCalledOnce();
    expect(mapConstructor).toHaveBeenCalledOnce();

    rerender(
      <GoogleMap
        {...baseProps}
        h3Cells={replacementCells}
        h3Visible
      />
    );
    expect(h3SetMap).toHaveBeenLastCalledWith(expect.any(FakeMap));
    expect(h3AddGeoJson).toHaveBeenCalledTimes(2);

    unmount();
    expect(h3SetMap).toHaveBeenLastCalledWith(null);
  });

  it("triggers the provider fallback when Google reports gm_authFailure (invalid key / referrer / billing) even though the script load resolved", async () => {
    // importLibrary() resolves normally here — this reproduces an invalid
    // key, referrer restriction, or disabled billing, all of which Google
    // reports only via the gm_authFailure global, never as a rejected
    // promise. Without wiring that signal up, onProviderError never fires
    // and the map stays gray forever.
    class FakeMap {
      data = { addGeoJson: vi.fn(), setStyle: vi.fn() };
      setMapTypeId = vi.fn();
    }
    loaderMocks.importLibrary.mockImplementation(async (library: string) => {
      if (library === "maps") return { Map: FakeMap };
      if (library === "marker") {
        return { AdvancedMarkerElement: class {} };
      }
      throw new Error(`Unexpected library: ${library}`);
    });

    vi.stubGlobal("google", {
      maps: {
        Data: FakeData,
        LatLngBounds: FakeLatLngBounds,
      },
    });

    const onProviderError = vi.fn();
    render(
      <GoogleMap
        apiKey="restricted-browser-key"
        mapId="map-id"
        parcels={[]}
        alerts={[]}
        onProviderError={onProviderError}
      />
    );

    await waitFor(() => expect(window.gm_authFailure).toBeInstanceOf(Function));
    expect(onProviderError).not.toHaveBeenCalled();

    act(() => {
      window.gm_authFailure?.();
    });

    expect(onProviderError).toHaveBeenCalledOnce();
  });

  it("stops calling onProviderError for gm_authFailure after unmount", async () => {
    class FakeMap {
      data = { addGeoJson: vi.fn(), setStyle: vi.fn() };
      setMapTypeId = vi.fn();
    }
    loaderMocks.importLibrary.mockImplementation(async (library: string) => {
      if (library === "maps") return { Map: FakeMap };
      if (library === "marker") {
        return { AdvancedMarkerElement: class {} };
      }
      throw new Error(`Unexpected library: ${library}`);
    });

    vi.stubGlobal("google", {
      maps: {
        Data: FakeData,
        LatLngBounds: FakeLatLngBounds,
      },
    });

    const onProviderError = vi.fn();
    const { unmount } = render(
      <GoogleMap
        apiKey="restricted-browser-key"
        mapId="map-id"
        parcels={[]}
        alerts={[]}
        onProviderError={onProviderError}
      />
    );

    await waitFor(() => expect(window.gm_authFailure).toBeInstanceOf(Function));
    unmount();

    act(() => {
      window.gm_authFailure?.();
    });

    expect(onProviderError).not.toHaveBeenCalled();
  });
});
