import { MarkerClusterer, type Cluster, type Marker } from "@googlemaps/markerclusterer";
import { createAlertMarkerElement } from "./map-markers";
import type { Alert, AlertTier, Parcel } from "@/lib/types";

type AdvancedMarkerConstructor = new (options: {
  map?: google.maps.Map | null;
  position: google.maps.LatLngLiteral | google.maps.LatLng;
  content?: HTMLElement;
  title?: string;
  zIndex?: number;
}) => google.maps.marker.AdvancedMarkerElement;

export interface GoogleAlertClustersOptions {
  map: google.maps.Map;
  AdvancedMarkerElement: AdvancedMarkerConstructor;
  onAlertClick?: (alertId: string) => void;
}

export interface GoogleAlertClustersController {
  update: (parcels: Parcel[], alerts: Alert[], selectedAlertId?: string) => void;
  destroy: () => void;
}

const TIER_ORDER: AlertTier[] = ["red", "amber", "green", "legacy"];
const CLUSTER_TIER_COLORS: Record<AlertTier, string> = {
  red: "#fca5a5", amber: "#fde68a", green: "#86efac", legacy: "#d8b4fe",
};

function markerTier(marker: Marker): AlertTier | null {
  const content = (marker as google.maps.marker.AdvancedMarkerElement).content;
  const tier = content instanceof HTMLElement
    ? content.querySelector<HTMLElement>("[data-tier]")?.dataset.tier
    : undefined;
  return tier && TIER_ORDER.includes(tier as AlertTier) ? (tier as AlertTier) : null;
}

function createClusterRenderer(AdvancedMarkerElement: AdvancedMarkerConstructor, map: google.maps.Map) {
  return {
    render(cluster: Cluster) {
      const { count, position, markers } = cluster;
      const counts = new Map<AlertTier, number>();
      for (const marker of markers) {
        const tier = markerTier(marker);
        if (tier) counts.set(tier, (counts.get(tier) ?? 0) + 1);
      }
      const details = TIER_ORDER
        .filter((tier) => counts.has(tier))
        .map((tier) => `${counts.get(tier)} ${tier}`)
        .join(", ");
      const label = `${count} alerts${details ? `: ${details}` : ""}`;

      const button = document.createElement("button");
      button.type = "button";
      button.title = label;
      button.setAttribute("aria-label", label);
      button.style.minWidth = "48px";
      button.style.minHeight = "48px";
      button.style.padding = "4px 8px";
      button.style.borderRadius = "12px";
      button.style.border = "3px solid white";
      button.style.backgroundColor = "#1e293b";
      button.style.color = "white";
      button.style.fontSize = "13px";
      button.style.fontWeight = "700";
      button.style.cursor = "pointer";
      button.style.boxShadow = "0 1px 5px rgba(15,23,42,0.55)";
      button.textContent = String(count);
      // Keep native button keyboard activation independent of the SDK's
      // gmp-click event bridge. The SDK callback below deliberately does not
      // zoom again if Google also emits an event for this click.
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        if (cluster.bounds) map.fitBounds(cluster.bounds);
      });

      const countsRow = document.createElement("span");
      countsRow.setAttribute("aria-hidden", "true");
      countsRow.style.display = "flex";
      countsRow.style.justifyContent = "center";
      countsRow.style.gap = "2px";
      for (const tier of TIER_ORDER) {
        const tierCount = counts.get(tier);
        if (!tierCount) continue;
        const countBadge = document.createElement("span");
        countBadge.textContent = `${tier[0].toUpperCase()}${tierCount}`;
        countBadge.style.color = CLUSTER_TIER_COLORS[tier];
        countBadge.style.fontSize = "11px";
        countBadge.style.lineHeight = "1";
        countsRow.appendChild(countBadge);
      }
      button.appendChild(countsRow);

      const wrapper = document.createElement("div");
      wrapper.setAttribute("data-testid", "alert-cluster-wrapper");
      wrapper.appendChild(button);
      return new AdvancedMarkerElement({ content: wrapper, position, zIndex: 50 });
    },
  };
}

export function createGoogleAlertClusters({
  map,
  AdvancedMarkerElement,
  onAlertClick,
}: GoogleAlertClustersOptions): GoogleAlertClustersController {
  let clusterer: MarkerClusterer | null = null;
  const records = new Map<string, {
    marker: google.maps.marker.AdvancedMarkerElement;
    signature: string;
    setSelected: (selected: boolean) => void;
  }>();
  let destroyed = false;

  function ensureClusterer() {
    if (clusterer) return clusterer;
    clusterer = new MarkerClusterer({
      map,
      markers: [],
      renderer: createClusterRenderer(AdvancedMarkerElement, map),
      onClusterClick: () => {},
    });
    return clusterer;
  }

  function update(parcels: Parcel[], alerts: Alert[], selectedAlertId?: string) {
    if (destroyed) return;
    const parcelById = new Map(parcels.map((parcel) => [parcel.id, parcel]));
    const clusterMarkers: google.maps.marker.AdvancedMarkerElement[] = [];
    const nextIds = new Set<string>();

    // Batch replacements: an intermediate empty render detaches focused
    // singleton markers, even when their data has not changed.
    if (clusterer) clusterer.clearMarkers(true);

    for (const alert of alerts) {
      const parcel = parcelById.get(alert.parcel_id);
      if (!parcel) continue;
      nextIds.add(alert.id);
      const signature = JSON.stringify([alert.tier, alert.severity_score, parcel.survey_no, parcel.centroid]);
      let record = records.get(alert.id);
      if (!record || record.signature !== signature) {
        if (record) record.marker.map = null;
        const { wrapper, setSelected } = createAlertMarkerElement({
          alert,
          parcelLabel: parcel.survey_no,
          selected: false,
          onClick: onAlertClick,
        });
        record = {
          marker: new AdvancedMarkerElement({
            map: null,
            position: { lat: parcel.centroid[1], lng: parcel.centroid[0] },
            content: wrapper,
            title: `Alert ${alert.id}`,
          }),
          signature,
          setSelected,
        };
        records.set(alert.id, record);
      }
      const selected = alert.id === selectedAlertId;
      record.setSelected(selected);
      record.marker.zIndex = selected ? 1000 : 100;
      if (!selected) clusterMarkers.push(record.marker);
    }

    for (const [id, record] of records) {
      if (!nextIds.has(id)) {
        record.marker.map = null;
        records.delete(id);
      }
    }
    const activeClusterer = ensureClusterer();
    activeClusterer.addMarkers(clusterMarkers, true);
    activeClusterer.render();
    const selectedRecord = selectedAlertId ? records.get(selectedAlertId) : undefined;
    if (selectedRecord) selectedRecord.marker.map = map;
  }

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    clusterer?.setMap(null);
    clusterer?.clearMarkers(true);
    for (const record of records.values()) record.marker.map = null;
    records.clear();
    clusterer = null;
  }

  return { update, destroy };
}
