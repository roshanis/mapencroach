// Builds a deduplicated H3 analytical grid (GeoJSON FeatureCollection) from a
// set of parcel geometries. The grid is screening context only — never an
// authoritative parcel boundary — so failures degrade to an explicit,
// UI-safe error rather than throwing or emitting partial output.

import { cellToBoundary, latLngToCell, polygonToCells } from "h3-js";
import type { H3CellProperties, H3FeatureCollection } from "@/components/map-types";
import type { Parcel } from "./types";

/** Resolutions the console's H3 grid control exposes to users. */
export const SUPPORTED_H3_RESOLUTIONS = [9, 10, 11] as const;

export type SupportedH3Resolution = (typeof SUPPORTED_H3_RESOLUTIONS)[number];

/**
 * Conservative ceiling on the number of unique cells a single grid build may
 * produce. Guards against pathological inputs (large jurisdictions at fine
 * resolutions) rendering an unbounded number of map features.
 */
export const DEFAULT_MAX_H3_CELLS = 4_000;

export type H3GridParcel = Pick<Parcel, "id" | "geometry" | "centroid">;

export interface H3GridError {
  code: "UNSUPPORTED_RESOLUTION" | "MAX_CELLS_EXCEEDED";
  message: string;
}

export type H3GridResult =
  | { ok: true; featureCollection: H3FeatureCollection }
  | { ok: false; featureCollection: H3FeatureCollection; error: H3GridError };

const EMPTY_FEATURE_COLLECTION: H3FeatureCollection = {
  type: "FeatureCollection",
  features: [],
};

function isSupportedResolution(
  resolution: number
): resolution is SupportedH3Resolution {
  return (SUPPORTED_H3_RESOLUTIONS as readonly number[]).includes(resolution);
}

function errorResult(code: H3GridError["code"], message: string): H3GridResult {
  return {
    ok: false,
    featureCollection: EMPTY_FEATURE_COLLECTION,
    error: { code, message },
  };
}

/**
 * Resolves the H3 cells covering a single parcel's polygon. `polygonToCells`
 * uses center-containment: a parcel smaller than one cell at the chosen
 * resolution can yield zero cells even though it clearly occupies space, so
 * fall back to the cell containing the parcel's centroid.
 */
function cellsForParcel(
  parcel: H3GridParcel,
  resolution: SupportedH3Resolution
): string[] {
  const cells = polygonToCells(parcel.geometry.coordinates, resolution, true);
  if (cells.length > 0) return cells;

  const [lng, lat] = parcel.centroid;
  return [latLngToCell(lat, lng, resolution)];
}

/**
 * Builds an H3 analytical grid covering the given parcels at the requested
 * resolution. Cells are deduplicated across parcels; each feature records
 * every contributing parcel id in first-encountered order.
 *
 * Returns a discriminated union rather than throwing: an unsupported
 * resolution or a cell count above `maxCells` produces an `ok: false` result
 * with an empty feature collection and a user-readable error message, never
 * partial output.
 */
export function buildH3Grid(
  parcels: readonly H3GridParcel[],
  resolution: number,
  maxCells: number = DEFAULT_MAX_H3_CELLS
): H3GridResult {
  if (!isSupportedResolution(resolution)) {
    return errorResult(
      "UNSUPPORTED_RESOLUTION",
      `H3 resolution ${resolution} is unsupported. Choose resolution 9, 10, or 11.`
    );
  }

  const parcelIdsByCell = new Map<string, string[]>();

  for (const parcel of parcels) {
    for (const h3Index of cellsForParcel(parcel, resolution)) {
      const contributors = parcelIdsByCell.get(h3Index);
      if (contributors) {
        if (!contributors.includes(parcel.id)) contributors.push(parcel.id);
      } else {
        parcelIdsByCell.set(h3Index, [parcel.id]);
      }

      if (parcelIdsByCell.size > maxCells) {
        return errorResult(
          "MAX_CELLS_EXCEEDED",
          `H3 grid exceeds the ${maxCells.toLocaleString()}-cell safety limit. Lower the resolution or load fewer parcels.`
        );
      }
    }
  }

  const features: H3FeatureCollection["features"] = Array.from(
    parcelIdsByCell.entries()
  ).map(([h3Index, parcelIds]) => {
    const properties: H3CellProperties = { h3Index, resolution, parcelIds };
    return {
      type: "Feature",
      properties,
      geometry: {
        type: "Polygon",
        coordinates: [cellToBoundary(h3Index, true)],
      },
    };
  });

  return {
    ok: true,
    featureCollection: { type: "FeatureCollection", features },
  };
}
