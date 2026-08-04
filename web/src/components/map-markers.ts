// Shared alert-marker DOM factory for MapLibreMap and GoogleMap.
//
// Both map providers used to build their own <button> marker element and let
// the map SDK's own positioning code write `transform: translate(...)` onto
// that SAME element that our own selection styling wrote `transform:
// scale(...)` onto -- whichever wrote last won, so selecting an alert either
// teleported the marker or silently lost its selection highlight. MapLibre
// also unconditionally overwrites the marker element's aria-label with "Map
// marker", clobbering any label we set.
//
// The fix: the map SDK is only ever given the OUTER `wrapper` div. The
// visible, interactive `button` lives inside it. The SDK's positioning code
// only ever touches the wrapper's transform/position; our own selection
// styling (`setSelected`) only ever touches the button's transform/box-shadow
// and never the wrapper's, so the two can never collide, and the button's
// aria-label is never touched by the map SDK.
import { TIER_COLORS, type Alert, type AlertTier, type Parcel } from "@/lib/types";

const TIER_LABELS: Record<AlertTier, string> = {
  red: "Red",
  amber: "Amber",
  green: "Green",
  legacy: "Legacy",
};

const UNSELECTED_BOX_SHADOW =
  "0 0 0 1px rgba(15,23,42,0.4), 0 1px 4px rgba(15,23,42,0.45)";
const SELECTED_BOX_SHADOW =
  "0 0 0 3px rgba(255,255,255,0.95), 0 0 0 6px rgba(28,79,140,0.75), 0 3px 8px rgba(15,23,42,0.5)";

export type AlertMarkerInput = Pick<Alert, "id" | "tier" | "severity_score">;

export interface CreateAlertMarkerElementOptions {
  alert: AlertMarkerInput;
  /** Human-readable parcel identifier (e.g. survey_no) for the aria-label. */
  parcelLabel: string;
  selected?: boolean;
  onClick?: (alertId: string) => void;
}

export interface AlertMarkerElement {
  /** Outer element to hand to the map SDK (MapLibre Marker / AdvancedMarkerElement content). */
  wrapper: HTMLDivElement;
  /** Inner interactive element; owns its own aria-label and selection styling. */
  button: HTMLButtonElement;
  /** Toggles selection scaling/ring on the button only -- never touches wrapper.style.transform. */
  setSelected: (selected: boolean) => void;
}

export function createAlertMarkerElement({
  alert,
  parcelLabel,
  selected = false,
  onClick,
}: CreateAlertMarkerElementOptions): AlertMarkerElement {
  const roundedSeverity = Math.round(alert.severity_score);
  const tierLabel = TIER_LABELS[alert.tier];

  const wrapper = document.createElement("div");
  wrapper.setAttribute("data-testid", "alert-marker-wrapper");
  wrapper.setAttribute("data-alert-id", alert.id);
  if (alert.tier === "red") {
    wrapper.classList.add("alert-marker-pulse");
  }

  const button = document.createElement("button");
  button.type = "button";
  button.textContent = String(roundedSeverity);
  button.setAttribute("data-testid", "alert-marker");
  button.setAttribute("data-alert-id", alert.id);
  button.setAttribute("data-tier", alert.tier);
  button.setAttribute(
    "aria-label",
    `${tierLabel} alert ${alert.id}, severity ${roundedSeverity}, parcel ${parcelLabel}`
  );

  button.style.width = "26px";
  button.style.height = "26px";
  button.style.borderRadius = "50%";
  button.style.border = "2px solid white";
  button.style.backgroundColor = TIER_COLORS[alert.tier];
  button.style.color = "#ffffff";
  button.style.fontSize = "11px";
  button.style.fontWeight = "700";
  button.style.lineHeight = "1";
  button.style.display = "flex";
  button.style.alignItems = "center";
  button.style.justifyContent = "center";
  button.style.padding = "0";
  button.style.margin = "0";
  button.style.cursor = "pointer";
  button.style.transformOrigin = "center";
  button.style.transition = "transform 150ms ease, box-shadow 150ms ease";

  if (onClick) {
    button.addEventListener("click", () => onClick(alert.id));
  }

  function setSelected(isSelected: boolean) {
    button.dataset.selected = String(isSelected);
    button.style.transform = isSelected ? "scale(1.35)" : "scale(1)";
    button.style.boxShadow = isSelected
      ? SELECTED_BOX_SHADOW
      : UNSELECTED_BOX_SHADOW;
  }

  setSelected(selected);
  wrapper.appendChild(button);

  return { wrapper, button, setSelected };
}

/** Flattens every [lng, lat] vertex across a set of parcel polygons, for camera fitting. */
export function collectParcelVertices(parcels: Parcel[]): [number, number][] {
  const vertices: [number, number][] = [];
  for (const parcel of parcels) {
    for (const ring of parcel.geometry.coordinates) {
      for (const position of ring) {
        vertices.push([position[0], position[1]]);
      }
    }
  }
  return vertices;
}
