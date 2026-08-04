import { describe, expect, it } from "vitest";
import type { HotspotCell } from "@/lib/types";
import {
  HOTSPOT_AMBER_COLOR,
  HOTSPOT_MAX_OPACITY,
  HOTSPOT_MIN_OPACITY,
  HOTSPOT_RED_COLOR,
  hotspotFillColor,
  hotspotFillOpacity,
  hotspotsToFeatureCollection,
} from "./map-types";

const HOTSPOT: HotspotCell = {
  cell: "8842d0abcfffff",
  alert_count: 3,
  red_alerts: 1,
  total_area_m2: 1234.5,
  parcel_count: 2,
  boundary: {
    type: "Polygon",
    coordinates: [
      [
        [78.0, 29.9],
        [78.01, 29.9],
        [78.01, 29.91],
        [78.0, 29.91],
        [78.0, 29.9],
      ],
    ],
  },
};

describe("hotspotsToFeatureCollection", () => {
  it("builds a FeatureCollection carrying the boundary and styling properties", () => {
    const collection = hotspotsToFeatureCollection([HOTSPOT]);

    expect(collection).toEqual({
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: HOTSPOT.boundary,
          properties: {
            cell: "8842d0abcfffff",
            alert_count: 3,
            red_alerts: 1,
            parcel_count: 2,
          },
        },
      ],
    });
  });

  it("returns an empty feature collection for an empty input", () => {
    expect(hotspotsToFeatureCollection([])).toEqual({
      type: "FeatureCollection",
      features: [],
    });
  });

  it("preserves input order across multiple cells", () => {
    const second: HotspotCell = { ...HOTSPOT, cell: "8842d0abdfffff" };
    const collection = hotspotsToFeatureCollection([HOTSPOT, second]);
    expect(collection.features.map((f) => f.properties.cell)).toEqual([
      "8842d0abcfffff",
      "8842d0abdfffff",
    ]);
  });
});

describe("hotspotFillColor", () => {
  it("returns red when the cell has any red-tier alerts", () => {
    expect(hotspotFillColor(1)).toBe(HOTSPOT_RED_COLOR);
    expect(hotspotFillColor(5)).toBe(HOTSPOT_RED_COLOR);
  });

  it("returns amber when there are no red-tier alerts", () => {
    expect(hotspotFillColor(0)).toBe(HOTSPOT_AMBER_COLOR);
  });
});

describe("hotspotFillOpacity", () => {
  it("returns the minimum opacity at 1 alert", () => {
    expect(hotspotFillOpacity(1)).toBeCloseTo(HOTSPOT_MIN_OPACITY);
  });

  it("returns the maximum opacity at 5 alerts", () => {
    expect(hotspotFillOpacity(5)).toBeCloseTo(HOTSPOT_MAX_OPACITY);
  });

  it("clamps opacity at the maximum for more than 5 alerts", () => {
    expect(hotspotFillOpacity(12)).toBeCloseTo(HOTSPOT_MAX_OPACITY);
  });

  it("clamps opacity at the minimum below 1 alert", () => {
    expect(hotspotFillOpacity(0)).toBeCloseTo(HOTSPOT_MIN_OPACITY);
  });

  it("interpolates linearly between the floor and ceiling", () => {
    expect(hotspotFillOpacity(3)).toBeCloseTo(
      (HOTSPOT_MIN_OPACITY + HOTSPOT_MAX_OPACITY) / 2
    );
  });
});
