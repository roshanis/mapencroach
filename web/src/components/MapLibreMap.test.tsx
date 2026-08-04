import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FIXTURE_PARCELS } from "@/lib/fixtures";
import MapLibreMap from "./MapLibreMap";
import type { H3FeatureCollection } from "./map-types";

const H3_CELLS: H3FeatureCollection = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [78.02, 29.91],
            [78.03, 29.91],
            [78.035, 29.92],
            [78.03, 29.93],
            [78.02, 29.93],
            [78.015, 29.92],
            [78.02, 29.91],
          ],
        ],
      },
      properties: {
        h3Index: "8b43a1030928fff",
        resolution: 11,
        parcelIds: ["parcel-1"],
      },
    },
  ],
};

const UPDATED_H3_CELLS: H3FeatureCollection = {
  ...H3_CELLS,
  features: H3_CELLS.features.map((feature) => ({
    ...feature,
    properties: { ...feature.properties, resolution: 10 },
  })),
};

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
  const getSource = vi.fn();
  const setH3Data = vi.fn();
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
    getSource(...args: unknown[]) {
      getSource(...args);
      return args[0] === "h3-grid" ? { setData: setH3Data } : undefined;
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
    getSource,
    setH3Data,
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
    mapMocks.getSource.mockClear();
    mapMocks.setH3Data.mockClear();
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

  it("renders H3 cells as a distinct analytical layer and updates data and visibility without remounting", async () => {
    const { rerender } = render(
      <MapLibreMap
        parcels={FIXTURE_PARCELS.slice(0, 1)}
        alerts={[]}
        h3Cells={H3_CELLS}
        h3Visible
      />
    );

    await waitFor(() => expect(mapMocks.mapConstructor).toHaveBeenCalledOnce());
    mapMocks.fireLoad();

    expect(mapMocks.addSource).toHaveBeenCalledWith("h3-grid", {
      type: "geojson",
      data: H3_CELLS,
    });
    expect(mapMocks.addLayer).toHaveBeenCalledWith({
      id: "h3-grid-fill",
      type: "fill",
      source: "h3-grid",
      layout: { visibility: "visible" },
      paint: {
        "fill-color": "#06b6d4",
        "fill-opacity": 0.14,
      },
    });
    expect(mapMocks.addLayer).toHaveBeenCalledWith({
      id: "h3-grid-outline",
      type: "line",
      source: "h3-grid",
      layout: { visibility: "visible" },
      paint: {
        "line-color": "#0891b2",
        "line-opacity": 0.9,
        "line-width": 1.5,
      },
    });

    mapMocks.setStyleLoaded(true);
    mapMocks.setLayoutProperty.mockClear();
    rerender(
      <MapLibreMap
        parcels={FIXTURE_PARCELS.slice(0, 1)}
        alerts={[]}
        h3Cells={H3_CELLS}
        h3Visible={false}
      />
    );

    expect(mapMocks.setLayoutProperty).toHaveBeenCalledWith(
      "h3-grid-fill",
      "visibility",
      "none"
    );
    expect(mapMocks.setLayoutProperty).toHaveBeenCalledWith(
      "h3-grid-outline",
      "visibility",
      "none"
    );
    expect(mapMocks.mapConstructor).toHaveBeenCalledOnce();
    expect(mapMocks.remove).not.toHaveBeenCalled();

    rerender(
      <MapLibreMap
        parcels={FIXTURE_PARCELS.slice(0, 1)}
        alerts={[]}
        h3Cells={UPDATED_H3_CELLS}
        h3Visible={false}
      />
    );

    expect(mapMocks.getSource).toHaveBeenCalledWith("h3-grid");
    expect(mapMocks.setH3Data).toHaveBeenCalledWith(UPDATED_H3_CELLS);
    expect(mapMocks.mapConstructor).toHaveBeenCalledOnce();
    expect(mapMocks.remove).not.toHaveBeenCalled();
  });

  it("applies H3 visibility and data changes while tiles are still streaming (isStyleLoaded false after load)", async () => {
    const { rerender } = render(
      <MapLibreMap
        parcels={FIXTURE_PARCELS.slice(0, 1)}
        alerts={[]}
        h3Cells={H3_CELLS}
        h3Visible={false}
      />
    );

    await waitFor(() => expect(mapMocks.mapConstructor).toHaveBeenCalledOnce());
    mapMocks.fireLoad();

    // Once the initial load event has fired, the H3 source/layers exist and
    // setLayoutProperty/setData are safe -- but isStyleLoaded() reports
    // false whenever sources are fetching tiles (e.g. right after a pan or
    // zoom). A toggle or resolution change in that window must not be
    // silently dropped.
    mapMocks.setStyleLoaded(false);
    mapMocks.setLayoutProperty.mockClear();

    rerender(
      <MapLibreMap
        parcels={FIXTURE_PARCELS.slice(0, 1)}
        alerts={[]}
        h3Cells={H3_CELLS}
        h3Visible
      />
    );

    expect(mapMocks.setLayoutProperty).toHaveBeenCalledWith(
      "h3-grid-fill",
      "visibility",
      "visible"
    );
    expect(mapMocks.setLayoutProperty).toHaveBeenCalledWith(
      "h3-grid-outline",
      "visibility",
      "visible"
    );

    rerender(
      <MapLibreMap
        parcels={FIXTURE_PARCELS.slice(0, 1)}
        alerts={[]}
        h3Cells={UPDATED_H3_CELLS}
        h3Visible
      />
    );

    expect(mapMocks.setH3Data).toHaveBeenCalledWith(UPDATED_H3_CELLS);
  });
});
