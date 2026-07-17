import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FIXTURE_ALERTS, FIXTURE_PARCELS } from "@/lib/fixtures";
import MapProviderMap from "./MapProviderMap";

vi.mock("./GoogleMap", () => ({
  default: ({
    apiKey,
    mapId,
    onProviderError,
    selectedAlertId,
  }: {
    apiKey: string;
    mapId: string;
    onProviderError: () => void;
    selectedAlertId?: string;
  }) => (
    <button
      type="button"
      data-testid="google-map-provider"
      data-api-key={apiKey}
      data-map-id={mapId}
      data-selected-alert-id={selectedAlertId}
      onClick={onProviderError}
    >
      Google map
    </button>
  ),
}));

vi.mock("./MapLibreMap", () => ({
  default: ({ selectedAlertId }: { selectedAlertId?: string }) => (
    <div
      data-testid="maplibre-map-provider"
      data-selected-alert-id={selectedAlertId}
    />
  ),
}));

const mapProps = {
  parcels: FIXTURE_PARCELS,
  alerts: FIXTURE_ALERTS,
  selectedAlertId: FIXTURE_ALERTS[0].id,
};

describe("MapProviderMap", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("uses Google Maps when both deployment values are configured", () => {
    vi.stubEnv("NEXT_PUBLIC_GOOGLE_MAPS_API_KEY", "restricted-browser-key");
    vi.stubEnv("NEXT_PUBLIC_GOOGLE_MAP_ID", "map-id");

    render(<MapProviderMap {...mapProps} />);

    const googleMap = screen.getByTestId("google-map-provider");
    expect(googleMap).toHaveAttribute("data-api-key", "restricted-browser-key");
    expect(googleMap).toHaveAttribute("data-map-id", "map-id");
    expect(googleMap).toHaveAttribute(
      "data-selected-alert-id",
      FIXTURE_ALERTS[0].id
    );
    expect(screen.queryByTestId("maplibre-map-provider")).not.toBeInTheDocument();
  });

  it.each([
    ["API key", "", "map-id"],
    ["map ID", "restricted-browser-key", ""],
  ])("uses an honest fallback when the %s is missing", (_label, apiKey, mapId) => {
    vi.stubEnv("NEXT_PUBLIC_GOOGLE_MAPS_API_KEY", apiKey);
    vi.stubEnv("NEXT_PUBLIC_GOOGLE_MAP_ID", mapId);

    render(<MapProviderMap {...mapProps} />);

    expect(screen.getByTestId("maplibre-map-provider")).toBeInTheDocument();
    expect(
      screen.getByText("Google Maps is not configured. Showing the fallback map.")
    ).toBeInTheDocument();
  });

  it("falls back without losing selection when Google Maps cannot load", () => {
    vi.stubEnv("NEXT_PUBLIC_GOOGLE_MAPS_API_KEY", "restricted-browser-key");
    vi.stubEnv("NEXT_PUBLIC_GOOGLE_MAP_ID", "map-id");
    render(<MapProviderMap {...mapProps} />);

    fireEvent.click(screen.getByTestId("google-map-provider"));

    expect(screen.getByTestId("maplibre-map-provider")).toHaveAttribute(
      "data-selected-alert-id",
      FIXTURE_ALERTS[0].id
    );
    expect(
      screen.getByText("Google Maps could not load. Showing the fallback map.")
    ).toBeInTheDocument();
  });
});
