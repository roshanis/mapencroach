import { describe, expect, it } from "vitest";
import {
  sortBySeverityDesc,
  ageFromNow,
  jurisdictionLabel,
  roleLabel,
} from "./format";

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

describe("jurisdictionLabel", () => {
  it("returns the provided name verbatim when given, regardless of id", () => {
    expect(jurisdictionLabel("taluk-a1", "Haridwar City")).toBe(
      "Haridwar City"
    );
    expect(jurisdictionLabel("unknown-id", "Some Custom Name")).toBe(
      "Some Custom Name"
    );
  });

  it("falls back to the known jurisdiction map when no name is given", () => {
    expect(jurisdictionLabel("state")).toBe(
      "Haridwar–Roorkee Development Authority"
    );
    expect(jurisdictionLabel("dist-a")).toBe("Haridwar Division");
    expect(jurisdictionLabel("taluk-a1")).toBe("Haridwar City");
    expect(jurisdictionLabel("taluk-b2")).toBe("Bahadarabad");
  });

  it("title-cases unknown ids by capitalizing each hyphen-separated word", () => {
    expect(jurisdictionLabel("UK-URBAN-01")).toBe("Uk Urban 01");
    expect(jurisdictionLabel("some-new-jurisdiction")).toBe(
      "Some New Jurisdiction"
    );
  });

  it("treats an empty-string name as absent, falling through to the id logic", () => {
    expect(jurisdictionLabel("taluk-a1", "")).toBe("Haridwar City");
  });
});

describe("roleLabel", () => {
  it("converts a snake_case role into Title Case with spaces", () => {
    expect(roleLabel("case_officer")).toBe("Case Officer");
    expect(roleLabel("viewer")).toBe("Viewer");
    expect(roleLabel("survey_officer")).toBe("Survey Officer");
    expect(roleLabel("data_admin")).toBe("Data Admin");
  });
});
