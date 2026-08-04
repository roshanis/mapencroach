import { describe, expect, it } from "vitest";
import {
  sortBySeverityDesc,
  ageFromNow,
  jurisdictionLabel,
  roleLabel,
  formatDuration,
  parseArtifact,
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

describe("formatDuration", () => {
  it('renders 0 days as "today"', () => {
    expect(formatDuration(0)).toBe("today");
  });

  it("renders exactly 1 day as singular", () => {
    expect(formatDuration(1)).toBe("1 day");
  });

  it("renders sub-60-day counts as plural days", () => {
    expect(formatDuration(45)).toBe("45 days");
  });

  it("renders 59 days as days, not months (boundary)", () => {
    expect(formatDuration(59)).toBe("59 days");
  });

  it("rounds 184 days to the nearest month", () => {
    expect(formatDuration(184)).toBe("6 months");
  });

  it("renders 60 days as 2 months (boundary)", () => {
    expect(formatDuration(60)).toBe("2 months");
  });

  it("renders 800 days in years once the month count reaches 24", () => {
    expect(formatDuration(800)).toBe("2 years");
  });

  it("treats non-positive day counts as today", () => {
    expect(formatDuration(-5)).toBe("today");
  });
});

describe("parseArtifact", () => {
  it('parses a "key: value" artifact string into a humanized kind', () => {
    expect(parseArtifact("inspection_report: report-001.pdf")).toEqual({
      kind: "Inspection report",
      label: "report-001.pdf",
      value: "report-001.pdf",
    });
  });

  it("humanizes multi-word snake_case keys", () => {
    expect(parseArtifact("dispatch_proof: dispatch-001.pdf")).toEqual({
      kind: "Dispatch proof",
      label: "dispatch-001.pdf",
      value: "dispatch-001.pdf",
    });
  });

  it("tolerates a string with no colon by treating it as an Attachment", () => {
    expect(parseArtifact("site_photos_9001.zip")).toEqual({
      kind: "Attachment",
      label: "site_photos_9001.zip",
      value: "site_photos_9001.zip",
    });
  });

  it("trims surrounding whitespace around the key and value", () => {
    expect(parseArtifact("notice_document :  notice-001.pdf ")).toEqual({
      kind: "Notice document",
      label: "notice-001.pdf",
      value: "notice-001.pdf",
    });
  });
});
