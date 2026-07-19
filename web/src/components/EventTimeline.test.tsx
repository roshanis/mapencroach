import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { EventTimeline } from "./EventTimeline";
import type { CaseEvent } from "@/lib/types";

function makeEvent(overrides: Partial<CaseEvent>): CaseEvent {
  return {
    from_state: "NEW",
    to_state: "TRIAGED",
    actor: "system",
    occurred_at: "2026-01-15T18:00:00Z",
    artifacts: [],
    ...overrides,
  };
}

describe("EventTimeline", () => {
  it("shows a placeholder when there are no events", () => {
    render(<EventTimeline events={[]} />);
    expect(screen.getByTestId("event-timeline")).toHaveTextContent(
      "No events recorded yet."
    );
  });

  it("renders one event-item per event, in chain (oldest-first) order", () => {
    const events: CaseEvent[] = [
      makeEvent({
        from_state: null,
        to_state: "NEW",
        actor: "system",
        occurred_at: "2026-01-15T17:00:00Z",
      }),
      makeEvent({
        from_state: "NEW",
        to_state: "TRIAGED",
        actor: "system",
        occurred_at: "2026-01-15T18:00:00Z",
        note: "high severity RED alert",
      }),
      makeEvent({
        from_state: "INSPECTED",
        to_state: "SHOW_CAUSE_ISSUED",
        actor: "officer-1",
        occurred_at: "2026-01-29T14:00:00Z",
        artifacts: [
          "notice_document: notice-001.pdf",
          "dispatch_proof: dispatch-001.pdf",
        ],
      }),
    ];

    render(<EventTimeline events={events} />);

    const items = screen.getAllByTestId("event-item");
    expect(items).toHaveLength(3);

    // Plain-language headlines, not raw state codes.
    expect(items[1]).toHaveTextContent("Case triaged");
    expect(items[1]).toHaveTextContent("high severity RED alert");
    expect(items[2]).toHaveTextContent("Show-cause notice issued");

    // Actor + humanized artifact chips.
    expect(items[2]).toHaveTextContent("Officer officer-1");
    expect(items[2]).toHaveTextContent("Notice document");
    expect(items[2]).toHaveTextContent("notice-001.pdf");
    expect(items[2]).toHaveTextContent("Dispatch proof");
    expect(items[2]).toHaveTextContent("dispatch-001.pdf");

    // No raw machine-speak transition arrows anywhere in the timeline.
    const timeline = screen.getByTestId("event-timeline");
    expect(timeline).not.toHaveTextContent("NEW → TRIAGED");
    expect(timeline).not.toHaveTextContent("→");
    expect(timeline).not.toHaveTextContent("notice_document:");
  });

  it("shows the actor and a formatted date on the meta line", () => {
    render(
      <EventTimeline
        events={[
          makeEvent({
            to_state: "TRIAGED",
            actor: "system",
            occurred_at: "2026-01-15T18:00:00Z",
          }),
        ]}
      />
    );
    const item = screen.getByTestId("event-item");
    expect(item).toHaveTextContent("System");
    expect(item).toHaveTextContent("15 Jan 2026");
  });
});
