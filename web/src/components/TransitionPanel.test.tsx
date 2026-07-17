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
});
