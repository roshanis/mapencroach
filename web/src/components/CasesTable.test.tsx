import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { useRouter } from "next/navigation";
import { CasesTable } from "./CasesTable";
import type { Case } from "@/lib/types";

const pushMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: vi.fn(),
}));

function daysAgoIso(days: number): string {
  const now = new Date("2026-07-13T12:00:00Z").getTime();
  return new Date(now - days * 24 * 60 * 60 * 1000).toISOString();
}

function makeCase(overrides: Partial<Case> & { id: string }): Case {
  return {
    alert_id: `ALT-${overrides.id}`,
    parcel_id: `PCL-${overrides.id}`,
    state: "NEW",
    events: [],
    ...overrides,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-07-13T12:00:00Z"));
  vi.mocked(useRouter).mockReturnValue({
    push: pushMock,
  } as unknown as ReturnType<typeof useRouter>);
});

afterEach(() => {
  vi.useRealTimers();
  pushMock.mockReset();
});

describe("CasesTable", () => {
  it("groups cases into In due process, Paused, and Concluded sections", () => {
    const cases: Case[] = [
      makeCase({ id: "1", state: "SHOW_CAUSE_ISSUED", state_since: daysAgoIso(3) }),
      makeCase({ id: "2", state: "STAYED_BY_COURT", state_since: daysAgoIso(5) }),
      makeCase({ id: "3", state: "CLOSED", state_since: daysAgoIso(10) }),
    ];

    render(<CasesTable cases={cases} />);

    expect(screen.getByText("In due process")).toBeInTheDocument();
    expect(screen.getByText("Paused")).toBeInTheDocument();
    expect(screen.getByText("Concluded")).toBeInTheDocument();
  });

  it("omits empty sections", () => {
    const cases: Case[] = [
      makeCase({ id: "1", state: "SHOW_CAUSE_ISSUED", state_since: daysAgoIso(3) }),
    ];

    render(<CasesTable cases={cases} />);

    expect(screen.getByText("In due process")).toBeInTheDocument();
    expect(screen.queryByText("Paused")).not.toBeInTheDocument();
    expect(screen.queryByText("Concluded")).not.toBeInTheDocument();
  });

  it("treats CLOSED as concluded, not in due process", () => {
    const cases: Case[] = [makeCase({ id: "1", state: "CLOSED" })];

    render(<CasesTable cases={cases} />);

    expect(screen.queryByText("In due process")).not.toBeInTheDocument();
    expect(screen.getByText("Concluded")).toBeInTheDocument();
  });

  it("treats DISMISSED_FALSE_POSITIVE and LEGACY_REFERRED as concluded", () => {
    const cases: Case[] = [
      makeCase({ id: "1", state: "DISMISSED_FALSE_POSITIVE" }),
      makeCase({ id: "2", state: "LEGACY_REFERRED" }),
    ];

    render(<CasesTable cases={cases} />);

    expect(screen.getByText("Concluded")).toBeInTheDocument();
    expect(screen.queryByText("In due process")).not.toBeInTheDocument();
    expect(screen.queryByText("Paused")).not.toBeInTheDocument();
  });

  it("sorts the in-due-process section by days-in-stage descending", () => {
    const cases: Case[] = [
      makeCase({ id: "A", state: "NEW", state_since: daysAgoIso(1) }),
      makeCase({ id: "B", state: "TRIAGED", state_since: daysAgoIso(20) }),
      makeCase({ id: "C", state: "INSPECTED", state_since: daysAgoIso(5) }),
    ];

    render(<CasesTable cases={cases} />);

    const rows = screen.getAllByTestId("case-row");
    expect(rows.map((r) => r.getAttribute("data-case-id"))).toEqual([
      "B",
      "C",
      "A",
    ]);
  });

  it("computes time in stage as whole days from state_since", () => {
    const cases: Case[] = [
      makeCase({ id: "1", state: "NEW", state_since: daysAgoIso(12) }),
    ];

    render(<CasesTable cases={cases} />);

    expect(screen.getByTestId("case-row")).toHaveTextContent("12 days");
  });

  it("renders an em dash for time in stage when state_since is null", () => {
    const cases: Case[] = [
      makeCase({ id: "1", state: "NEW", state_since: null }),
    ];

    render(<CasesTable cases={cases} />);

    expect(screen.getByTestId("case-row")).toHaveTextContent("—");
  });

  it("renders a mini progress bar and step text for chain states", () => {
    const cases: Case[] = [
      makeCase({ id: "1", state: "HEARING_SCHEDULED", state_since: daysAgoIso(2) }),
    ];

    render(<CasesTable cases={cases} />);

    // HEARING_SCHEDULED is index 6 (0-based) of 11 -> Step 7 of 11
    expect(screen.getByText("Step 7 of 11")).toBeInTheDocument();
  });

  it('renders "—" for what-can-happen-next when allowed_transitions is undefined', () => {
    const cases: Case[] = [makeCase({ id: "1", state: "NEW" })];

    render(<CasesTable cases={cases} />);

    const row = screen.getByTestId("case-row");
    expect(row).toHaveTextContent("—");
  });

  it("renders up to 2 allowed_transitions as chips plus a +n more chip", () => {
    const cases: Case[] = [
      makeCase({
        id: "1",
        state: "SHOW_CAUSE_ISSUED",
        allowed_transitions: [
          "RESPONSE_WINDOW",
          "DISMISSED_FALSE_POSITIVE",
          "LEGACY_REFERRED",
          "SURVEY_REQUESTED",
        ],
      }),
    ];

    render(<CasesTable cases={cases} />);

    expect(screen.getByText("RESPONSE WINDOW")).toBeInTheDocument();
    expect(screen.getByText("DISMISSED FALSE POSITIVE")).toBeInTheDocument();
    expect(screen.getByText("+2 more")).toBeInTheDocument();
  });

  it("navigates to /cases/{id} on row click", () => {
    const cases: Case[] = [makeCase({ id: "CASE-9001", state: "NEW" })];

    render(<CasesTable cases={cases} />);

    screen.getByTestId("case-row").click();

    expect(pushMock).toHaveBeenCalledWith("/cases/CASE-9001");
  });

  it("shows Case and Parcel ids in the row", () => {
    const cases: Case[] = [
      makeCase({ id: "CASE-1", parcel_id: "PCL-77", state: "NEW" }),
    ];

    render(<CasesTable cases={cases} />);

    expect(screen.getByText("CASE-1")).toBeInTheDocument();
    expect(screen.getByText("PCL-77")).toBeInTheDocument();
  });

  it("places every case in exactly one section (no duplicates across sections)", () => {
    const cases: Case[] = [
      makeCase({ id: "1", state: "NEW" }),
      makeCase({ id: "2", state: "STAYED_BY_COURT" }),
      makeCase({ id: "3", state: "SURVEY_REQUESTED" }),
      makeCase({ id: "4", state: "CLOSED" }),
      makeCase({ id: "5", state: "DISMISSED_FALSE_POSITIVE" }),
      makeCase({ id: "6", state: "LEGACY_REFERRED" }),
    ];

    render(<CasesTable cases={cases} />);

    const rows = screen.getAllByTestId("case-row");
    expect(rows).toHaveLength(6);
    const ids = rows.map((r) => r.getAttribute("data-case-id"));
    expect(new Set(ids).size).toBe(6);
  });

  it("breaks ties deterministically by case id when state_since is null for multiple in-due-process cases", () => {
    const cases: Case[] = [
      makeCase({ id: "Z", state: "NEW", state_since: null }),
      makeCase({ id: "A", state: "TRIAGED", state_since: null }),
      makeCase({ id: "M", state: "INSPECTED", state_since: null }),
    ];

    render(<CasesTable cases={cases} />);

    const rows = screen.getAllByTestId("case-row");
    expect(rows.map((r) => r.getAttribute("data-case-id"))).toEqual([
      "A",
      "M",
      "Z",
    ]);
  });
});
