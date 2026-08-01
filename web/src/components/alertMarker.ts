// Shared alert-marker styling and DOM construction for the two map
// providers (GoogleMap and MapLibreMap). Both providers hand a plain DOM
// element to their respective marker APIs (google.maps.marker.
// AdvancedMarkerElement's `content` and maplibregl.Marker's `element`), so
// the same imperative button element works for both — this used to be
// copy-pasted verbatim in each provider file.

import type { Alert, AlertTier } from "@/lib/types";

export const TIER_COLORS: Record<AlertTier, string> = {
  green: "#1e8f4e",
  amber: "#c98a12",
  red: "#c4321f",
  legacy: "#7b3fa0",
};

export function styleAlertMarker(element: HTMLButtonElement, selected: boolean) {
  element.dataset.selected = String(selected);
  element.style.transform = selected ? "scale(1.45)" : "scale(1)";
  element.style.boxShadow = selected
    ? "0 0 0 4px rgba(255,255,255,0.9), 0 0 0 7px rgba(28,79,140,0.65)"
    : "0 0 0 1px rgba(0,0,0,0.25)";
}

/** Builds the marker button element for one alert, already styled for its
 * initial selected state. */
export function createAlertMarkerElement(
  alert: Alert,
  selected: boolean
): HTMLButtonElement {
  const element = document.createElement("button");
  element.type = "button";
  element.style.width = "14px";
  element.style.height = "14px";
  element.style.borderRadius = "50%";
  element.style.border = "2px solid white";
  element.style.backgroundColor = TIER_COLORS[alert.tier];
  element.style.cursor = "pointer";
  element.style.padding = "0";
  element.style.transition = "transform 150ms ease, box-shadow 150ms ease";
  element.setAttribute("data-testid", "alert-marker");
  element.setAttribute("data-alert-id", alert.id);
  element.setAttribute("aria-label", `Select alert ${alert.id}`);
  styleAlertMarker(element, selected);
  return element;
}
