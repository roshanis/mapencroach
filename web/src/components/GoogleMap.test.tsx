import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { FIXTURE_ALERTS, FIXTURE_PARCELS } from "@/lib/fixtures";
import GoogleMap from "./GoogleMap";

const loaderMocks = vi.hoisted(() => ({
  setOptions: vi.fn(),
  importLibrary: vi.fn(),
}));

vi.mock("@googlemaps/js-api-loader", () => loaderMocks);

describe("GoogleMap", () => {
  it("renders the operational GeoJSON and preserves map interactions", async () => {
    const addGeoJson = vi.fn();
    const setStyle = vi.fn();
    const mapType = vi.fn();
    const panTo = vi.fn();
    const setZoom = vi.fn();
    const mapConstructor = vi.fn();
    const advancedMarkerConstructor = vi.fn();
    const markers: Array<{ map: unknown }> = [];

    class FakeMap {
      data = { addGeoJson, setStyle };
      setMapTypeId = mapType;
      panTo = panTo;
      setZoom = setZoom;

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
        gestureHandling: "greedy",
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

    const markerOptions = advancedMarkerConstructor.mock.calls[0][0];
    expect(markerOptions.position).toEqual({ lat: 29.913, lng: 77.979 });
    expect(markerOptions.content).toHaveAttribute(
      "aria-label",
      `Select alert ${FIXTURE_ALERTS[0].id}`
    );
    expect(markerOptions.content).toHaveAttribute("data-selected", "true");
    markerOptions.content.click();
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
    expect(markerOptions.content).toHaveAttribute("data-selected", "false");

    unmount();
    expect(markers[0].map).toBeNull();
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
