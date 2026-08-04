import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FIXTURE_ALERTS, FIXTURE_PARCELS } from "@/lib/fixtures";
import MapLibreMap from "./MapLibreMap";

// Fake maplibre-gl: a `Map` class that records its constructor args, exposes
// `on("load", cb)` (capturing the callback so tests can fire it manually), a
// controllable `isStyleLoaded()` flag, and spies for the layer/layout/marker
// calls the component depends on. `Marker`/`LngLatBounds` are minimal stubs
// that still record enough (the element handed to the Marker constructor,
// removal) for assertions.
const mapMocks = vi.hoisted(() => {
  let styleLoaded = false;
  let loadCallback: (() => void) | undefined;

  const mapConstructor = vi.fn();
  const setLayoutProperty = vi.fn();
  const addSource = vi.fn();
  const addLayer = vi.fn();
  const fitBounds = vi.fn();
  const flyTo = vi.fn();
  const remove = vi.fn();
  const disableRotation = vi.fn();
  const markerConstructor = vi.fn();
  const markerSetLngLat = vi.fn();
  const markerAddTo = vi.fn();
  const markerRemove = vi.fn();

  class FakeMap {
    touchZoomRotate = { disableRotation };

    constructor(options: unknown) {
      mapConstructor(options);
    }
    on(event: string, cb: () => void) {
      if (event === "load") loadCallback = cb;
    }
    isStyleLoaded() {
      return styleLoaded;
    }
    setLayoutProperty(...args: unknown[]) {
      setLayoutProperty(...args);
    }
    addSource(...args: unknown[]) {
      addSource(...args);
    }
    addLayer(...args: unknown[]) {
      addLayer(...args);
    }
    fitBounds(...args: unknown[]) {
      fitBounds(...args);
    }
    flyTo(...args: unknown[]) {
      flyTo(...args);
    }
    remove(...args: unknown[]) {
      remove(...args);
    }
  }

  class FakeMarker {
    private element: HTMLElement;

    constructor({ element }: { element: HTMLElement }) {
      this.element = element;
      markerConstructor(element);
    }
    setLngLat(...args: unknown[]) {
      markerSetLngLat(...args);
      return this;
    }
    addTo(...args: unknown[]) {
      markerAddTo(...args);
      return this;
    }
    remove() {
      markerRemove();
    }
  }

  class FakeLngLatBounds {
    extend() {
      return this;
    }
  }

  return {
    mapConstructor,
    setLayoutProperty,
    addSource,
    addLayer,
    fitBounds,
    flyTo,
    remove,
    disableRotation,
    markerConstructor,
    markerSetLngLat,
    markerAddTo,
    markerRemove,
    FakeMap,
    FakeMarker,
    FakeLngLatBounds,
    setStyleLoaded(value: boolean) {
      styleLoaded = value;
    },
    fireLoad() {
      loadCallback?.();
    },
    getLoadCallback() {
      return loadCallback;
    },
    reset() {
      styleLoaded = false;
      loadCallback = undefined;
    },
  };
});

vi.mock("maplibre-gl/dist/maplibre-gl.css", () => ({}));
vi.mock("maplibre-gl", () => ({
  default: {
    Map: mapMocks.FakeMap,
    Marker: mapMocks.FakeMarker,
    LngLatBounds: mapMocks.FakeLngLatBounds,
  },
}));

describe("MapLibreMap", () => {
  beforeEach(() => {
    mapMocks.reset();
    mapMocks.mapConstructor.mockClear();
    mapMocks.setLayoutProperty.mockClear();
    mapMocks.addSource.mockClear();
    mapMocks.addLayer.mockClear();
    mapMocks.fitBounds.mockClear();
    mapMocks.flyTo.mockClear();
    mapMocks.remove.mockClear();
    mapMocks.disableRotation.mockClear();
    mapMocks.markerConstructor.mockClear();
    mapMocks.markerSetLngLat.mockClear();
    mapMocks.markerAddTo.mockClear();
    mapMocks.markerRemove.mockClear();
  });

  it("builds the map without rotation, loads parcels/alerts, and wires marker + basemap interaction", async () => {
    const onReady = vi.fn();
    const onAlertClick = vi.fn();

    const { unmount } = render(
      <MapLibreMap
        parcels={FIXTURE_PARCELS.slice(0, 2)}
        alerts={FIXTURE_ALERTS.slice(0, 1)}
        selectedAlertId={FIXTURE_ALERTS[0].id}
        onReady={onReady}
        onAlertClick={onAlertClick}
      />
    );

    await waitFor(() => expect(mapMocks.mapConstructor).toHaveBeenCalledOnce());

    // A flat parcel map with no compass/reset control must not let a
    // two-finger touch twist (or desktop right-drag) rotate it away from
    // north with no way back — pinch-zoom and pan stay on.
    expect(mapMocks.mapConstructor).toHaveBeenCalledWith(
      expect.objectContaining({
        center: [78.03, 29.92],
        zoom: 11,
        dragRotate: false,
        touchPitch: false,
      })
    );
    expect(mapMocks.disableRotation).toHaveBeenCalledOnce();

    await waitFor(() => expect(mapMocks.getLoadCallback()).toBeInstanceOf(Function));
    act(() => {
      mapMocks.fireLoad();
    });

    expect(mapMocks.addSource).toHaveBeenCalledWith(
      "parcels",
      expect.objectContaining({
        type: "geojson",
        data: expect.objectContaining({
          features: expect.arrayContaining([
            expect.objectContaining({
              properties: expect.objectContaining({ id: FIXTURE_PARCELS[0].id }),
            }),
          ]),
        }),
      })
    );
    expect(mapMocks.addLayer).toHaveBeenCalledWith(
      expect.objectContaining({ id: "parcel-fill", source: "parcels" })
    );
    expect(mapMocks.addLayer).toHaveBeenCalledWith(
      expect.objectContaining({ id: "parcel-outline", source: "parcels" })
    );

    // The map SDK only ever gets the marker WRAPPER (never the inner
    // button) -- MapLibre's positioning `transform` and its "Map marker"
    // aria-label overwrite land on the wrapper, never touching the button's
    // own selection styling or label.
    expect(mapMocks.markerConstructor).toHaveBeenCalledOnce();
    const wrapper = mapMocks.markerConstructor.mock.calls[0][0] as HTMLElement;
    const markerButton = wrapper.querySelector(
      '[data-testid="alert-marker"]'
    ) as HTMLButtonElement;

    expect(markerButton).toBeTruthy();
    expect(markerButton.getAttribute("aria-label")).toContain(FIXTURE_ALERTS[0].id);
    expect(markerButton.getAttribute("aria-label")).toContain("Red");
    expect(markerButton).toHaveAttribute("data-selected", "true");
    markerButton.click();
    expect(onAlertClick).toHaveBeenCalledWith(FIXTURE_ALERTS[0].id);

    expect(onReady).toHaveBeenCalledOnce();
    onReady.mock.calls[0][0].panTo([77.99, 29.91]);
    expect(mapMocks.flyTo).toHaveBeenCalledWith({ center: [77.99, 29.91], zoom: 15 });

    // The "load" event having already fired means the style is done
    // loading in reality; reflect that in the mock so basemap clicks below
    // actually reach setLayoutProperty instead of being deferred.
    mapMocks.setStyleLoaded(true);

    fireEvent.click(screen.getByTestId("basemap-streets"));
    expect(mapMocks.setLayoutProperty).toHaveBeenCalledWith(
      "esri-base",
      "visibility",
      "none"
    );
    expect(mapMocks.setLayoutProperty).toHaveBeenCalledWith(
      "osm-base",
      "visibility",
      "visible"
    );

    fireEvent.click(screen.getByTestId("basemap-satellite"));
    expect(mapMocks.setLayoutProperty).toHaveBeenCalledWith(
      "esri-base",
      "visibility",
      "visible"
    );
    expect(mapMocks.setLayoutProperty).toHaveBeenCalledWith(
      "osm-base",
      "visibility",
      "none"
    );

    unmount();
    expect(mapMocks.markerRemove).toHaveBeenCalledOnce();
    expect(mapMocks.remove).toHaveBeenCalledOnce();
  });

  it("skips alerts that have no matching parcel instead of crashing", async () => {
    const orphanAlert = {
      ...FIXTURE_ALERTS[0],
      id: "orphan-alert",
      parcel_id: "no-such-parcel",
    };

    render(<MapLibreMap parcels={[]} alerts={[orphanAlert]} />);

    await waitFor(() => expect(mapMocks.getLoadCallback()).toBeInstanceOf(Function));
    act(() => {
      mapMocks.fireLoad();
    });

    expect(mapMocks.markerConstructor).not.toHaveBeenCalled();
  });

  it("defers a basemap toggle clicked before the style finishes loading, then applies it once load fires; a toggle after load applies immediately", async () => {
    render(<MapLibreMap parcels={FIXTURE_PARCELS.slice(0, 1)} alerts={[]} />);

    await waitFor(() => expect(mapMocks.mapConstructor).toHaveBeenCalledOnce());

    // The map instance exists (mapRef.current is set) but the style hasn't
    // finished loading yet -- maplibre-gl throws "Style is not done loading"
    // if setLayoutProperty is called here, so the click must be a no-op on
    // the map (state-only) and must not throw.
    expect(() =>
      fireEvent.click(screen.getByTestId("basemap-streets"))
    ).not.toThrow();
    expect(mapMocks.setLayoutProperty).not.toHaveBeenCalled();

    // Once the style finishes loading, the pending toggle must take effect:
    // osm-base (streets) visible, esri-base (satellite) hidden.
    act(() => {
      mapMocks.fireLoad();
    });

    expect(mapMocks.setLayoutProperty).toHaveBeenCalledWith(
      "esri-base",
      "visibility",
      "none"
    );
    expect(mapMocks.setLayoutProperty).toHaveBeenCalledWith(
      "osm-base",
      "visibility",
      "visible"
    );

    // After load, isStyleLoaded() reports true and a toggle click applies
    // setLayoutProperty immediately.
    mapMocks.setStyleLoaded(true);
    mapMocks.setLayoutProperty.mockClear();

    fireEvent.click(screen.getByTestId("basemap-satellite"));

    expect(mapMocks.setLayoutProperty).toHaveBeenCalledWith(
      "esri-base",
      "visibility",
      "visible"
    );
    expect(mapMocks.setLayoutProperty).toHaveBeenCalledWith(
      "osm-base",
      "visibility",
      "none"
    );
  });
});
