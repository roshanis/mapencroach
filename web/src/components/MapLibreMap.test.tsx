import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FIXTURE_PARCELS } from "@/lib/fixtures";
import MapLibreMap from "./MapLibreMap";

// Fake maplibre-gl: a `Map` class that records its constructor args, exposes
// `on("load", cb)` (capturing the callback so tests can fire it manually), a
// controllable `isStyleLoaded()` flag, and spies for the layer/layout calls
// the component depends on. `Marker`/`LngLatBounds` are minimal stubs.
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

  class FakeMap {
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
    setLngLat() {
      return this;
    }
    addTo() {
      return this;
    }
    remove() {}
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
    FakeMap,
    FakeMarker,
    FakeLngLatBounds,
    setStyleLoaded(value: boolean) {
      styleLoaded = value;
    },
    fireLoad() {
      loadCallback?.();
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
    mapMocks.remove.mockClear();
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
    mapMocks.fireLoad();

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
