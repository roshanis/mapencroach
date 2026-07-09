import { describe, expect, it } from "vitest";
import { sortBySeverityDesc, ageFromNow } from "./format";

describe("sortBySeverityDesc", () => {
  it("orders items by severity_score descending", () => {
    const items = [
      { id: "a", severity_score: 20 },
      { id: "b", severity_score: 90 },
      { id: "c", severity_score: 55 },
    ];
    const sorted = sortBySeverityDesc(items);
    expect(sorted.map((i) => i.id)).toEqual(["b", "c", "a"]);
  });

  it("does not mutate the original array", () => {
    const items = [
      { id: "a", severity_score: 1 },
      { id: "b", severity_score: 2 },
    ];
    const original = [...items];
    sortBySeverityDesc(items);
    expect(items).toEqual(original);
  });
});

describe("ageFromNow", () => {
  it("formats durations under an hour in minutes", () => {
    const now = new Date("2026-07-08T12:30:00Z");
    const then = "2026-07-08T12:15:00Z";
    expect(ageFromNow(then, now)).toBe("15m ago");
  });

  it("formats durations under a day in hours", () => {
    const now = new Date("2026-07-08T12:00:00Z");
    const then = "2026-07-08T04:00:00Z";
    expect(ageFromNow(then, now)).toBe("8h ago");
  });

  it("formats durations over a day in days", () => {
    const now = new Date("2026-07-08T12:00:00Z");
    const then = "2026-07-05T12:00:00Z";
    expect(ageFromNow(then, now)).toBe("3d ago");
  });
});
