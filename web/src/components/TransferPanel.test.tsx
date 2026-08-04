import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { TransferPanel } from "./TransferPanel";
import { transferCase } from "@/lib/api";
import type { Jurisdiction } from "@/lib/types";

vi.mock("@/lib/api", () => ({
  transferCase: vi.fn(),
}));

const { mockRefresh } = vi.hoisted(() => ({ mockRefresh: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mockRefresh }),
}));

const JURISDICTIONS: Jurisdiction[] = [
  { id: "dist-a", name: "Haridwar Division", parent_id: "state" },
  { id: "dist-b", name: "Roorkee Division", parent_id: "state" },
  { id: "taluk-a1", name: "Haridwar City", parent_id: "dist-a" },
];

describe("TransferPanel", () => {
  it("renders a collapsed details panel titled 'Transfer case'", () => {
    render(
      <TransferPanel
        caseId="CASE-1"
        currentJurisdictionId="dist-a"
        jurisdictions={JURISDICTIONS}
      />
    );

    expect(screen.getByText("Transfer case")).toBeInTheDocument();
    const panel = screen.getByTestId("transfer-panel");
    expect(panel.tagName).toBe("DETAILS");
    expect(panel).not.toHaveAttribute("open");
  });

  it("offers every jurisdiction except the case's current one", () => {
    render(
      <TransferPanel
        caseId="CASE-1"
        currentJurisdictionId="dist-a"
        jurisdictions={JURISDICTIONS}
      />
    );

    const select = screen.getByTestId(
      "transfer-target-select"
    ) as HTMLSelectElement;
    const optionLabels = Array.from(select.options).map((o) => o.textContent);
    expect(optionLabels).toEqual(["Roorkee Division", "Haridwar City"]);
    expect(optionLabels).not.toContain("Haridwar Division");
  });

  it("disables submit while the reason is blank, enables it once filled in", () => {
    render(
      <TransferPanel
        caseId="CASE-1"
        currentJurisdictionId="dist-a"
        jurisdictions={JURISDICTIONS}
      />
    );

    const submit = screen.getByTestId("transfer-submit");
    expect(submit).toBeDisabled();

    fireEvent.change(screen.getByTestId("transfer-reason-input"), {
      target: { value: "Workload rebalance" },
    });
    expect(submit).toBeEnabled();

    fireEvent.change(screen.getByTestId("transfer-reason-input"), {
      target: { value: "   " },
    });
    expect(submit).toBeDisabled();
  });

  it("submits the selected target and reason", async () => {
    vi.mocked(transferCase).mockResolvedValue({ ok: true, status: 200 });

    render(
      <TransferPanel
        caseId="CASE-1"
        currentJurisdictionId="dist-a"
        jurisdictions={JURISDICTIONS}
      />
    );

    fireEvent.change(screen.getByTestId("transfer-target-select"), {
      target: { value: "dist-b" },
    });
    fireEvent.change(screen.getByTestId("transfer-reason-input"), {
      target: { value: "Handover to Roorkee" },
    });
    fireEvent.click(screen.getByTestId("transfer-submit"));

    await waitFor(() => {
      expect(transferCase).toHaveBeenCalledWith(
        "CASE-1",
        "dist-b",
        "Handover to Roorkee"
      );
    });
  });

  it("shows a role=status confirmation naming the target on success, with a link to /cases, and does not call router.refresh", async () => {
    vi.mocked(transferCase).mockResolvedValue({ ok: true, status: 200 });

    render(
      <TransferPanel
        caseId="CASE-1"
        currentJurisdictionId="dist-a"
        jurisdictions={JURISDICTIONS}
      />
    );

    fireEvent.change(screen.getByTestId("transfer-target-select"), {
      target: { value: "dist-b" },
    });
    fireEvent.change(screen.getByTestId("transfer-reason-input"), {
      target: { value: "Handover to Roorkee" },
    });
    fireEvent.click(screen.getByTestId("transfer-submit"));

    const result = await screen.findByRole("status");
    expect(result).toHaveTextContent("Roorkee Division");
    expect(screen.getByRole("link", { name: /cases/i })).toHaveAttribute(
      "href",
      "/cases"
    );
    expect(mockRefresh).not.toHaveBeenCalled();
  });

  it("shows a role=alert refusal with the backend detail on failure", async () => {
    vi.mocked(transferCase).mockResolvedValue({
      ok: false,
      status: 400,
      detail: "case is already in that jurisdiction",
    });

    render(
      <TransferPanel
        caseId="CASE-1"
        currentJurisdictionId="dist-a"
        jurisdictions={JURISDICTIONS}
      />
    );

    fireEvent.change(screen.getByTestId("transfer-reason-input"), {
      target: { value: "no-op" },
    });
    fireEvent.click(screen.getByTestId("transfer-submit"));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(
      "Refused (HTTP 400): case is already in that jurisdiction"
    );
  });

  it("special-cases a status 0 refusal (service unreachable) like TransitionPanel does", async () => {
    vi.mocked(transferCase).mockResolvedValue({
      ok: false,
      status: 0,
      detail: "Transfer service could not be reached. Try again.",
    });

    render(
      <TransferPanel
        caseId="CASE-1"
        currentJurisdictionId="dist-a"
        jurisdictions={JURISDICTIONS}
      />
    );

    fireEvent.change(screen.getByTestId("transfer-reason-input"), {
      target: { value: "handover" },
    });
    fireEvent.click(screen.getByTestId("transfer-submit"));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(
      "Transfer service could not be reached. Try again."
    );
    expect(alert).not.toHaveTextContent("HTTP 0");
  });
});
