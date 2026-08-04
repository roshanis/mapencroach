import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FIXTURE_ALERTS, FIXTURE_PARCELS } from "@/lib/fixtures";
import MapLibreMap from "./MapLibreMap";

const mapConstructor = vi.fn();
const addSource = vi.fn();
const addLayer = vi.fn();
const setLayoutProperty = vi.fn();
const disableRotation = vi.fn();
const flyTo = vi.fn();
const removeMap = vi.fn();
const markerConstructor = vi.fn();
const markerSetLngLat = vi.fn();
const markerAddTo = vi.fn();
const markerRemove = vi.fn();

let loadCallback: (() => void) | undefined;

class FakeMap {
  touchZoomRotate = { disableRotation };

  constructor(options: unknown) {
    mapConstructor(options);
  }

  on(event: string, callback: () => void) {
    if (event === "load") loadCallback = callback;
  }

  addSource(...args: unknown[]) {
    addSource(...args);
  }

  addLayer(...args: unknown[]) {
    addLayer(...args);
  }

  setLayoutProperty(...args: unknown[]) {
    setLayoutProperty(...args);
  }

  flyTo(...args: unknown[]) {
    flyTo(...args);
  }

  remove() {
    removeMap();
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

vi.mock("maplibre-gl", () => ({
  default: {
    Map: FakeMap,
    Marker: FakeMarker,
  },
}));

describe("MapLibreMap", () => {
  beforeEach(() => {
    loadCallback = undefined;
  });

  afterEach(() => {
    vi.clearAllMocks();
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

    await waitFor(() => expect(mapConstructor).toHaveBeenCalledOnce());

    // A flat parcel map with no compass/reset control must not let a
    // two-finger touch twist (or desktop right-drag) rotate it away from
    // north with no way back — pinch-zoom and pan stay on.
    expect(mapConstructor).toHaveBeenCalledWith(
      expect.objectContaining({
        center: [78.03, 29.92],
        zoom: 11,
        dragRotate: false,
        touchPitch: false,
      })
    );
    expect(disableRotation).toHaveBeenCalledOnce();

    await waitFor(() => expect(loadCallback).toBeInstanceOf(Function));
    act(() => {
      loadCallback?.();
    });

    expect(addSource).toHaveBeenCalledWith(
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
    expect(addLayer).toHaveBeenCalledWith(
      expect.objectContaining({ id: "parcel-fill", source: "parcels" })
    );
    expect(addLayer).toHaveBeenCalledWith(
      expect.objectContaining({ id: "parcel-outline", source: "parcels" })
    );

    expect(markerConstructor).toHaveBeenCalledOnce();
    const markerElement = markerConstructor.mock.calls[0][0] as HTMLElement;
    expect(markerElement).toHaveAttribute(
      "aria-label",
      `Select alert ${FIXTURE_ALERTS[0].id}`
    );
    expect(markerElement).toHaveAttribute("data-selected", "true");
    markerElement.click();
    expect(onAlertClick).toHaveBeenCalledWith(FIXTURE_ALERTS[0].id);

    expect(onReady).toHaveBeenCalledOnce();
    onReady.mock.calls[0][0].panTo([77.99, 29.91]);
    expect(flyTo).toHaveBeenCalledWith({ center: [77.99, 29.91], zoom: 15 });

    fireEvent.click(screen.getByTestId("basemap-streets"));
    expect(setLayoutProperty).toHaveBeenCalledWith(
      "esri-base",
      "visibility",
      "none"
    );
    expect(setLayoutProperty).toHaveBeenCalledWith(
      "osm-base",
      "visibility",
      "visible"
    );

    fireEvent.click(screen.getByTestId("basemap-satellite"));
    expect(setLayoutProperty).toHaveBeenCalledWith(
      "esri-base",
      "visibility",
      "visible"
    );

    unmount();
    expect(markerRemove).toHaveBeenCalledOnce();
    expect(removeMap).toHaveBeenCalledOnce();
  });

  it("skips alerts that have no matching parcel instead of crashing", async () => {
    const orphanAlert = {
      ...FIXTURE_ALERTS[0],
      id: "orphan-alert",
      parcel_id: "no-such-parcel",
    };

    render(<MapLibreMap parcels={[]} alerts={[orphanAlert]} />);

    await waitFor(() => expect(loadCallback).toBeInstanceOf(Function));
    act(() => {
      loadCallback?.();
    });

    expect(markerConstructor).not.toHaveBeenCalled();
  });
});
