import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { EvidenceManifest } from "./EvidenceManifest";
import type { CaseEvent } from "@/lib/types";

function makeEvent(overrides: Partial<CaseEvent>): CaseEvent {
  return {
    from_state: "NEW",
    to_state: "TRIAGED",
    actor: "Deputy Collector R. Sharma",
    occurred_at: "2026-06-19T09:00:00Z",
    artifacts: [],
    ...overrides,
  };
}

describe("EvidenceManifest", () => {
  it('shows "No artifacts recorded yet." when there are no events', () => {
    render(<EvidenceManifest events={[]} />);
    expect(screen.getByTestId("evidence-manifest")).toHaveTextContent(
      "No artifacts recorded yet."
    );
  });

  it("shows the empty state when events carry no artifacts", () => {
    render(
      <EvidenceManifest
        events={[makeEvent({ to_state: "TRIAGED", artifacts: [] })]}
      />
    );
    expect(screen.getByTestId("evidence-manifest")).toHaveTextContent(
      "No artifacts recorded yet."
    );
  });

  it("renders one row per artifact across all events, in chain order", () => {
    const events: CaseEvent[] = [
      makeEvent({
        from_state: "INSPECTED",
        to_state: "SHOW_CAUSE_ISSUED",
        actor: "Deputy Collector R. Sharma",
        occurred_at: "2026-06-29T14:00:00Z",
        artifacts: ["notice_document: notice-001.pdf", "dispatch_proof: dispatch-001.pdf"],
      }),
      makeEvent({
        from_state: "INSPECTION_ASSIGNED",
        to_state: "INSPECTED",
        actor: "Inspector A. Verma",
        occurred_at: "2026-06-25T11:45:00Z",
        artifacts: ["inspection_report: report-001.pdf"],
      }),
    ];

    render(<EvidenceManifest events={events} />);

    const rows = screen.getAllByTestId("evidence-manifest-row");
    expect(rows).toHaveLength(3);

    // Chain order: first event's artifacts first, in artifact order.
    expect(rows[0]).toHaveTextContent("Notice document");
    expect(rows[0]).toHaveTextContent("notice-001.pdf");
    expect(rows[0]).toHaveTextContent("Show Cause Issued");
    expect(rows[0]).toHaveTextContent("Deputy Collector R. Sharma");

    expect(rows[1]).toHaveTextContent("Dispatch proof");
    expect(rows[1]).toHaveTextContent("dispatch-001.pdf");

    expect(rows[2]).toHaveTextContent("Inspection report");
    expect(rows[2]).toHaveTextContent("report-001.pdf");
    expect(rows[2]).toHaveTextContent("Inspected");
    expect(rows[2]).toHaveTextContent("Inspector A. Verma");
  });

  it("tolerates artifact strings with no colon (kind Attachment)", () => {
    const events: CaseEvent[] = [
      makeEvent({ artifacts: ["site_photos_9001.zip"] }),
    ];
    render(<EvidenceManifest events={events} />);
    const row = screen.getByTestId("evidence-manifest-row");
    expect(row).toHaveTextContent("Attachment");
    expect(row).toHaveTextContent("site_photos_9001.zip");
  });

  it("shows the source-review and certification boundary", () => {
    const events: CaseEvent[] = [
      makeEvent({ artifacts: ["inspection_report: report-001.pdf"] }),
    ];
    render(<EvidenceManifest events={events} />);
    expect(screen.getByText(/source-record review and legal certification/)).toBeInTheDocument();
  });
});
