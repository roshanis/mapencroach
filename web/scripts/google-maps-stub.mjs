// Browser-only Google Maps Platform stub for maps-smoke.mjs.
// It intentionally implements the small SDK boundary used by this app; no
// Google network request or live Places/Maps result is involved.
export const GOOGLE_MAPS_STUB = String.raw`
(() => {
  const state = window.__mapencroachGoogleStub = { maps: [], imports: [], places: [], failPlacesOnce: false };
  const listeners = new WeakMap();
  const NativeMap = globalThis.Map;
  const on = (target, name, fn) => {
    if (!listeners.has(target)) listeners.set(target, new NativeMap());
    const byName = listeners.get(target);
    if (!byName.has(name)) byName.set(name, new Set());
    byName.get(name).add(fn);
    return { remove: () => byName.get(name)?.delete(fn) };
  };
  const trigger = (target, name, value) => listeners.get(target)?.get(name)?.forEach((fn) => fn(value));
  class LatLng {
    constructor(lat, lng) { this._lat = lat; this._lng = lng; }
    lat() { return this._lat; }
    lng() { return this._lng; }
  }
  class LatLngBounds {
    constructor() { this.points = []; }
    extend(point) { this.points.push(point); return this; }
    getNorthEast() { const p = this.points.at(-1) || { lat: 0, lng: 0 }; return new LatLng(typeof p.lat === "function" ? p.lat() : p.lat, typeof p.lng === "function" ? p.lng() : p.lng); }
    getSouthWest() { const p = this.points[0] || { lat: 0, lng: 0 }; return new LatLng(typeof p.lat === "function" ? p.lat() : p.lat, typeof p.lng === "function" ? p.lng() : p.lng); }
  }
  class Data {
    constructor() { this.features = []; }
    addGeoJson(geojson) { this.features.push(...(geojson.features || [geojson])); return this.features; }
    forEach(fn) { this.features.forEach(fn); }
    remove(feature) { this.features = this.features.filter((candidate) => candidate !== feature); }
    setStyle(style) { this.style = style; }
    setMap(map) { this.map = map; }
  }
  class GoogleMap {
    constructor(container, options) {
      this.container = container; this.options = options; this.center = options.center; this.zoom = options.zoom;
      this.data = new Data(); this.panCalls = []; this.fitCalls = [];
      container.dataset.googleMapsStub = "true"; state.maps.push(this);
      container.style.background = "#dbeafe"; container.style.position = "relative";
    }
    panTo(center) { this.center = center; this.panCalls.push(center); }
    setZoom(zoom) { this.zoom = zoom; }
    fitBounds(bounds, padding) { this.fitCalls.push({ bounds, padding }); }
    setMapTypeId(value) { this.options.mapTypeId = value; }
    getCenter() { return this.center; }
    getZoom() { return this.zoom; }
    addListener(name, fn) { return on(this, name, fn); }
    getProjection() { return { fromLatLngToDivPixel: (p) => ({ x: p.lng?.() ?? p.lng ?? 0, y: p.lat?.() ?? p.lat ?? 0 }) }; }
    getBounds() { return { getNorthEast: () => new LatLng(90, 180), getSouthWest: () => new LatLng(-90, -180) }; }
    getMapCapabilities() { return { isAdvancedMarkersAvailable: true }; }
  }
  class OverlayView {
    setMap(map) {
      if (this._overlayMap && this.onRemove) this.onRemove();
      this._overlayMap = map || null;
      if (this._overlayMap && this.onAdd) this.onAdd();
    }
    getMap() { return this._overlayMap || null; }
    getProjection() { return this.getMap()?.getProjection?.() || { fromLatLngToDivPixel: () => ({ x: 0, y: 0 }) }; }
  }
  // markerclusterer copies enumerable OverlayView prototype methods (matching
  // the browser SDK's legacy OverlayView shape), so expose these methods with
  // the same property semantics rather than relying on class defaults.
  for (const name of ["setMap", "getMap", "getProjection"]) {
    Object.defineProperty(OverlayView.prototype, name, { enumerable: true });
  }
  class AdvancedMarkerElement {
    constructor(options) {
      this.content = options.content; this.position = options.position; this.title = options.title;
      this.element = options.content;
      const slot = (state.markers || []).length;
      // Simulate the SDK's positioning wrapper with distinct hit areas. A
      // normal-flow div would cover other markers across the entire map row.
      // These grid positions are synthetic, not a geographic projection.
      if (this.content) Object.assign(this.content.style, {
        position: "absolute", width: "max-content",
        left: (15 + (slot % 3) * 25) + "%", top: (30 + (Math.floor(slot / 3) % 2) * 35) + "%",
      });
      state.markers = (state.markers || []).concat(this);
      this.map = options.map;
    }
    set map(value) { if (!value && this.content?.isConnected) this.content.remove(); this._map = value; if (value && this.content && !this.content.isConnected) value.container.append(this.content); }
    get map() { return this._map; }
    addListener(name, fn) { return on(this, name, fn); }
  }
  class PlaceAutocompleteElement extends HTMLElement {
    constructor() {
      super(); this.className = "google-maps-stub-place-autocomplete"; this.setAttribute("data-google-maps-stub", "true");
      this.style.display = "block"; this.style.width = "100%"; this.style.minHeight = "44px";
      const input = document.createElement("input"); input.type = "search"; input.setAttribute("aria-label", "Search for an address or place"); input.placeholder = "Synthetic location search"; input.style.width = "100%"; input.style.minHeight = "44px"; input.style.boxSizing = "border-box";
      const footer = document.createElement("small"); footer.textContent = "Stubbed Google Places result"; footer.style.display = "block"; footer.style.color = "#334155";
      this.append(input, footer); state.places.push(this);
    }
  }
  if (!customElements.get("gmp-place-autocomplete")) customElements.define("gmp-place-autocomplete", PlaceAutocompleteElement);
  window.google = { maps: {
    Map: GoogleMap, Data, LatLng, LatLngBounds, OverlayView, event: { addListener: on, trigger, removeListener: (handle) => handle?.remove?.() },
    marker: { AdvancedMarkerElement },
    places: { PlaceAutocompleteElement },
    importLibrary: async (name) => {
      state.imports.push(name);
      if (name === "places" && state.failPlacesOnce) { state.failPlacesOnce = false; throw new Error("stub Places unavailable"); }
      if (name === "maps") return { Map: GoogleMap, Data, LatLng, LatLngBounds, OverlayView };
      if (name === "marker") return { AdvancedMarkerElement };
      if (name === "places") return { PlaceAutocompleteElement };
      return {};
    },
  }};
  window.__emitGooglePlace = (lat = 29.92, lng = 78.03) => {
    const element = state.places.at(-1);
    if (!element) throw new Error("No stub PlaceAutocompleteElement is mounted");
    const placePrediction = { toPlace: () => ({ fetchFields: async () => undefined, location: { lat: () => lat, lng: () => lng } }) };
    element.dispatchEvent(new CustomEvent("gmp-select", { detail: { placePrediction } }));
  };
  window.__emitGooglePlaceError = () => state.places.at(-1)?.dispatchEvent(new Event("gmp-error"));
})();
`;
