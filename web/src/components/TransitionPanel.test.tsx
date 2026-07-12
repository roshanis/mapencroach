import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { TransitionPanel } from "./TransitionPanel";
import { transitionCase } from "@/lib/api";

vi.mock("@/lib/api", () => ({
  transitionCase: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

const ALL_15_STATES = [
  "NEW",
  "TRIAGED",
  "INSPECTION_ASSIGNED",
  "INSPECTED",
  "SHOW_CAUSE_ISSUED",
  "RESPONSE_WINDOW",
  "HEARING_SCHEDULED",
  "HEARING_HELD",
  "ORDER_ISSUED",
  "ACTION_TAKEN",
  "CLOSED",
  "DISMISSED_FALSE_POSITIVE",
  "LEGACY_REFERRED",
  "SURVEY_REQUESTED",
  "STAYED_BY_COURT",
];

describe("TransitionPanel", () => {
  it("renders all 15 options with allowed/refused suffixes", () => {
    render(
      <TransitionPanel
        caseId="CASE-1"
        allowedTransitions={["RESPONSE_WINDOW", "DISMISSED_FALSE_POSITIVE"]}
        requiredArtifacts={{}}
      />
    );

    const select = screen.getByTestId("transition-select");
    const options = select.querySelectorAll("option");
    expect(options).toHaveLength(15);

    ALL_15_STATES.forEach((state, idx) => {
      const label = state.replace(/_/g, " ");
      const suffix =
        state === "RESPONSE_WINDOW" || state === "DISMISSED_FALSE_POSITIVE"
          ? " — allowed"
          : " — will be refused";
      expect(options[idx].textContent).toBe(`${label}${suffix}`);
    });
  });

  it("shows prefilled artifact inputs for an allowed state that requires artifacts", () => {
    render(
      <TransitionPanel
        caseId="CASE-1"
        allowedTransitions={["DISMISSED_FALSE_POSITIVE"]}
        requiredArtifacts={{
          DISMISSED_FALSE_POSITIVE: ["dismissal_reason"],
        }}
      />
    );

    const select = screen.getByTestId(
      "transition-select"
    ) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "DISMISSED_FALSE_POSITIVE" } });

    const input = screen.getByTestId(
      "artifact-input-dismissal_reason"
    ) as HTMLInputElement;
    expect(input).toBeInTheDocument();
    expect(input.value).toBe("dismissal_reason-demo.pdf");
  });

  it("shows the refusal hint when a non-allowed state is selected", () => {
    render(
      <TransitionPanel
        caseId="CASE-1"
        allowedTransitions={["RESPONSE_WINDOW"]}
        requiredArtifacts={{}}
      />
    );

    const select = screen.getByTestId(
      "transition-select"
    ) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "ORDER_ISSUED" } });

    expect(
      screen.getByText(
        "Not legal from the current state — submit to see the engine refuse."
      )
    ).toBeInTheDocument();
  });

  it("renders a red refusal banner with verbatim detail on failed submit", async () => {
    vi.mocked(transitionCase).mockResolvedValue({
      ok: false,
      status: 409,
      detail: "cannot transition from SHOW_CAUSE_ISSUED to ORDER_ISSUED",
    });

    render(
      <TransitionPanel
        caseId="CASE-1"
        allowedTransitions={["RESPONSE_WINDOW"]}
        requiredArtifacts={{}}
      />
    );

    const select = screen.getByTestId(
      "transition-select"
    ) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "ORDER_ISSUED" } });

    fireEvent.click(screen.getByTestId("transition-submit"));

    await waitFor(() => {
      expect(screen.getByTestId("transition-result")).toBeInTheDocument();
    });

    const banner = screen.getByTestId("transition-result");
    expect(banner).toHaveAttribute("data-outcome", "refused");
    expect(banner).toHaveTextContent(
      "Refused (HTTP 409): cannot transition from SHOW_CAUSE_ISSUED to ORDER_ISSUED"
    );
  });

  it("renders a green success banner on successful submit", async () => {
    vi.mocked(transitionCase).mockResolvedValue({
      ok: true,
      status: 201,
    });

    render(
      <TransitionPanel
        caseId="CASE-1"
        allowedTransitions={["RESPONSE_WINDOW"]}
        requiredArtifacts={{}}
      />
    );

    fireEvent.click(screen.getByTestId("transition-submit"));

    await waitFor(() => {
      expect(screen.getByTestId("transition-result")).toBeInTheDocument();
    });

    const banner = screen.getByTestId("transition-result");
    expect(banner).toHaveAttribute("data-outcome", "success");
    expect(banner).toHaveTextContent(
      "Transition recorded — the case advanced."
    );
  });
});
