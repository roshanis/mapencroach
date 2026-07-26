import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FIXTURE_ALERTS, FIXTURE_PARCELS } from "@/lib/fixtures";
import GoogleMap from "./GoogleMap";

const loaderMocks = vi.hoisted(() => ({
  setOptions: vi.fn(),
  importLibrary: vi.fn(),
}));

vi.mock("@googlemaps/js-api-loader", () => loaderMocks);

class FakeLatLngBounds {
  extend = vi.fn().mockReturnThis();
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
});
