import { describe, expect, it } from "vitest";
import {
  ALERT_STATUS_DESCRIPTIONS,
  SEVERITY_EXPLANATION,
  STATE_DESCRIPTIONS,
  TIER_DESCRIPTIONS,
} from "./explanations";
import { CASE_STATE_CHAIN } from "./types";

describe("explanations", () => {
  it("has a TIER_DESCRIPTIONS entry for all four tiers", () => {
    expect(TIER_DESCRIPTIONS.red).toMatch(/act now/i);
    expect(TIER_DESCRIPTIONS.amber).toMatch(/investigate/i);
    expect(TIER_DESCRIPTIONS.green).toMatch(/monitor/i);
    expect(TIER_DESCRIPTIONS.legacy).toMatch(/regularization/i);
  });

  it("has an ALERT_STATUS_DESCRIPTIONS entry for all four statuses", () => {
    expect(ALERT_STATUS_DESCRIPTIONS.open).toBeTruthy();
    expect(ALERT_STATUS_DESCRIPTIONS.under_review).toBeTruthy();
    expect(ALERT_STATUS_DESCRIPTIONS.escalated).toBeTruthy();
    expect(ALERT_STATUS_DESCRIPTIONS.closed).toBeTruthy();
  });

  it("SEVERITY_EXPLANATION documents the real scoring formula", () => {
    expect(SEVERITY_EXPLANATION).toMatch(/1 hectare/);
    expect(SEVERITY_EXPLANATION).toMatch(/waterbody/i);
    expect(SEVERITY_EXPLANATION).toMatch(/Grade A/);
    expect(SEVERITY_EXPLANATION).toMatch(/repeat offenders/i);
    expect(SEVERITY_EXPLANATION).toMatch(/0.100|0–100/);
  });

  it("has a STATE_DESCRIPTIONS entry for every chain state, referencing real evidence names", () => {
    CASE_STATE_CHAIN.forEach((state) => {
      expect(STATE_DESCRIPTIONS[state]).toBeTruthy();
    });
    expect(STATE_DESCRIPTIONS.SHOW_CAUSE_ISSUED).toMatch(/notice document/i);
    expect(STATE_DESCRIPTIONS.SHOW_CAUSE_ISSUED).toMatch(/dispatch proof/i);
    expect(STATE_DESCRIPTIONS.INSPECTION_ASSIGNED).toMatch(/inspector/i);
    expect(STATE_DESCRIPTIONS.INSPECTED).toMatch(/inspection report/i);
    expect(STATE_DESCRIPTIONS.HEARING_SCHEDULED).toMatch(/hearing date/i);
    expect(STATE_DESCRIPTIONS.HEARING_HELD).toMatch(/hearing record/i);
    expect(STATE_DESCRIPTIONS.ORDER_ISSUED).toMatch(/reasoned order/i);
    expect(STATE_DESCRIPTIONS.ACTION_TAKEN).toMatch(/action report/i);
    expect(STATE_DESCRIPTIONS.CLOSED).toMatch(/closure note/i);
    expect(STATE_DESCRIPTIONS.TRIAGED).toMatch(/triage note/i);
  });
});
