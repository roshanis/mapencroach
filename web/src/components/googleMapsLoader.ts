import { importLibrary, setOptions } from "@googlemaps/js-api-loader";

let configuredKey: string | undefined;
const authFailureListeners = new Set<() => void>();
let authFailureHookInstalled = false;

declare global {
  interface Window {
    // Called by the Google Maps JS runtime itself — not by our loader code —
    // when the API key is invalid, referrer-restricted, or billing-disabled.
    // Unlike a bad network request, the script still loads and importLibrary()
    // still resolves in this case, so it is the only signal available for
    // this failure mode. See:
    // https://developers.google.com/maps/documentation/javascript/events#auth-errors
    gm_authFailure?: () => void;
  }
}

function installAuthFailureHook() {
  if (authFailureHookInstalled || typeof window === "undefined") return;
  authFailureHookInstalled = true;
  window.gm_authFailure = () => {
    authFailureListeners.forEach((listener) => listener());
  };
}

/**
 * Subscribes to Google's `gm_authFailure` signal (invalid key, referrer
 * restriction, disabled billing — anything that resolves script load but
 * leaves the map unusable). Returns an unsubscribe function.
 */
export function onGoogleMapsAuthFailure(listener: () => void): () => void {
  installAuthFailureHook();
  authFailureListeners.add(listener);
  return () => {
    authFailureListeners.delete(listener);
  };
}

export async function loadGoogleMapLibraries(apiKey: string) {
  installAuthFailureHook();

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
