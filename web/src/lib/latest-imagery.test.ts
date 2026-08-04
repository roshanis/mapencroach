import { describe, expect, it } from "vitest";
import {
  LATEST_MAX_OFFSET_DAYS,
  LATEST_START_OFFSET_DAYS,
  isMostlyBlank,
  isoDateDaysAgo,
} from "./latest-imagery";

function rgbaBuffer(
  pixels: number,
  fill: [number, number, number, number]
): Uint8ClampedArray {
  const data = new Uint8ClampedArray(pixels * 4);
  for (let i = 0; i < pixels; i += 1) {
    data.set(fill, i * 4);
  }
  return data;
}

describe("isoDateDaysAgo", () => {
  it("formats an ISO date the requested number of days back", () => {
    const now = new Date("2026-08-04T12:00:00Z");
    expect(isoDateDaysAgo(0, now)).toBe("2026-08-04");
    expect(isoDateDaysAgo(4, now)).toBe("2026-07-31");
    expect(isoDateDaysAgo(35, now)).toBe("2026-06-30");
  });

  it("search window constants are sane", () => {
    expect(LATEST_START_OFFSET_DAYS).toBeGreaterThan(0);
    expect(LATEST_MAX_OFFSET_DAYS).toBeGreaterThan(LATEST_START_OFFSET_DAYS);
  });
});

describe("isMostlyBlank", () => {
  it("treats fully transparent pixels as blank (GIBS no-data over PNG)", () => {
    expect(isMostlyBlank(rgbaBuffer(100, [0, 0, 0, 0]))).toBe(true);
  });

  it("treats opaque black pixels as blank (GIBS no-data over JPEG)", () => {
    expect(isMostlyBlank(rgbaBuffer(100, [2, 2, 2, 255]))).toBe(true);
  });

  it("treats real imagery as not blank", () => {
    expect(isMostlyBlank(rgbaBuffer(100, [96, 110, 84, 255]))).toBe(false);
  });

  it("a sliver of real pixels below the threshold is still blank", () => {
    const data = rgbaBuffer(100, [0, 0, 0, 0]);
    data.set([120, 130, 90, 255], 0); // 1% usable < 2% threshold
    expect(isMostlyBlank(data)).toBe(true);
  });

  it("an empty buffer is blank", () => {
    expect(isMostlyBlank(new Uint8ClampedArray(0))).toBe(true);
  });
});
