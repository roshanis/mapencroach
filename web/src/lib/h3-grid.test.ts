import { describe, expect, it } from "vitest";
import {
  DEFAULT_MAX_H3_CELLS,
  SUPPORTED_H3_RESOLUTIONS,
  buildH3Grid,
} from "./h3-grid";
import type { Parcel } from "./types";

type ParcelInput = Pick<Parcel, "id" | "geometry" | "centroid">;

function squareParcel(
  id: string,
  lng = 77.979,
  lat = 29.913,
  size = 0.003
): ParcelInput {
  return {
    id,
    centroid: [lng + size / 2, lat + size / 2],
    geometry: {
      type: "Polygon",
      coordinates: [
        [
          [lng, lat],
          [lng + size, lat],
          [lng + size, lat + size],
          [lng, lat + size],
          [lng, lat],
        ],
      ],
    },
  };
}

describe("buildH3Grid", () => {
  it("returns an empty FeatureCollection for no parcels", () => {
    expect(buildH3Grid([], 11)).toEqual({
      ok: true,
      featureCollection: {
        type: "FeatureCollection",
        features: [],
      },
    });
  });

  it.each(SUPPORTED_H3_RESOLUTIONS)(
    "supports resolution %i and records it on every feature",
    (resolution) => {
      const result = buildH3Grid([squareParcel("parcel-1")], resolution);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.featureCollection.features.length).toBeGreaterThan(0);
      expect(
        result.featureCollection.features.every(
          (feature) => feature.properties.resolution === resolution
        )
      ).toBe(true);
    }
  );

  it("keeps GeoJSON output in longitude/latitude order", () => {
    const result = buildH3Grid([squareParcel("parcel-1")], 11);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const coordinates = result.featureCollection.features.flatMap(
      (feature) => feature.geometry.coordinates[0] ?? []
    );
    expect(coordinates.length).toBeGreaterThan(0);
    expect(
      coordinates.every(
        ([lng, lat]) => lng > 77 && lng < 79 && lat > 29 && lat < 31
      )
    ).toBe(true);
  });

  it("renders a cell for a parcel smaller than a resolution-11 cell", () => {
    const result = buildH3Grid(
      [squareParcel("tiny-parcel", 77.979, 29.913, 0.00001)],
      11
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.featureCollection.features).toHaveLength(1);
    expect(result.featureCollection.features[0]?.properties.parcelIds).toEqual([
      "tiny-parcel",
    ]);
  });

  it("deduplicates shared cells and records all contributing parcel ids", () => {
    const geometry = squareParcel("parcel-a");
    const result = buildH3Grid(
      [geometry, { ...geometry, id: "parcel-b" }],
      11
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const indexes = result.featureCollection.features.map(
      (feature) => feature.properties.h3Index
    );
    expect(new Set(indexes).size).toBe(indexes.length);
    expect(
      result.featureCollection.features.every(
        (feature) =>
          JSON.stringify(feature.properties.parcelIds) ===
          JSON.stringify(["parcel-a", "parcel-b"])
      )
    ).toBe(true);
  });

  it("returns a UI-safe error for unsupported resolutions", () => {
    const result = buildH3Grid([squareParcel("parcel-1")], 12);

    expect(result).toMatchObject({
      ok: false,
      featureCollection: { type: "FeatureCollection", features: [] },
      error: {
        code: "UNSUPPORTED_RESOLUTION",
      },
    });
  });

  it("returns no partial cells when the configured maximum is exceeded", () => {
    const result = buildH3Grid([squareParcel("parcel-1")], 11, 1);

    expect(result).toMatchObject({
      ok: false,
      featureCollection: { type: "FeatureCollection", features: [] },
      error: {
        code: "MAX_CELLS_EXCEEDED",
      },
    });
  });

  it("uses a conservative default maximum", () => {
    expect(DEFAULT_MAX_H3_CELLS).toBeGreaterThan(0);
    expect(DEFAULT_MAX_H3_CELLS).toBeLessThanOrEqual(10_000);
  });
});
