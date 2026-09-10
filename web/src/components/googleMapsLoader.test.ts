import { beforeEach, describe, expect, it, vi } from "vitest";

const loader = vi.hoisted(() => ({ importLibrary: vi.fn(), setOptions: vi.fn() }));
vi.mock("@googlemaps/js-api-loader", () => loader);

describe("loadGooglePlacesLibrary", () => {
  beforeEach(() => {
    vi.resetModules();
    loader.importLibrary.mockReset();
    loader.setOptions.mockReset();
  });

  it("loads only Places and reuses the configured key", async () => {
    const PlaceAutocompleteElement = vi.fn();
    loader.importLibrary.mockResolvedValue({ PlaceAutocompleteElement });
    const { loadGooglePlacesLibrary } = await import("./googleMapsLoader");
    await expect(loadGooglePlacesLibrary("places-key")).resolves.toEqual({ PlaceAutocompleteElement });
    expect(loader.setOptions).toHaveBeenCalledWith({ key: "places-key", v: "weekly", authReferrerPolicy: "origin" });
    expect(loader.importLibrary).toHaveBeenCalledWith("places");
    expect(loader.importLibrary).toHaveBeenCalledOnce();
    await loadGooglePlacesLibrary("places-key");
    expect(loader.setOptions).toHaveBeenCalledOnce();
  });

  it("rejects a different key after Maps has been configured", async () => {
    loader.importLibrary.mockResolvedValue({});
    const { loadGoogleMapLibraries, loadGooglePlacesLibrary } = await import("./googleMapsLoader");
    await loadGoogleMapLibraries("places-key");
    await expect(loadGooglePlacesLibrary("another-key")).rejects.toThrow("Google Maps was initialized with a different API key.");
  });
});
