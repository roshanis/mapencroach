import { describe, expect, it } from "vitest";
import {
  LATEST_MAX_OFFSET_DAYS,
  LATEST_START_OFFSET_DAYS,
  isMostlyBlank,
  isoDateDaysAgo,
  isoDayBefore,
  monthlyScenes,
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

describe("isoDayBefore", () => {
  it("steps one day back, across month and year boundaries", () => {
    expect(isoDayBefore("2026-08-04")).toBe("2026-08-03");
    expect(isoDayBefore("2026-08-01")).toBe("2026-07-31");
    expect(isoDayBefore("2026-03-01")).toBe("2026-02-28");
    expect(isoDayBefore("2026-01-01")).toBe("2025-12-31");
  });
});

describe("monthlyScenes", () => {
  it("yields one scene per completed month of the current year, plus Latest", () => {
    const now = new Date("2026-08-04T12:00:00Z");
    const scenes = monthlyScenes(now);
    expect(scenes.map((scene) => scene.id)).toEqual([
      "2026-01",
      "2026-02",
      "2026-03",
      "2026-04",
      "2026-05",
      "2026-06",
      "2026-07",
      "latest",
    ]);
    expect(scenes[0]).toMatchObject({
      label: "Jan",
      startDate: "2026-01-01",
      endDate: "2026-01-31",
    });
    expect(scenes[1].endDate).toBe("2026-02-28");
    expect(scenes[6].endDate).toBe("2026-07-31");
  });

  it("Latest trails today by the publication latency and bounds the lookback", () => {
    const now = new Date("2026-08-04T12:00:00Z");
    const latest = monthlyScenes(now).at(-1)!;
    expect(latest.endDate).toBe(isoDateDaysAgo(LATEST_START_OFFSET_DAYS, now));
    expect(latest.startDate).toBe(isoDateDaysAgo(LATEST_MAX_OFFSET_DAYS, now));
  });

  it("in January only Latest is offered (no completed months yet)", () => {
    const scenes = monthlyScenes(new Date("2026-01-10T12:00:00Z"));
    expect(scenes.map((scene) => scene.id)).toEqual(["latest"]);
  });

  it("handles a leap-year February", () => {
    const scenes = monthlyScenes(new Date("2028-03-05T12:00:00Z"));
    expect(scenes[1].endDate).toBe("2028-02-29");
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
