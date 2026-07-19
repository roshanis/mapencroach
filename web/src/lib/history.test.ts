import { describe, expect, it } from "vitest";
import { describeActor, describeEvent } from "./history";
import type { CaseEvent } from "./types";

function makeEvent(
  overrides: Partial<Omit<CaseEvent, "to_state">> & { to_state?: string }
): CaseEvent {
  return {
    from_state: "NEW",
    to_state: "TRIAGED",
    actor: "system",
    occurred_at: "2026-01-15T18:00:00Z",
    artifacts: [],
    ...overrides,
  } as CaseEvent;
}

describe("describeEvent", () => {
  it('narrates a transition to TRIAGED as "Case triaged"', () => {
    expect(describeEvent(makeEvent({ to_state: "TRIAGED" })).headline).toBe(
      "Case triaged"
    );
  });

  it('narrates INSPECTION_ASSIGNED as "Inspection assigned" with no inspector artifact', () => {
    expect(
      describeEvent(makeEvent({ to_state: "INSPECTION_ASSIGNED", artifacts: [] }))
        .headline
    ).toBe("Inspection assigned");
  });

  it("appends the inspector id to the INSPECTION_ASSIGNED headline when present", () => {
    expect(
      describeEvent(
        makeEvent({
          to_state: "INSPECTION_ASSIGNED",
          artifacts: ["inspector_id: inspector-1"],
        })
      ).headline
    ).toBe("Inspection assigned to inspector-1");
  });

  it('narrates INSPECTED as "Site inspection completed"', () => {
    expect(describeEvent(makeEvent({ to_state: "INSPECTED" })).headline).toBe(
      "Site inspection completed"
    );
  });

  it('narrates SHOW_CAUSE_ISSUED as "Show-cause notice issued"', () => {
    expect(
      describeEvent(makeEvent({ to_state: "SHOW_CAUSE_ISSUED" })).headline
    ).toBe("Show-cause notice issued");
  });

  it('narrates RESPONSE_WINDOW as "Response window opened"', () => {
    expect(
      describeEvent(makeEvent({ to_state: "RESPONSE_WINDOW" })).headline
    ).toBe("Response window opened");
  });

  it('narrates the special STAYED_BY_COURT state as "Court stay recorded"', () => {
    expect(
      describeEvent(makeEvent({ to_state: "STAYED_BY_COURT" })).headline
    ).toBe("Court stay recorded");
  });

  it('narrates the special LEGACY_REFERRED state as "Referred to legacy process"', () => {
    expect(
      describeEvent(makeEvent({ to_state: "LEGACY_REFERRED" })).headline
    ).toBe("Referred to legacy process");
  });

  it('narrates the special DISMISSED_FALSE_POSITIVE state as "Dismissed as false positive"', () => {
    expect(
      describeEvent(makeEvent({ to_state: "DISMISSED_FALSE_POSITIVE" })).headline
    ).toBe("Dismissed as false positive");
  });

  it("falls back to a humanized label for an unrecognized state instead of crashing", () => {
    expect(
      describeEvent(makeEvent({ to_state: "SOME_FUTURE_STATE" })).headline
    ).toBe("Some Future State");
  });

  it("surfaces the note as detail when present", () => {
    expect(
      describeEvent(
        makeEvent({ to_state: "TRIAGED", note: "high severity RED alert" })
      ).detail
    ).toBe("high severity RED alert");
  });

  it("omits detail when there is no note", () => {
    expect(
      describeEvent(makeEvent({ to_state: "TRIAGED", note: undefined })).detail
    ).toBeUndefined();
  });
});

describe("describeActor", () => {
  it('renders "system" as "System"', () => {
    expect(describeActor("system")).toBe("System");
  });

  it('keeps the id but title-cases the encoded role for "inspector-1"', () => {
    expect(describeActor("inspector-1")).toBe("Inspector inspector-1");
  });

  it('keeps the id but title-cases the encoded role for "officer-1"', () => {
    expect(describeActor("officer-1")).toBe("Officer officer-1");
  });

  it("returns an id with no encoded role verbatim", () => {
    expect(describeActor("Deputy Collector R. Sharma")).toBe(
      "Deputy Collector R. Sharma"
    );
  });
});
