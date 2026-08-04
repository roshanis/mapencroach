import { describe, expect, it } from "vitest";
import { parseFilterParam } from "./searchParams";

const OPTIONS = ["all", "red", "amber", "green"] as const;

describe("parseFilterParam", () => {
  it("returns the value when it is a recognized option", () => {
    expect(parseFilterParam("red", OPTIONS)).toBe("red");
  });

  it("returns 'all' when the value is null (param absent)", () => {
    expect(parseFilterParam(null, OPTIONS)).toBe("all");
  });

  it("returns 'all' for an unrecognized value instead of passing it through", () => {
    expect(parseFilterParam("bogus", OPTIONS)).toBe("all");
  });

  it("returns 'all' for an empty string", () => {
    expect(parseFilterParam("", OPTIONS)).toBe("all");
  });
});
