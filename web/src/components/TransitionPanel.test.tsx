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

describe("TransitionPanel", () => {
  it("shows only legal next steps as primary action buttons", () => {
    render(
      <TransitionPanel
        caseId="CASE-1"
        allowedTransitions={["RESPONSE_WINDOW", "SURVEY_REQUESTED"]}
        requiredArtifacts={{}}
      />
    );

    expect(
      screen.getByRole("button", { name: "Open response window" })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Request boundary survey" })
    ).toBeInTheDocument();
    expect(screen.queryByTestId("transition-select")).not.toBeInTheDocument();
  });

  it("shows required evidence for the selected legal action without fake values", () => {
    render(
      <TransitionPanel
        caseId="CASE-1"
        allowedTransitions={["DISMISSED_FALSE_POSITIVE"]}
        requiredArtifacts={{
          DISMISSED_FALSE_POSITIVE: ["dismissal_reason"],
        }}
      />
    );

    const input = screen.getByLabelText("Dismissal reason") as HTMLInputElement;
    expect(input.value).toBe("");
    expect(screen.getByRole("button", { name: "Record dismissal" })).toBeDisabled();
  });

  it("keeps invalid-transition testing inside an explicit demo disclosure", () => {
    render(
      <TransitionPanel
        caseId="CASE-1"
        allowedTransitions={["RESPONSE_WINDOW"]}
        requiredArtifacts={{}}
      />
    );

    expect(screen.getByText("Demo: test the policy guard")).toBeInTheDocument();
    expect(screen.getByTestId("guard-transition-select")).toBeInTheDocument();
  });

  it("renders the backend refusal verbatim when the demo guard is submitted", async () => {
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

    fireEvent.change(screen.getByTestId("guard-transition-select"), {
      target: { value: "ORDER_ISSUED" },
    });
    fireEvent.click(screen.getByTestId("guard-transition-submit"));

    await waitFor(() => {
      expect(screen.getByTestId("transition-result")).toBeInTheDocument();
    });
    expect(screen.getByTestId("transition-result")).toHaveTextContent(
      "Refused (HTTP 409): cannot transition from SHOW_CAUSE_ISSUED to ORDER_ISSUED"
    );
  });

  it("records an allowed step after required evidence is supplied", async () => {
    vi.mocked(transitionCase).mockResolvedValue({ ok: true, status: 201 });

    render(
      <TransitionPanel
        caseId="CASE-1"
        allowedTransitions={["DISMISSED_FALSE_POSITIVE"]}
        requiredArtifacts={{
          DISMISSED_FALSE_POSITIVE: ["dismissal_reason"],
        }}
      />
    );

    fireEvent.change(screen.getByLabelText("Dismissal reason"), {
      target: { value: "Verified duplicate detection" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Record dismissal" }));

    await waitFor(() => {
      expect(transitionCase).toHaveBeenCalledWith(
        "CASE-1",
        "DISMISSED_FALSE_POSITIVE",
        { dismissal_reason: "Verified duplicate detection" },
        ""
      );
    });
    expect(screen.getByTestId("transition-result")).toHaveTextContent(
      "Transition recorded — the case advanced."
    );
  });

  it("resyncs the selected step and evidence gate when allowedTransitions changes after a submit (router.refresh)", () => {
    const { rerender } = render(
      <TransitionPanel
        caseId="CASE-1"
        allowedTransitions={["RESPONSE_WINDOW"]}
        requiredArtifacts={{}}
      />
    );

    expect(
      screen.getByRole("button", { name: "Record response window" })
    ).toBeInTheDocument();

    // Simulate the server delivering fresh props after router.refresh(): the
    // case moved on, RESPONSE_WINDOW is no longer legal, and the new legal
    // step requires evidence the panel has never collected.
    rerender(
      <TransitionPanel
        caseId="CASE-1"
        allowedTransitions={["HEARING_SCHEDULED"]}
        requiredArtifacts={{ HEARING_SCHEDULED: ["hearing_notice"] }}
      />
    );

    const hearingButton = screen.getByRole("button", {
      name: "Advance to Hearing Scheduled",
    });
    // The new legal step is selected/highlighted...
    expect(hearingButton).toHaveAttribute("aria-pressed", "true");
    // ...its evidence field is shown...
    expect(screen.getByLabelText("Hearing notice")).toBeInTheDocument();
    // ...and the now-illegal RESPONSE_WINDOW step is gone, not left stale.
    expect(
      screen.queryByRole("button", { name: "Record response window" })
    ).not.toBeInTheDocument();
    // Evidence is empty, so the gate must not silently pass (the stale-props
    // bug made requiredArtifacts[stale] undefined, which vacuously enabled
    // submit).
    expect(
      screen.getByRole("button", { name: "Record Hearing Scheduled" })
    ).toBeDisabled();
  });

  it("resyncs the demo policy-guard select when the blocked-state set changes", () => {
    const { rerender } = render(
      <TransitionPanel
        caseId="CASE-1"
        allowedTransitions={["RESPONSE_WINDOW"]}
        requiredArtifacts={{}}
      />
    );

    const initialGuardSelect = screen.getByTestId(
      "guard-transition-select"
    ) as HTMLSelectElement;
    const initialValue = initialGuardSelect.value;
    expect(initialValue).not.toBe("");

    // RESPONSE_WINDOW becomes legal (moves out of the blocked set); if it was
    // the guard selection it must no longer be selectable as a "blocked" demo.
    rerender(
      <TransitionPanel
        caseId="CASE-1"
        allowedTransitions={["RESPONSE_WINDOW", initialValue]}
        requiredArtifacts={{}}
      />
    );

    const guardSelect = screen.getByTestId(
      "guard-transition-select"
    ) as HTMLSelectElement;
    expect(guardSelect.value).not.toBe(initialValue);
  });

  it("shows a retryable error when the transition service cannot be reached", async () => {
    vi.mocked(transitionCase).mockRejectedValue(new Error("offline"));

    render(
      <TransitionPanel
        caseId="CASE-1"
        allowedTransitions={["RESPONSE_WINDOW"]}
        requiredArtifacts={{}}
      />
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Record response window" })
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Transition service could not be reached. Try again."
    );
  });

  it("resyncs selection when allowedTransitions changes after router.refresh(), without clearing the success banner", async () => {
    vi.mocked(transitionCase).mockResolvedValue({ ok: true, status: 201 });

    const { rerender } = render(
      <TransitionPanel
        caseId="CASE-1"
        allowedTransitions={["DISMISSED_FALSE_POSITIVE"]}
        requiredArtifacts={{ DISMISSED_FALSE_POSITIVE: ["dismissal_reason"] }}
      />
    );

    fireEvent.change(screen.getByLabelText("Dismissal reason"), {
      target: { value: "Verified duplicate detection" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Record dismissal" }));

    await waitFor(() => {
      expect(screen.getByTestId("transition-result")).toHaveTextContent(
        "Transition recorded — the case advanced."
      );
    });

    // Simulate the server re-render that router.refresh() triggers: the same
    // component instance now receives new allowed transitions for the case's
    // new state.
    rerender(
      <TransitionPanel
        caseId="CASE-1"
        allowedTransitions={["RESPONSE_WINDOW"]}
        requiredArtifacts={{}}
      />
    );

    expect(
      screen.getByRole("button", { name: "Open response window" })
    ).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByLabelText("Dismissal reason")).not.toBeInTheDocument();
    expect(
      screen.getByText("No evidence reference is required for this step.")
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Record response window" })
    ).toBeEnabled();
    // The success banner from the just-completed transition must survive the
    // resync -- only selection/evidence state resets, not the result.
    expect(screen.getByTestId("transition-result")).toHaveTextContent(
      "Transition recorded — the case advanced."
    );
  });

  it("does not reset a user's selection when allowedTransitions is replaced by a new array with the same contents", () => {
    const { rerender } = render(
      <TransitionPanel
        caseId="CASE-1"
        allowedTransitions={["RESPONSE_WINDOW", "SURVEY_REQUESTED"]}
        requiredArtifacts={{}}
      />
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Request boundary survey" })
    );
    expect(
      screen.getByRole("button", { name: "Request boundary survey" })
    ).toHaveAttribute("aria-pressed", "true");

    // A brand-new array object with identical contents (e.g. a fresh render
    // from the server that didn't actually change the case's legal state)
    // must not clobber the user's in-progress, non-default selection.
    rerender(
      <TransitionPanel
        caseId="CASE-1"
        allowedTransitions={["RESPONSE_WINDOW", "SURVEY_REQUESTED"]}
        requiredArtifacts={{}}
      />
    );

    expect(
      screen.getByRole("button", { name: "Request boundary survey" })
    ).toHaveAttribute("aria-pressed", "true");
  });
});
