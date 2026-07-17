import { importLibrary, setOptions } from "@googlemaps/js-api-loader";

let configuredKey: string | undefined;

export async function loadGoogleMapLibraries(apiKey: string) {
  if (!configuredKey) {
    setOptions({
      key: apiKey,
      v: "weekly",
      authReferrerPolicy: "origin",
    });
    configuredKey = apiKey;
  } else if (configuredKey !== apiKey) {
    throw new Error("Google Maps was initialized with a different API key.");
  }

  const [mapsLibrary, markerLibrary] = await Promise.all([
    importLibrary("maps"),
    importLibrary("marker"),
  ]);

  return {
    Map: mapsLibrary.Map,
    AdvancedMarkerElement: markerLibrary.AdvancedMarkerElement,
  };
}
