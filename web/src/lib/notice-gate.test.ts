import { describe, expect, it } from "vitest";
import { canDraftNotice } from "./notice-gate";
import { CASE_STATE_CHAIN } from "./types";

describe("canDraftNotice", () => {
  it("allows the default (cookie-less) officer session on an active in-chain case", () => {
    expect(canDraftNotice({ role: undefined, state: "NEW" })).toBe(true);
  });

  it("allows an explicit case_officer persona on an active in-chain case", () => {
    expect(canDraftNotice({ role: "case_officer", state: "TRIAGED" })).toBe(true);
  });

  it.each(CASE_STATE_CHAIN.filter((state) => state !== "CLOSED"))(
    "allows a case_officer to draft in every active in-chain state (%s)",
    (state) => {
      expect(canDraftNotice({ role: "case_officer", state })).toBe(true);
    }
  );

  it("blocks a case_officer once the case reaches CLOSED", () => {
    expect(canDraftNotice({ role: "case_officer", state: "CLOSED" })).toBe(false);
  });

  it.each([
    "STAYED_BY_COURT",
    "SURVEY_REQUESTED",
    "DISMISSED_FALSE_POSITIVE",
    "LEGACY_REFERRED",
  ] as const)(
    "blocks a case_officer for the special/paused/terminal state %s",
    (state) => {
      expect(canDraftNotice({ role: "case_officer", state })).toBe(false);
    }
  );

  it.each(["viewer", "state_viewer", "survey_officer", "data_admin"])(
    "blocks the %s role even on an active in-chain case",
    (role) => {
      expect(canDraftNotice({ role, state: "NEW" })).toBe(false);
    }
  );

  it("blocks a non-officer role regardless of case state (viewer + CLOSED)", () => {
    expect(canDraftNotice({ role: "viewer", state: "CLOSED" })).toBe(false);
  });
});
